import { isRelayOk, relayText } from "@/lib/client/cors-fetch";
import {
  type DdgResult,
  decodeEntities,
  hostOfUrl,
  parseDdgHtml,
  stripHtml,
} from "@/lib/client/ddg-parse";

/**
 * Open-web search without an API key. DuckDuckGo's HTML endpoints are scraped
 * through the relay chain, with Bing as the fallback engine. Results are plain
 * links — the skills that use them decide what counts as a paper, a product
 * listing or a good website.
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

export async function webSearch(
  query: string,
  options: { limit?: number; signal?: AbortSignal } = {},
): Promise<WebSearchOutcome> {
  const limit = Math.min(options.limit ?? 14, 30);
  const errors: string[] = [];

  const ddg = await relayText(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    { skipDirect: true, signal: options.signal, timeoutMs: 16_000 },
  );
  if (isRelayOk(ddg)) {
    const results = parseDdgHtml(ddg.data);
    if (results.length > 0) {
      return { results: dedupe(results, limit), engine: `duckduckgo (${ddg.via})` };
    }
    errors.push("duckduckgo returned no parseable results");
  } else {
    errors.push(`duckduckgo: ${ddg.error}`);
  }

  const lite = await relayText(
    `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
    { skipDirect: true, signal: options.signal, timeoutMs: 16_000 },
  );
  if (isRelayOk(lite)) {
    const results = parseDdgHtml(lite.data);
    if (results.length > 0) {
      return { results: dedupe(results, limit), engine: `duckduckgo-lite (${lite.via})` };
    }
    errors.push("duckduckgo lite returned nothing");
  } else {
    errors.push(`duckduckgo lite: ${lite.error}`);
  }

  const bing = await relayText(
    `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${limit}`,
    { skipDirect: true, signal: options.signal, timeoutMs: 16_000 },
  );
  if (isRelayOk(bing)) {
    const results = parseBingHtml(bing.data);
    if (results.length > 0) {
      return { results: dedupe(results, limit), engine: `bing (${bing.via})` };
    }
    errors.push("bing returned nothing");
  } else {
    errors.push(`bing: ${bing.error}`);
  }

  return { results: [], engine: "none", error: errors.join(" · ") };
}

export function looksLikePdf(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return path.endsWith(".pdf");
  } catch {
    return /\.pdf($|\?)/i.test(url);
  }
}
