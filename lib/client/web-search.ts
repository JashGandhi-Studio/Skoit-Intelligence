import { isRelayOk, relayText } from "@/lib/client/cors-fetch";
import {
  type DdgResult,
  decodeEntities,
  hostOfUrl,
  parseDdgHtml,
  stripHtml,
} from "@/lib/client/ddg-parse";

/**
 * Open-web search without an API key. Every engine is asked at the same time
 * (DuckDuckGo HTML, DuckDuckGo Lite, Bing, Mojeek, Ecosia) and the first one
 * that hands back parseable results wins — a blocked or slow engine never
 * adds its timeout to the search, which keeps the skill inside its budget.
 * Results are plain links; the skills that use them decide what counts as a
 * paper, a product listing or a good website.
 */

export interface WebResult {
  title: string;
  url: string;
  snippet: string;
  host: string;
}

export interface WebSearchOutcome {
  results: WebResult[];
  engine: string;
  error?: string;
}

export { decodeEntities, hostOfUrl, stripHtml };

function parseBingHtml(html: string): WebResult[] {
  const results: WebResult[] = [];
  const pattern =
    /<li class="b_algo"[\s\S]*?<h2><a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h2>([\s\S]*?)<\/li>/gi;
  let match: RegExpExecArray | null = pattern.exec(html);
  while (match !== null) {
    const url = match[1];
    const title = stripHtml(match[2]);
    const snippetChunk = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(match[3]);
    const snippet = snippetChunk ? stripHtml(snippetChunk[1]) : "";
    const host = hostOfUrl(url);
    if (host && !/(^|\.)(bing|microsoft)\./i.test(host) && title) {
      results.push({ title, url, snippet, host });
    }
    match = pattern.exec(html);
  }
  return results;
}

/** Mojeek results: one <li> per hit, the first anchor is the result link. */
function parseMojeekHtml(html: string): WebResult[] {
  const results: WebResult[] = [];
  const blocks = html.split(/<li(?![^>]*class="[^"]*(?:divider|nav))/i).slice(1);
  for (const block of blocks) {
    const link = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!link) {
      continue;
    }
    const url = link[1];
    const host = hostOfUrl(url);
    const title = stripHtml(link[2]);
    if (!host || /mojeek\./i.test(host) || title.length < 4) {
      continue;
    }
    const snippetChunk =
      /<p[^>]*>([\s\S]*?)<\/p>/i.exec(block) ??
      /<div[^>]*class="[^"]*s_[a-z]+[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(block);
    results.push({
      title,
      url,
      snippet: snippetChunk ? stripHtml(snippetChunk[1]) : "",
      host,
    });
    if (results.length >= 16) {
      break;
    }
  }
  return results;
}

/** Ecosia: result cards carry the URL and title in anchors. */
function parseEcosiaHtml(html: string): WebResult[] {
  const results: WebResult[] = [];
  const pattern =
    /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*data-track[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null = pattern.exec(html);
  while (match !== null && results.length < 16) {
    const url = match[1];
    const host = hostOfUrl(url);
    const title = stripHtml(match[2]);
    if (
      host &&
      title.length >= 4 &&
      !/(^|\.)(ecosia|bing|microsoft|google)\./i.test(host)
    ) {
      results.push({ title, url, snippet: "", host });
    }
    match = pattern.exec(html);
  }
  return results;
}

function dedupe(results: DdgResult[], limit: number): WebResult[] {
  const seen = new Set<string>();
  const kept: WebResult[] = [];
  for (const result of results) {
    const key = result.url.replace(/[#?].*$/, "");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    kept.push(result);
    if (kept.length >= limit) {
      break;
    }
  }
  return kept;
}

interface EngineAttempt {
  label: string;
  url: string;
  parse: (html: string) => WebResult[];
}

function engineRoutes(query: string): EngineAttempt[] {
  const q = encodeURIComponent(query);
  return [
    {
      label: "duckduckgo",
      url: `https://html.duckduckgo.com/html/?q=${q}`,
      parse: (html) => parseDdgHtml(html),
    },
    {
      label: "duckduckgo-lite",
      url: `https://lite.duckduckgo.com/lite/?q=${q}`,
      parse: (html) => parseDdgHtml(html),
    },
    {
      label: "bing",
      url: `https://www.bing.com/search?q=${q}&count=20`,
      parse: parseBingHtml,
    },
    {
      label: "mojeek",
      url: `https://www.mojeek.com/search?q=${q}`,
      parse: parseMojeekHtml,
    },
    {
      label: "ecosia",
      url: `https://www.ecosia.org/search?q=${q}`,
      parse: parseEcosiaHtml,
    },
  ];
}

/** Every engine in flight at once; the first parseable answer wins. */
async function raceEngines(
  routes: EngineAttempt[],
  limit: number,
  signal?: AbortSignal,
): Promise<WebSearchOutcome> {
  const errors: string[] = [];

  const attempts = routes.map(
    (route) =>
      new Promise<WebSearchOutcome>((resolve) => {
        relayText(route.url, {
          skipDirect: true,
          signal,
          timeoutMs: 10_000,
        }).then((fetched) => {
          if (!isRelayOk(fetched)) {
            errors.push(`${route.label}: ${fetched.error}`);
            resolve({ results: [], engine: "none" });
            return;
          }
          const parsed = route.parse(fetched.data);
          if (parsed.length === 0) {
            errors.push(`${route.label} returned nothing parseable`);
            resolve({ results: [], engine: "none" });
            return;
          }
          resolve({
            results: dedupe(parsed, limit),
            engine: `${route.label} (${fetched.via})`,
          });
        });
      }),
  );

  for (const outcome of await Promise.all(attempts)) {
    if (outcome.results.length > 0) {
      return outcome;
    }
  }
  return { results: [], engine: "none", error: errors.join(" · ") };
}

export async function webSearch(
  query: string,
  options: { limit?: number; signal?: AbortSignal } = {},
): Promise<WebSearchOutcome> {
  const limit = Math.min(options.limit ?? 14, 30);
  return raceEngines(engineRoutes(query), limit, options.signal);
}

export function looksLikePdf(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return path.endsWith(".pdf");
  } catch {
    return /\.pdf($|\?)/i.test(url);
  }
}
