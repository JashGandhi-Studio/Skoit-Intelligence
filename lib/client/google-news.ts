import { hostOf, isRelayOk, relayJson, relayText } from "@/lib/client/cors-fetch";
import { editionByCode, type NewsEdition } from "@/lib/news-editions";
import type { NewsPlace } from "@/lib/news-places";
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
  /** Which engine answered: google | bing | gdelt */
  engine?: "google" | "bing" | "gdelt";
  /** Present when the feed was scoped to a city or state. */
  placeLabel?: string;
}

function feedUrl(
  topic: NewsTopic | undefined,
  query: string | undefined,
  edition: NewsEdition,
  place?: NewsPlace,
) {
  const base = "https://news.google.com/rss";
  const params = `hl=${edition.hl}&gl=${edition.gl}&ceid=${edition.ceid}`;
  // City geo feeds are first-class at Google News: /headlines/section/geo/<City>.
  if (place?.feed === "geo") {
    return `${base}/headlines/section/geo/${encodeURIComponent(titleCaseWords(place.name))}?${params}`;
  }
  if (place?.feed === "search") {
    return `${base}/search?q=${encodeURIComponent(titleCaseWords(place.name))}&${params}`;
  }
  if (query && query.trim().length > 0) {
    return `${base}/search?q=${encodeURIComponent(query.trim())}&${params}`;
  }
  const topicId = topic && topic !== "top" ? TOPIC_IDS[topic] : undefined;
  if (topicId) {
    return `${base}/headlines/section/topic/${topicId}?${params}`;
  }
  return `${base}?${params}`;
}

