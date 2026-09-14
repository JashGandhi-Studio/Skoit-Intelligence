/**
 * Parser for DuckDuckGo's HTML result pages (both the /html and /lite shapes)
 * — kept as its own pure module so it can be unit-tested without a network.
 */

export interface DdgResult {
  title: string;
  url: string;
  snippet: string;
  host: string;
}

export function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function stripHtml(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

export function hostOfUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** DDG wraps outbound links as /l/?uddg=<encoded>. Unwrap them. */
function unwrapDdgUrl(href: string): string {
  let url = href;
  if (url.startsWith("//")) {
    url = `https:${url}`;
  }
  try {
    const parsed = new URL(url);
    const uddg = parsed.searchParams.get("uddg");
    if (uddg) {
      return uddg;
    }
  } catch {
    /* not a redirect wrapper */
  }
  return url;
}

const IGNORED_HOSTS =
  /(^|\.)(duckduckgo\.com|bing\.com|microsofttranslator\.com|google\.com)$/i;

function isIgnored(url: string): boolean {
  const host = hostOfUrl(url);
  return !host || IGNORED_HOSTS.test(host) || url.startsWith("javascript:");
}

export function parseDdgHtml(html: string): DdgResult[] {
  const results: DdgResult[] = [];
  // html.duckduckgo.com/html shape
  const blockPattern =
    /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=<a[^>]+class="[^"]*result__a|<\/div>\s*<\/div>\s*<\/div>|$)/gi;
  let match: RegExpExecArray | null = blockPattern.exec(html);
  while (match !== null) {
    const url = unwrapDdgUrl(match[1]);
    const title = stripHtml(match[2]);
    const snippetChunk = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(
      match[3],
    );
    const snippet = snippetChunk ? stripHtml(snippetChunk[1]) : "";
    if (!isIgnored(url) && title) {
      results.push({ title, url, snippet, host: hostOfUrl(url) });
    }
    match = blockPattern.exec(html);
  }
  if (results.length > 0) {
    return results;
  }
  // lite.duckduckgo.com shape
  const litePattern =
    /<a[^>]+rel="nofollow"[^>]+href="([^"]+)"[^>]*class='result-link'[^>]*>([\s\S]*?)<\/a>/gi;
  const snippets: string[] = [];
  const snippetPattern = /<td[^>]+class='result-snippet'[^>]*>([\s\S]*?)<\/td>/gi;
  match = snippetPattern.exec(html);
  while (match !== null) {
    snippets.push(stripHtml(match[1]));
    match = snippetPattern.exec(html);
  }
  let index = 0;
  match = litePattern.exec(html);
  while (match !== null) {
    const url = unwrapDdgUrl(match[1]);
    const title = stripHtml(match[2]);
    if (!isIgnored(url) && title) {
      results.push({ title, url, snippet: snippets[index] ?? "", host: hostOfUrl(url) });
    }
    index += 1;
    match = litePattern.exec(html);
  }
  return results;
}
