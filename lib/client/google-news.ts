import { hostOf, isRelayOk, relayText } from "@/lib/client/cors-fetch";
import { editionByCode, type NewsEdition } from "@/lib/news-editions";
import type { ArticleItem } from "@/lib/types";
import { newId } from "@/lib/utils";

export function stripTags(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Google News RSS — the freshest reporting there is, per country edition, read
 * from the browser through the relay chain. Topics map onto Google's topic
 * feeds; a topic query uses the search feed. Publication dates come from the
 * feed itself, so "latest" means latest, not "whatever the cache had".
 */

export type NewsTopic =
  | "top"
  | "world"
  | "business"
  | "technology"
  | "entertainment"
  | "sports"
  | "science"
  | "health";

const TOPIC_IDS: Record<NewsTopic, string> = {
  top: "",
  world: "WORLD",
  business: "BUSINESS",
  technology: "TECHNOLOGY",
  entertainment: "ENTERTAINMENT",
  sports: "SPORTS",
  science: "SCIENCE",
  health: "HEALTH",
};

export interface GoogleNewsResult {
  articles: ArticleItem[];
  edition: NewsEdition;
  via: string;
  query?: string;
}

function feedUrl(
  topic: NewsTopic | undefined,
  query: string | undefined,
  edition: NewsEdition,
) {
  const base = "https://news.google.com/rss";
  const params = `hl=${edition.hl}&gl=${edition.gl}&ceid=${edition.ceid}`;
  if (query && query.trim().length > 0) {
    const when = "";
    return `${base}/search?q=${encodeURIComponent(query.trim())}${when}&${params}`;
  }
  const topicId = topic && topic !== "top" ? TOPIC_IDS[topic] : undefined;
  if (topicId) {
    return `${base}/headlines/section/topic/${topicId}?${params}`;
  }
  return `${base}?${params}`;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function stripRssCdata(value: string): string {
  const cdata = /^<!\[CDATA\[([\s\S]*)\]\]>]$/.exec(value.trim());
  return (cdata ? cdata[1] : value).trim();
}

interface RawItem {
  title: string;
  link: string;
  pubDate?: number;
  sourceName?: string;
  sourceUrl?: string;
  articleUrl?: string;
  description: string;
  imageUrl?: string;
}

export function parseItems(xml: string): RawItem[] {
  const items: RawItem[] = [];
  const itemPattern = /<item>([\s\S]*?)<\/item>/g;
  let match: RegExpExecArray | null = itemPattern.exec(xml);
  while (match !== null) {
    const block = match[1];
    const pick = (tag: string): string => {
      const found = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(block);
      return found ? decodeEntities(stripRssCdata(found[1])) : "";
    };
    const title = pick("title");
    const link = pick("link");
    const pub = pick("pubDate");
    const description = pick("description");
    const sourceTag = /<source[^>]*url="([^"]*)"[^>]*>([\s\S]*?)<\/source>/i.exec(block);
    const media = /<media:content[^>]*url="([^"]+)"/i.exec(block);
    const mediaThumb = /<media:thumbnail[^>]*url="([^"]+)"/i.exec(block);

    // The description carries the real publisher link as its first anchor —
    // that is the article behind the Google redirect, and it is what the
    // reader opens.
    const firstHref = /<a\s+href="([^"]+)"/i.exec(description);

    items.push({
      title,
      link,
      pubDate: pub ? Date.parse(pub) || undefined : undefined,
      sourceName: sourceTag ? decodeEntities(stripRssCdata(sourceTag[2])) : undefined,
      sourceUrl: sourceTag?.[1],
      articleUrl: firstHref?.[1],
      description,
      imageUrl: media?.[1] ?? mediaThumb?.[1],
    });
    match = itemPattern.exec(xml);
  }
  return items;
}

/** Google News titles arrive as "Headline - Publisher". Split on the last dash. */
export function splitTitle(
  raw: string,
  sourceName?: string,
): { headline: string; source?: string } {
  if (sourceName && raw.endsWith(` - ${sourceName}`)) {
    return {
      headline: raw.slice(0, raw.length - sourceName.length - 3),
      source: sourceName,
    };
  }
  const index = raw.lastIndexOf(" - ");
  if (index > 12 && raw.length - index < 42) {
    return { headline: raw.slice(0, index), source: raw.slice(index + 3) };
  }
  return { headline: raw, source: sourceName };
}

export async function googleNews(options: {
  topic?: NewsTopic;
  query?: string;
  countryCode?: string;
  limit?: number;
  signal?: AbortSignal;
}): Promise<GoogleNewsResult & { error?: string }> {
  const edition = editionByCode(options.countryCode) ?? editionByCode("world");
  if (!edition) {
    return {
      articles: [],
      edition: editionByCode("world")!,
      via: "none",
      error: "no edition",
    };
  }
  const url = feedUrl(options.topic, options.query, edition);
  const fetched = await relayText(url, {
    accept: "application/rss+xml, application/xml, text/xml, */*",
    skipDirect: true,
    signal: options.signal,
  });

  if (!isRelayOk(fetched)) {
    return { articles: [], edition, via: "none", error: fetched.error };
  }

  const xml = fetched.data;
  if (!/<rss|<feed|<item/i.test(xml)) {
    return {
      articles: [],
      edition,
      via: fetched.via,
      error: "the response was not a news feed",
    };
  }

  const rawItems = parseItems(xml);
  const articles: ArticleItem[] = rawItems
    .map((item) => {
      const { headline, source } = splitTitle(item.title, item.sourceName);
      const realUrl =
        item.articleUrl && /^https?:\/\//.test(item.articleUrl)
          ? item.articleUrl
          : item.link;
      const domain = realUrl ? hostOf(realUrl) : "news.google.com";
      const article: ArticleItem = {
        id: newId("gn"),
        title: headline,
        url: realUrl || item.link,
        domain,
        source: source ?? domain,
        snippet: stripTags(decodeEntities(item.description)).slice(0, 280) || undefined,
        publishedAt: item.pubDate,
        imageUrl: item.imageUrl,
        country: edition.code,
        language: edition.hl.split("-")[0],
      };
      return article;
    })
    .filter((article) => article.title.length > 2 && /^https?:\/\//.test(article.url));

  const deduped = Array.from(
    new Map(articles.map((article) => [article.url, article])).values(),
  )
    .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
    .slice(0, options.limit ?? 24);

  return { articles: deduped, edition, via: fetched.via };
}