function titleCaseWords(value: string): string {
  return value
    .split(" ")
    .map((word) =>
      word === "ncr" ? "NCR" : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(" ");
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

interface NewsEngineResult {
  articles: ArticleItem[];
  via: string;
  error?: string;
}

async function fetchGoogleFeed(
  options: {
    topic?: NewsTopic;
    query?: string;
    place?: NewsPlace;
    signal?: AbortSignal;
  },
  edition: NewsEdition,
  limit: number,
): Promise<NewsEngineResult> {
  const url = feedUrl(options.topic, options.query, edition, options.place);
  const fetched = await relayText(url, {
    accept: "application/rss+xml, application/xml, text/xml, */*",
    skipDirect: true,
    timeoutMs: 10_000,
    signal: options.signal,
  });

  if (!isRelayOk(fetched)) {
    return { articles: [], via: "none", error: fetched.error };
  }

  const xml = fetched.data;
  if (!/<rss|<feed|<item/i.test(xml)) {
    return {
      articles: [],
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
    .slice(0, limit);

  return { articles: deduped, via: fetched.via };
}

/**
 * GDELT DOC 2.0 — the third engine. A public JSON API with no key and no
 * quota drama; when both RSS feeds are blocked on a network, GDELT almost
 * always still answers, so the news ask does not die with the relays.
 */
async function fetchGdeltNews(
  options: {
    query?: string;
    countryCode?: string;
    signal?: AbortSignal;
  },
  edition: NewsEdition,
  limit: number,
): Promise<NewsEngineResult> {
  const trimmedQuery = (options.query ?? "").trim();
  const query = trimmedQuery.length > 0 ? trimmedQuery : "top stories";
  const sourceCountry = edition.code.toUpperCase();
  const params = new URLSearchParams({
    query: `"${query}" OR ${sourceCountry === "IN" ? "India" : sourceCountry}`,
    mode: "ArtList",
    format: "json",
    maxrecords: String(Math.min(50, limit * 2)),
    sort: "DateDesc",
    timespan: "1d",
  });
  const fetched = await relayJson<Record<string, unknown>>(
    `https://api.gdeltproject.org/api/v2/doc/doc?${params.toString()}`,
    { timeoutMs: 10_000, signal: options.signal },
  );
  if (!isRelayOk(fetched)) {
    return { articles: [], via: "none", error: fetched.error };
  }
  const rows = (fetched.data as { articles?: Array<Record<string, unknown>> })
    ?.articles;
  if (!Array.isArray(rows)) {
    return { articles: [], via: "none", error: "unexpected GDELT shape" };
  }
  const articles: ArticleItem[] = [];
  for (const row of rows.slice(0, limit)) {
    const url = String(row.url ?? "");
    const title = String(row.title ?? "").trim();
    if (!/^https?:\/\//.test(url) || title.length < 8) {
      continue;
    }
    let seen: number | undefined;
    const seendate = String(row.seendate ?? "");
    const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(seendate);
    if (m) {
      seen = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`);
    }
    articles.push({
      id: newId("gd"),
      title,
      url,
      domain: String(row.domain ?? hostOf(url)),
      source: String(row.domain ?? hostOf(url)),
      publishedAt: seen,
      imageUrl: typeof row.socialimage === "string" ? row.socialimage : undefined,
      country: edition.code,
      language: edition.hl.split("-")[0],
    });
  }
  if (articles.length === 0) {
    return { articles: [], via: fetched.via, error: "no GDELT rows" };
  }
  return { articles, via: fetched.via };
}

/**
 * The news ask answers from whichever engine gets there with content — all
 * three run at the same time, so a blocked feed costs zero extra seconds.
 * Google's own feed wins on a tie: it carries the truest per-story dates.
 */
export async function googleNews(options: {
  topic?: NewsTopic;
  query?: string;
  countryCode?: string;
  place?: NewsPlace;
  limit?: number;
  signal?: AbortSignal;
}): Promise<GoogleNewsResult & { error?: string }> {
  const edition =
    editionByCode(options.countryCode ?? options.place?.country) ??
    editionByCode("world");
  if (!edition) {
    return {
      articles: [],
      edition: editionByCode("world")!,
      via: "none",
      error: "no edition",
    };
  }
  const limit = options.limit ?? 24;

  const [google, bing, gdelt] = await Promise.all([
    fetchGoogleFeed(
      {
        topic: options.topic,
        query: options.query,
        place: options.place,
        signal: options.signal,
      },
      edition,
      limit,
    ),
    bingNewsSearch({
      query: options.query,
      countryCode: options.countryCode ?? options.place?.country,
      limit,
      signal: options.signal,
    }).then((result) => ({ ...result, error: result.error })),
    fetchGdeltNews(
      {
        query: options.query,
        countryCode: options.countryCode ?? options.place?.country,
        signal: options.signal,
      },
      edition,
      limit,
    ),
  ]);

  type EngineKey = "google" | "gdelt" | "bing";
  const rawCandidates: Array<{ engine: EngineKey; result: NewsEngineResult }> = [
    { engine: "google", result: google },
    { engine: "gdelt", result: gdelt },
    { engine: "bing", result: bing },
  ];
  rawCandidates.sort((a, b) => b.result.articles.length - a.result.articles.length);
  const candidates = rawCandidates;

  const winner =
    candidates.find((candidate) => candidate.result.articles.length > 0) ??
    candidates[0];

  return {
    articles: winner.result.articles,
    edition,
    via: winner.result.via,
    engine: winner.engine,
    placeLabel: options.place ? labelForPlace(options.place) : undefined,
    error:
      winner.result.articles.length > 0
        ? undefined
        : [google.error, bing.error, gdelt.error].filter(Boolean).join(" · ") ||
          "all news engines returned no items",
  };
}

function labelForPlace(place: NewsPlace): string {
  const parts = [titleCaseWords(place.name)];
  if (place.region) {
    parts.push(place.region);
  }
  return parts.join(" · ");
}

/**
 * Bing News RSS — the second engine. When Google's feed will not come through
 * (blocked relay, rate limit, captive portal), the news ask still answers from
 * here instead of dying. Same discipline: real publisher links, real dates.
 */
export async function bingNewsSearch(options: {
  query?: string;
  countryCode?: string;
  limit?: number;
  signal?: AbortSignal;
}): Promise<{ articles: ArticleItem[]; via: string; error?: string }> {
  const edition = editionByCode(options.countryCode ?? "") ?? editionByCode("world");
  const market = edition?.gl ?? "IN";
  const base = options.query?.trim()
    ? `https://www.bing.com/news/search?q=${encodeURIComponent(options.query.trim())}`
    : "https://www.bing.com/news/search?q=top+stories";
  const url = `${base}&format=RSS&setmkt=${market === "IN" ? "en-IN" : `en-${market}`}`;

  const fetched = await relayText(url, {
    accept: "application/rss+xml, application/xml, text/xml, */*",
    skipDirect: true,
    timeoutMs: 10_000,
    signal: options.signal,
  });
  if (!isRelayOk(fetched)) {
    return { articles: [], via: "none", error: fetched.error };
  }
  if (!/<rss|<item/i.test(fetched.data)) {
    return { articles: [], via: fetched.via, error: "the response was not a news feed" };
  }

  const articles: ArticleItem[] = parseItems(fetched.data)
    .map((item) => {
      const { headline, source } = splitTitle(item.title, item.sourceName);
      const realUrl =
        item.articleUrl && /^https?:\/\//.test(item.articleUrl)
          ? item.articleUrl
          : item.link;
      const domain = realUrl ? hostOf(realUrl) : "bing.com";
      return {
        id: newId("bn"),
        title: headline,
        url: realUrl || item.link,
        domain,
        source: source ?? domain,
        snippet: stripTags(decodeEntities(item.description)).slice(0, 280) || undefined,
        publishedAt: item.pubDate,
        imageUrl: item.imageUrl,
        country: edition?.code,
        language: edition?.hl.split("-")[0] ?? "en",
      } satisfies ArticleItem;
    })
    .filter((article) => article.title.length > 2 && /^https?:\/\//.test(article.url));

  const deduped = Array.from(
    new Map(articles.map((article) => [article.url, article])).values(),
  )
    .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
    .slice(0, options.limit ?? 24);

  return { articles: deduped, via: fetched.via };
}
