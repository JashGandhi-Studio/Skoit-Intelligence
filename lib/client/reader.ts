import { isRelayOk, type RelayFailure, relayText } from "@/lib/client/cors-fetch";
import { stripHtml } from "@/lib/client/web-search";

/**
 * Read an article inside the console. The page is fetched through the relay
 * chain, then reduced to its text: the main article element when the page
 * marks one, otherwise the dominant paragraph cluster. r.jina.ai is tried
 * first because it already does this reduction well and allows cross-origin
 * reads; the manual extractor is the fallback and the offline answer.
 */

export interface ExtractedArticle {
  title?: string;
  byline?: string;
  publishedAt?: number;
  paragraphs: string[];
  links: Array<{ label: string; url: string }>;
  wordCount: number;
  via: string;
}

const JINA_READER = "https://r.jina.ai/";

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

async function viaJinaReader(
  url: string,
  signal?: AbortSignal,
): Promise<ExtractedArticle | RelayFailure> {
  const fetched = await relayText(`${JINA_READER}${url}`, {
    skipDirect: true,
    timeoutMs: 22_000,
    signal,
  });
  if (!isRelayOk(fetched)) {
    return fetched;
  }
  const text = fetched.data;
  const title = /^Title:\s*(.+)$/m.exec(text)?.[1]?.trim();
  const byline = /^Author:\s*(.+)$/m.exec(text)?.[1]?.trim();
  const published = /^Published:\s*(.+)$/m.exec(text)?.[1]?.trim();
  const bodyStart = text.indexOf("Markdown Content:");
  const body = bodyStart >= 0 ? text.slice(bodyStart + "Markdown Content:".length) : text;

  const paragraphs: string[] = [];
  const links: Array<{ label: string; url: string }> = [];
  const seenLinks = new Set<string>();

  for (const rawLine of body.split(/\n{2,}/)) {
    const line = rawLine.trim();
    if (!line || /^!\[/.test(line) || /^\s*[-=* _]{3,}\s*$/.test(line)) {
      continue;
    }
    if (/^#{1,6}\s/.test(line)) {
      paragraphs.push(
        line
          .replace(/^#{1,6}\s+/, "")
          .replace(/\s+/g, " ")
          .trim(),
      );
      continue;
    }
    // collect markdown links
    const linkPattern = /\[([^\]]{1,120})\]\((https?:\/\/[^)\s]+)\)/g;
    let linkMatch: RegExpExecArray | null = linkPattern.exec(line);
    while (linkMatch !== null) {
      const label = linkMatch[1].trim();
      const linkUrl = linkMatch[2];
      if (!seenLinks.has(linkUrl) && !linkUrl.includes("r.jina.ai")) {
        seenLinks.add(linkUrl);
        links.push({ label, url: linkUrl });
      }
      linkMatch = linkPattern.exec(line);
    }
    const clean = line
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      .replace(/\[([^\]]{1,120})\]\([^)]*\)/g, "$1")
      .replace(/[*_`>]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (clean.split(/\s+/).length >= 4) {
      paragraphs.push(clean);
    }
  }

  const joined = paragraphs.join(" ");
  if (paragraphs.length === 0 || joined.split(/\s+/).length < 40) {
    return {
      error: "reader returned too little text",
      tried: [fetched.via],
      ms: fetched.ms,
    };
  }
  const stamp = published ? Date.parse(published) : undefined;
  return {
    title: title ? decodeEntities(title) : undefined,
    byline: byline ? decodeEntities(byline) : undefined,
    publishedAt: stamp && !Number.isNaN(stamp) ? stamp : undefined,
    paragraphs: paragraphs.slice(0, 220),
    links: links.slice(0, 40),
    wordCount: joined.split(/\s+/).length,
    via: `r.jina.ai (${fetched.via})`,
  };
}

function extractFromHtml(html: string, baseUrl: string): ExtractedArticle {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<(nav|footer|header|aside|form)[\s\S]*?<\/\1>/gi, " ");

  const ogTitle =
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i.exec(html)?.[1] ??
    /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i.exec(html)?.[1];
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const byline =
    /<meta[^>]+name=["'](?:author|twitter:creator)["'][^>]+content=["']([^"']+)["']/i.exec(
      html,
    )?.[1];
  const publishedRaw =
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i.exec(
      html,
    )?.[1] ?? /<time[^>]+datetime=["']([^"']+)["']/i.exec(html)?.[1];
  const publishedStamp = publishedRaw ? Date.parse(publishedRaw) : undefined;

  // Prefer a marked article/main body; otherwise take every paragraph on the page.
  const articleMatch =
    /<article[^>]*>([\s\S]*?)<\/article>/i.exec(cleaned) ??
    /<main[^>]*>([\s\S]*?)<\/main>/i.exec(cleaned) ??
    /<div[^>]+(?:id|class)="[^"]*(?:article|story|content|entry)[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<footer|<aside|<script)/i.exec(
      cleaned,
    );
  const scope = articleMatch?.[1] ?? cleaned;

  const paragraphs: string[] = [];
  const paragraphPattern = /<(?:p|h[1-3]|li)[^>]*>([\s\S]*?)<\/(?:p|h[1-3]|li)>/gi;
  let match: RegExpExecArray | null = paragraphPattern.exec(scope);
  while (match !== null) {
    const text = stripHtml(match[1]).replace(/\s+/g, " ").trim();
    const words = text.split(/\s+/).length;
    if (words >= 6 && !paragraphs.includes(text)) {
      paragraphs.push(text);
    }
    match = paragraphPattern.exec(scope);
  }

  const links: Array<{ label: string; url: string }> = [];
  const seen = new Set<string>();
  const linkPattern = /<a[^>]+href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  match = linkPattern.exec(scope);
  while (match !== null) {
    const url = match[1];
    const label = stripHtml(match[2]).slice(0, 100);
    if (!seen.has(url) && label && !/\.(jpe?g|png|svg|gif)(\?|$)/i.test(url)) {
      seen.add(url);
      links.push({ label, url });
    }
    if (links.length >= 40) {
      break;
    }
    match = linkPattern.exec(scope);
  }

  const joined = paragraphs.join(" ");
  return {
    title: ogTitle
      ? decodeEntities(ogTitle)
      : titleTag
        ? decodeEntities(titleTag.split(/[|·—-]/)[0].trim())
        : undefined,
    byline: byline ? decodeEntities(byline) : undefined,
    publishedAt:
      publishedStamp && !Number.isNaN(publishedStamp) ? publishedStamp : undefined,
    paragraphs,
    links,
    wordCount: joined.split(/\s+/).filter(Boolean).length,
    via: `direct extraction (${baseUrl.slice(0, 60)})`,
  };
}

async function viaDirectExtraction(
  url: string,
  signal?: AbortSignal,
): Promise<ExtractedArticle | RelayFailure> {
  const fetched = await relayText(url, {
    accept: "text/html",
    skipDirect: true,
    timeoutMs: 18_000,
    signal,
  });
  if (!isRelayOk(fetched)) {
    return fetched;
  }
  const extracted = extractFromHtml(fetched.data, url);
  if (extracted.paragraphs.length === 0 || extracted.wordCount < 60) {
    return {
      error: "the page yielded no readable article text",
      tried: [fetched.via],
      ms: fetched.ms,
    };
  }
  return { ...extracted, via: `html extraction (${fetched.via})` };
}

export async function readArticle(
  url: string,
  signal?: AbortSignal,
): Promise<{ article?: ExtractedArticle; error?: string }> {
  const jina = await viaJinaReader(url, signal).catch(
    () => ({ error: "reader crashed", tried: [], ms: 0 }) as RelayFailure,
  );
  if ("paragraphs" in jina) {
    return { article: jina };
  }
  const direct = await viaDirectExtraction(url, signal).catch(
    () => ({ error: "extraction crashed", tried: [], ms: 0 }) as RelayFailure,
  );
  if ("paragraphs" in direct) {
    return { article: direct };
  }
  return { error: `could not read this article — ${jina.error}; ${direct.error}` };
}

/** Extractive key points: score sentences by position, length and term weight. */
export function keyPointsOf(article: ExtractedArticle, max = 4): string[] {
  const sentences = article.paragraphs
    .join(" ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 40 && sentence.length < 320);

  const frequency = new Map<string, number>();
  for (const word of article.paragraphs
    .join(" ")
    .toLowerCase()
    .match(/[a-z\u0900-\u097F]{4,}/g) ?? []) {
    frequency.set(word, (frequency.get(word) ?? 0) + 1);
  }

  const scored = sentences.map((sentence, index) => {
    const words = sentence.toLowerCase().match(/[a-z\u0900-\u097F]{4,}/g) ?? [];
    const weight =
      words.reduce((total, word) => total + (frequency.get(word) ?? 0), 0) /
      Math.max(words.length, 1);
    const positional = index < 3 ? 1.35 : index < 8 ? 1.12 : 1;
    return { sentence, index, score: weight * positional };
  });

  const picked: Array<{ sentence: string; index: number }> = [];
  for (const item of [...scored].sort((a, b) => b.score - a.score)) {
    if (picked.length >= max) {
      break;
    }
    // avoid near-duplicate picks from adjacent sentences
    if (picked.some((existing) => Math.abs(existing.index - item.index) < 2)) {
      continue;
    }
    picked.push(item);
  }
  return picked.sort((a, b) => a.index - b.index).map((item) => item.sentence);
}
