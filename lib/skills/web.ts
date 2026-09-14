import { isRelayOk, relayText } from "@/lib/client/cors-fetch";
import { bingNewsSearch, googleNews, type NewsTopic } from "@/lib/client/google-news";
import { keyPointsOf, readArticle } from "@/lib/client/reader";
import { saavnSearch } from "@/lib/client/saavn";
import {
  looksLikePdf,
  type WebResult,
  type WebSearchOutcome,
  webSearch,
} from "@/lib/client/web-search";
import { youtubeSearch } from "@/lib/client/youtube";
import { source } from "@/lib/net/http";
import { detectPlaceInText, labelOfPlace } from "@/lib/news-places";
import { evidence } from "@/lib/skills/emit";
import { AUDIO_KEYWORDS, NEWS_KEYWORDS, VIDEO_KEYWORDS } from "@/lib/skills/retrieval";
import type {
  ArticleItem,
  MediaItem,
  SkillDefinition,
  SkillOutcome,
  SourceRef,
} from "@/lib/types";
import { newId, truncate } from "@/lib/utils";

/**
 * The everyday layer on top of the OSINT core: the sources people actually
 * ask for. All of them execute from the analyst's browser through the relay
 * chain (the server may have no egress at all), and all of them state plainly
 * where every result came from and what its terms are.
 */

function queryOf(target: { value: string; meta?: Record<string, string> }): string {
  const fromMeta = target.meta?.query?.trim();
  return (fromMeta && fromMeta.length > 1 ? fromMeta : target.value).trim();
}

function budget(target: { meta?: Record<string, string> }): number {
  const requested = Number(target.meta?.perSource ?? "8");
  return Number.isFinite(requested)
    ? Math.min(24, Math.max(3, Math.round(requested)))
    : 8;
}

function retrievalTargetOutcome(input: {
  status: SkillOutcome["status"];
  summary: string;
  evidence: SkillOutcome["evidence"];
  sources: SourceRef[];
  media?: MediaItem[];
  articles?: ArticleItem[];
  error?: SkillOutcome["error"];
}): SkillOutcome {
  return {
    status: input.status,
    summary: input.summary,
    evidence: input.evidence,
    entities: [],
    sources: input.sources,
    media: input.media,
    articles: input.articles,
    error: input.error,
  };
}

/* ------------------------------------------------------------ JioSaavn ---- */

export const saavnMusic: SkillDefinition = {
  id: "music-saavn",
  name: "Song finder (JioSaavn)",
  short: "Songs",
  description:
    "Finds the song you named on JioSaavn — full-length, in-app playback and direct download of the stream. Precision-ranked so the song you asked for comes back, not a dump of lookalikes.",
  category: "retrieval",
  runtime: "live",
  accepts: ["text"],
  produces: ["tracks", "stream"],
  keywords: AUDIO_KEYWORDS,
  clientFallback: true,
  async run(target, ctx) {
    const skill = "music-saavn";
    const query = queryOf(target);
    const limit = Math.min(budget(target), 10);
    ctx.log(`Searching JioSaavn for “${query}”`);

    const src = source(
      "jiosaavn",
      "JioSaavn catalogue",
      "https://www.jiosaavn.com",
      "api",
    );
    const result = await saavnSearch(query, {
      limit,
      precise: true,
      signal: ctx.signal,
    });

    if (result.tracks.length === 0) {
      return retrievalTargetOutcome({
        status: "unreachable",
        summary: `No playable JioSaavn track matched “${query}”.`,
        evidence: [
          evidence(skill, "Search", "no playable match", {
            source: src,
            kind: "warning",
            confidence: "confirmed",
            detail:
              result.errors.join(" · ") ||
              "The catalogue returned nothing for this exact ask.",
          }),
        ],
        sources: [src],
        error: {
          code: "egress_blocked",
          message: result.errors.join(" · ") || "no match",
        },
      });
    }

    const media: MediaItem[] = result.tracks.map((track) => ({
      id: newId("md"),
      kind: "audio",
      title: track.title,
      url: track.streamUrl!,
      pageUrl: track.permaUrl ?? "https://www.jiosaavn.com",
      thumbnailUrl: track.imageUrl,
      source: "JioSaavn",
      sourceId: "jiosaavn",
      artist: track.artist,
      collection: track.album,
      durationMs: track.durationSec ? track.durationSec * 1000 : undefined,
      access: "download",
      query,
      storeName: track.label ? `${track.label} · JioSaavn` : "JioSaavn",
    }));

    const top = result.tracks[0];
    const evidenceItems: SkillOutcome["evidence"] = [
      evidence(skill, "Full tracks", `${media.length} result(s) for “${query}”`, {
        source: src,
        detail:
          "Full-length catalogue streams (not 30-second previews), played from JioSaavn's own CDN.",
      }),
      evidence(skill, "Top match", `${top.title} — ${top.artist}`, {
        source: src,
        confidence: "confirmed",
        detail: `${trackSummary(top)} · ranked by title/artist precision so the ask comes first.`,
        kind: "artifact",
      }),
      evidence(
        skill,
        "Terms",
        "Catalogue stream for personal listening — JioSaavn's terms apply, this is not a licence-clear source",
        {
          source: src,
          kind: "warning",
          severity: "low",
          confidence: "confirmed",
          detail:
            "For reuse in published work, prefer the licence-clear sources (Internet Archive, Jamendo with a key, Wikimedia) or the official store link.",
        },
      ),
    ];

    return retrievalTargetOutcome({
      status: "ok",
      summary: `${media.length} track(s) from JioSaavn — top: ${top.title} by ${top.artist}.`,
      evidence: evidenceItems,
      sources: [src],
      media,
    });
  },
};

function trackSummary(track: {
  album?: string;
  year?: string;
  language?: string;
}): string {
  return (
    [track.album, track.year, track.language].filter(Boolean).join(" · ") ||
    "catalogue stream"
  );
}

/* ------------------------------------------------------------ YouTube ----- */

export const youtubeVideo: SkillDefinition = {
  id: "video-youtube",
  name: "Video finder (YouTube)",
  short: "YouTube",
  description:
    "Finds YouTube videos for the ask and plays them inside the console through YouTube's official player. Downloadable licence-clear footage stays with the Video footage skill.",
  category: "retrieval",
  runtime: "live",
  accepts: ["text"],
  produces: ["videos"],
  keywords: VIDEO_KEYWORDS,
  clientFallback: true,
  async run(target, ctx) {
    const skill = "video-youtube";
    const query = queryOf(target);
    const limit = Math.min(budget(target), 12);
    ctx.log(`Searching YouTube for “${query}”`);

    const src = source("youtube", "YouTube search", "https://www.youtube.com", "api");
    const result = await youtubeSearch(query, { limit, signal: ctx.signal });

    if (result.hits.length === 0) {
      return retrievalTargetOutcome({
        status: "unreachable",
        summary: `YouTube returned nothing playable for “${query}”.`,
        evidence: [
          evidence(skill, "Search", "no results reached the console", {
            source: src,
            kind: "warning",
            confidence: "unknown",
            detail:
              result.error ?? "All search routes were unreachable from this browser.",
          }),
        ],
        sources: [src],
        error: { code: "egress_blocked", message: result.error ?? "youtube unreachable" },
      });
    }

    const media: MediaItem[] = result.hits.map((hit) => ({
      id: newId("md"),
      kind: "video",
      title: hit.title,
      url: `https://www.youtube.com/watch?v=${hit.videoId}`,
      embedUrl: `https://www.youtube-nocookie.com/embed/${hit.videoId}?rel=0&modestbranding=1`,
      pageUrl: `https://www.youtube.com/watch?v=${hit.videoId}`,
      thumbnailUrl:
        hit.thumbnailUrl ?? `https://i.ytimg.com/vi/${hit.videoId}/hqdefault.jpg`,
      source: `YouTube${hit.author ? ` · ${hit.author}` : ""}`,
      sourceId: "youtube",
      durationMs: hit.durationSec ? hit.durationSec * 1000 : undefined,
      licence: "© the uploader — playback via YouTube's official player",
      query,
      publishedAt: undefined,
    }));

    const evidenceItems: SkillOutcome["evidence"] = [
      evidence(skill, "Videos found", `${media.length} result(s) for “${query}”`, {
        source: src,
        detail: `Search route: ${result.via}. Playback runs inside the console through youtube-nocookie.com.`,
      }),
      evidence(skill, "Top match", truncate(media[0].title, 110), {
        source: src,
        confidence: "probable",
        kind: "artifact",
        detail: media[0].source,
      }),
      evidence(
        skill,
        "Download note",
        "YouTube streams are not rehosted or downloaded by this console",
        {
          source: src,
          kind: "warning",
          severity: "info",
          confidence: "confirmed",
          detail:
            "Downloading YouTube content needs the uploader's permission. For downloadable footage the Video footage skill searches licence-clear libraries instead.",
        },
      ),
    ];

    return retrievalTargetOutcome({
      status: "ok",
      summary: `${media.length} YouTube video(s) for “${query}” — playable in-app.`,
      evidence: evidenceItems,
      sources: [src],
      media,
    });
  },
};

/* -------------------------------------------------------- Google News ----- */

export const googleNewsSkill: SkillDefinition = {
  id: "news-google",
  name: "Latest news (Google News)",
  short: "News+",
  description:
    "Pulls the freshest reporting for your country (or any country you name) from Google News' own feeds, newest first, with the true publisher link for in-app reading.",
  category: "retrieval",
  runtime: "live",
  accepts: ["text"],
  produces: ["articles", "news"],
  keywords: NEWS_KEYWORDS,
  clientFallback: true,
  async run(target, ctx) {
    const skill = "news-google";
    const raw = target.value.trim();
    const topic = target.meta?.topic as NewsTopic | undefined;
    const country =
      target.meta?.country ?? target.meta?.region?.toLowerCase() ?? undefined;
    // "latest news", "top headlines today", "khabar" — these are asks for the
    // front page of the edition, not search queries. A real subject survives.
    const bareTopic = raw
      .replace(
        /\b(latest|top|breaking|today|today's|current|fresh|recent|aaj|ka|ke)\b/gi,
        " ",
      )
      .replace(
        /\b(news|headlines?|samachar|khabar|khabrein|updates?|kya|hai|me|in)\b/gi,
        " ",
      )
      .replace(/\s+/g, " ")
      .trim();
    const askQuery = bareTopic.length >= 3 ? bareTopic : undefined;

    // City/state scoping beats the country front page: "mumbai news" means
    // Mumbai, clearly labelled, not the India front page.
    const place = target.meta?.place
      ? detectPlaceInText(target.meta.place)
      : detectPlaceInText(raw);
    const scopeLabel = place ? labelOfPlace(place.place) : undefined;

    ctx.log(`Fetching ${scopeLabel ?? `${country ?? "world"} news`} feed`);

    const src = source(
      "google-news",
      `Google News — ${scopeLabel ?? `${country ?? "world"} edition`}`,
      "https://news.google.com",
      "dataset",
    );
    const result = await googleNews({
      topic,
      query: askQuery,
      countryCode: place?.place.country ?? country,
      place: place?.place,
      limit: Math.max(budget(target), 12),
      signal: ctx.signal,
    });

    // Second engine: when Google's feed will not come through, Bing News RSS
    // answers the same ask instead of the run dying with an unreachable step.
    let bingFallback: Awaited<ReturnType<typeof bingNewsSearch>> | undefined;
    if (result.articles.length === 0) {
      bingFallback = await bingNewsSearch({
        query: askQuery,
        countryCode: place?.place.country ?? country,
        limit: Math.max(budget(target), 12),
        signal: ctx.signal,
      });
    }

    if (result.articles.length === 0 && (bingFallback?.articles.length ?? 0) === 0) {
      return retrievalTargetOutcome({
        status: "unreachable",
        summary: `No news came back for the ${result.edition.label} edition.`,
        evidence: [
          evidence(skill, "Feed", "unreachable or empty", {
            source: src,
            kind: "warning",
            confidence: "unknown",
            detail:
              [result.error, bingFallback?.error].filter(Boolean).join(" · ") ||
              "both news engines returned no items",
          }),
        ],
        sources: [src],
        error: { code: "egress_blocked", message: result.error ?? "feed unreachable" },
      });
    }

    const finalArticles =
      result.articles.length > 0 ? result.articles : (bingFallback?.articles ?? []);
    const engineNote =
      result.articles.length > 0
        ? undefined
        : `Google's feed was unreachable — these came from Bing News instead (${bingFallback?.via ?? "relay"}).`;

    const newest = finalArticles.find((article) => article.publishedAt);
    const ageMinutes = newest?.publishedAt
      ? Math.round((Date.now() - newest.publishedAt) / 60000)
      : undefined;

    const evidenceItems: SkillOutcome["evidence"] = [
      evidence(
        skill,
        "Scope",
        place
          ? `${result.edition.flag} ${scopeLabel}`
          : `${result.edition.flag} ${result.edition.label} (${result.edition.ceid})`,
        {
          source: src,
          confidence: "confirmed",
          detail:
            "Say a city or state for local news (Mumbai, Maharashtra, New York…), or another country — it is remembered.",
        },
      ),
      evidence(skill, "Items", `${finalArticles.length} headline(s), newest first`, {
        source: src,
        detail:
          [
            ageMinutes !== undefined
              ? `Freshest item is about ${ageMinutes < 90 ? `${Math.max(ageMinutes, 1)} minute(s) old` : `${Math.round(ageMinutes / 60)} hour(s) old`}.`
              : undefined,
            engineNote,
          ]
            .filter(Boolean)
            .join(" ") || undefined,
      }),
      evidence(
        skill,
        "Reading",
        "Tap any headline to read it inside the console — or save it as a PDF",
        {
          source: src,
          kind: "record",
          confidence: "confirmed",
        },
      ),
    ];

    return retrievalTargetOutcome({
      status: "ok",
      summary: `${finalArticles.length} latest headline(s) for ${scopeLabel ?? result.edition.label}${askQuery ? ` on “${askQuery}”` : ""}.`,
      evidence: evidenceItems,
      sources: [src],
      articles: finalArticles,
    });
  },
};

/* ----------------------------------------------------------- open web ----- */

export type WebTaskMode = "general" | "papers" | "study" | "sites" | "offers" | "article";

const SHOPPING_HOSTS =
  /(amazon\.|flipkart\.|meesho\.|myntra\.|croma\.|reliancedigital\.|tatacliq\.|ajio\.|snapdeal\.|jiomart\.|ebay\.|aliexpress\.|shopclues\.|nykaa\.|besty\.| Vijay\.|vijaysales\.)/i;

function offersQueryTitle(html: string): { title?: string; image?: string } {
  const ogTitle =
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']{4,180})["']/i.exec(
      html,
    )?.[1] ?? /<title[^>]*>([^<]{4,200})<\/title>/i.exec(html)?.[1];
  const ogImage =
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i.exec(html)?.[1];
  return {
    title: ogTitle
      ?.replace(
        /\s*[:|\-–]\s*(?:Amazon\.in|Flipkart\.com|Buy Online.*|Best Price.*).*$/i,
        "",
      )
      .trim(),
    image: ogImage,
  };
}

function webResultToArticle(result: WebResult, _mode?: WebTaskMode): ArticleItem {
  return {
    id: newId("ow"),
    title: result.title,
    url: result.url,
    domain: result.host,
    source: result.host,
    snippet: result.snippet || undefined,
    query: result.title,
    syndicated: false,
  };
}

export const openWebSkill: SkillDefinition = {
  id: "open-web",
  name: "Open web search",
  short: "Web",
  description:
    "Searches the open web (DuckDuckGo/Bing, no key) for exactly what was asked: specimen and sample papers as downloadable PDFs, study material, good websites — even fresh ones hosted on Vercel or Netlify — and lower prices for a product link.",
  category: "retrieval",
  runtime: "live",
  accepts: ["text", "url"],
  produces: ["results", "pdfs", "offers"],
  keywords: [
    "specimen paper",
    "sample paper",
    "question paper",
    "model paper",
    "previous year",
    "pyq",
    "study material",
    "notes",
    "worksheet",
    "syllabus",
    "websites",
    "website",
    "sites",
    "alternatives",
    "cheaper",
    "lowest price",
    "price",
    "compare",
    "deal",
    "find websites",
    "free websites",
    "good websites",
    "resources",
    "search the web",
    "google it",
    "google this",
  ],
  clientFallback: true,
  async run(target, ctx) {
    const skill = "open-web";
    const mode = (target.meta?.webTask as WebTaskMode | undefined) ?? "general";
    const raw = queryOf(target);
    const limit = Math.max(budget(target), 10);

    const engineSrc = source(
      "open-web",
      "Open web (DuckDuckGo / Bing)",
      "https://duckduckgo.com",
      "dataset",
    );
    const evidenceItems: SkillOutcome["evidence"] = [];
    const queries: string[] = [];
    let articles: ArticleItem[] = [];

    if (mode === "offers") {
      // A product ask: resolve the product's real title first, then hunt offers.
      let productTitle = raw;
      let productSource = "the ask";
      const url = /^(https?:\/\/)/.test(target.value) ? target.value : undefined;
      if (url) {
        ctx.log(`Reading the product page to get its exact title`);
        const page = await relayText(url, {
          skipDirect: true,
          signal: ctx.signal,
          timeoutMs: 18_000,
        });
        if (isRelayOk(page)) {
          const parsed = offersQueryTitle(page.data);
          if (parsed.title && parsed.title.length > 8) {
            productTitle = parsed.title;
            productSource = new URL(url).hostname;
          }
        } else {
          evidenceItems.push(
            evidence(
              skill,
              "Product page",
              "could not be read — using the link text as the product name",
              {
                source: engineSrc,
                kind: "warning",
                confidence: "unknown",
                detail:
                  "Some stores block automated reads; the offer hunt continues with what the link itself says.",
              },
            ),
          );
        }
      }

      const core = productTitle
        .replace(/\((?:[^)]{0,60})\)/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const offerQuery = `"${core.slice(0, 80)}" (buy OR price OR online)`;
      queries.push(offerQuery);
      ctx.log(`Hunting offers: ${offerQuery}`);
      const found = await webSearch(offerQuery, { limit: limit + 6, signal: ctx.signal });
      const knownStores = found.results.filter((result) =>
        SHOPPING_HOSTS.test(result.host),
      );
      const otherListings = found.results
        .filter((result) => !SHOPPING_HOSTS.test(result.host))
        .slice(0, 8);
      articles = dedupeArticles(
        [...knownStores, ...otherListings].map((result) =>
          webResultToArticle(result, mode),
        ),
      );

      evidenceItems.push(
        evidence(skill, "Product", truncate(productTitle, 140), {
          source: engineSrc,
          confidence: productSource === "the ask" ? "possible" : "confirmed",
          kind: "artifact",
          detail: `Read from ${productSource}.`,
        }),
        evidence(
          skill,
          "Offer hunt",
          `${articles.length} listing(s) across ${new Set(articles.map((article) => article.domain)).size} store(s)`,
          {
            source: engineSrc,
            confidence: "probable",
            detail:
              "Open the listings to confirm the live price — stores change prices hourly and block automated price scraping, so nothing is quoted here that was not stated on the listing itself.",
          },
        ),
      );

      return retrievalTargetOutcome({
        status: articles.length > 0 ? "ok" : "unreachable",
        summary:
          articles.length > 0
            ? `${articles.length} offer listing(s) for “${truncate(productTitle, 60)}” — open each to compare live prices.`
            : `No offer listings found for “${truncate(productTitle, 60)}”.`,
        evidence: evidenceItems,
        sources: [engineSrc],
        articles,
        error:
          articles.length === 0 ? { code: "unknown", message: "no listings" } : undefined,
      });
    }

    if (mode === "papers") {
      queries.push(`${raw} filetype:pdf`);
      queries.push(`${raw} pdf download`);
    } else if (mode === "study") {
      queries.push(`${raw} study material notes`);
      queries.push(`${raw} explained summary`);
    } else if (mode === "sites") {
      queries.push(`best ${raw}`);
      queries.push(`${raw} site:vercel.app OR site:netlify.app OR site:github.io`);
    } else {
      queries.push(raw);
    }

    const structuredMode =
      mode === "papers" || mode === "study" || mode === "sites" ? mode : undefined;
    const collected: WebResult[] = [];
    // The engine queries are independent — run them at the same time. Papers
    // mode used to pay two full search latencies back to back, which alone
    // could blow the whole 30-second budget.
    const foundLists = await Promise.all(
      queries.map(async (query) => {
        ctx.log(`Searching: ${query}`);
        try {
          return await webSearch(query, { limit, signal: ctx.signal });
        } catch {
          return {
            results: [],
            engine: "none",
            error: "the search threw",
          } as WebSearchOutcome;
        }
      }),
    );
    for (const found of foundLists) {
      collected.push(...found.results);
      if (found.error) {
        evidenceItems.push(
          evidence(skill, "Engine", truncate(found.error, 160), {
            source: engineSrc,
            kind: "warning",
            confidence: "unknown",
          }),
        );
      }
    }

    const deduped = dedupeWebResults(collected);
    if (mode === "papers") {
      deduped.sort((a, b) => Number(looksLikePdf(b.url)) - Number(looksLikePdf(a.url)));
    }

    articles = dedupeArticles(
      deduped.map((result) => ({
        ...webResultToArticle(result, mode),
        ...(structuredMode
          ? { shelf: structuredMode as "papers" | "study" | "sites" }
          : {}),
      })),
    );

    const pdfCount = deduped.filter((result) => looksLikePdf(result.url)).length;
    if (deduped.length > 0) {
      evidenceItems.unshift(
        evidence(
          skill,
          "Results",
          `${deduped.length} link(s) for “${truncate(raw, 80)}”`,
          {
            source: engineSrc,
            confidence: "confirmed",
            detail:
              [
                mode === "papers"
                  ? `${pdfCount} direct PDF link(s) — open or download them in-app.`
                  : undefined,
                mode === "sites"
                  ? "Fresh personal projects on Vercel/Netlify/GitHub Pages are included when they exist."
                  : undefined,
              ]
                .filter(Boolean)
                .join(" ") || undefined,
          },
        ),
      );
      evidenceItems.push(
        evidence(skill, "Top result", truncate(deduped[0].title, 120), {
          source: engineSrc,
          kind: "artifact",
          confidence: "probable",
          detail: deduped[0].url,
        }),
      );
    }

    return retrievalTargetOutcome({
      status: deduped.length > 0 ? "ok" : "unreachable",
      summary:
        deduped.length > 0
          ? `${deduped.length} web result(s) for “${truncate(raw, 70)}”${pdfCount > 0 ? ` — ${pdfCount} PDF(s) downloadable in-app` : ""}.`
          : `The open web returned nothing for “${truncate(raw, 70)}”.`,
      evidence: evidenceItems,
      sources: [engineSrc],
      articles,
      error:
        deduped.length === 0
          ? { code: "egress_blocked", message: "no search route reached" }
          : undefined,
    });
  },
};

function dedupeWebResults(results: WebResult[]): WebResult[] {
  const seen = new Set<string>();
  const out: WebResult[] = [];
  for (const result of results) {
    const key = result.url.replace(/[#?].*$/, "");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(result);
  }
  return out;
}

function dedupeArticles(articles: ArticleItem[]): ArticleItem[] {
  const seen = new Set<string>();
  const out: ArticleItem[] = [];
  for (const article of articles) {
    const key = article.url.replace(/[#?].*$/, "");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(article);
  }
  return out;
}

/* -------------------------------------------------------- article reader -- */

export const articleReaderSkill: SkillDefinition = {
  id: "article-reader",
  name: "Read & summarise a link",
  short: "Read",
  description:
    "Opens a link, pulls the article text out of the page, and gives the key points — so anything on the web can be read (and saved as a clean PDF) without leaving the console.",
  category: "retrieval",
  runtime: "live",
  accepts: ["url", "text"],
  produces: ["article-text", "key-points"],
  keywords: [
    "summarise",
    "summarize",
    "summary",
    "tl;dr",
    "tldr",
    "key points",
    "read this",
    "open this",
    "read the article",
    "read this article",
    "what does this article",
    "explain this link",
    "article in app",
    "read link",
  ],
  clientFallback: true,
  async run(target, ctx) {
    const skill = "article-reader";
    const url = /^(https?:\/\/)/.test(target.value.trim())
      ? target.value.trim()
      : undefined;
    if (!url) {
      return retrievalTargetOutcome({
        status: "skipped",
        summary: "No link to read was found in the ask.",
        evidence: [
          evidence(skill, "Input", "no URL detected", {
            source: source("reader", "Article reader", undefined, "local"),
            kind: "warning",
          }),
        ],
        sources: [],
      });
    }

    ctx.log(`Reading ${truncate(url, 80)}`);
    const result = await readArticle(url, ctx.signal);
    const article = result.article;

    if (!article) {
      return retrievalTargetOutcome({
        status: "unreachable",
        summary: `The page could not be read: ${truncate(result.error ?? "unknown reason", 120)}`,
        evidence: [
          evidence(skill, "Read", result.error ?? "unreadable", {
            source: source("reader", hostLabel(url), url, "document"),
            kind: "warning",
            confidence: "unknown",
          }),
        ],
        sources: [source("reader", hostLabel(url), url, "document")],
        error: { code: "unknown", message: result.error ?? "unreadable" },
      });
    }

    const points = keyPointsOf(article, 4);
    const host = hostLabel(url);
    const readerSource = source("reader", `${host} — article text`, url, "document");

    const evidenceItems: SkillOutcome["evidence"] = [
      evidence(skill, "Article", article.title ?? host, {
        source: readerSource,
        confidence: "confirmed",
        kind: "artifact",
        detail: [
          article.byline ? `by ${article.byline}` : undefined,
          `${article.wordCount} words extracted`,
          article.paragraphs.length
            ? `${article.paragraphs.length} paragraph(s)`
            : undefined,
        ]
          .filter(Boolean)
          .join(" · "),
      }),
      ...points.map((point, index) =>
        evidence(skill, `Key point ${index + 1}`, truncate(point, 260), {
          source: readerSource,
          confidence: "confirmed",
          kind: "record",
        }),
      ),
      evidence(
        skill,
        "In-app reading",
        "The full article is available in the reader panel — save it as a clean PDF from there.",
        {
          source: readerSource,
          kind: "record",
          confidence: "confirmed",
        },
      ),
    ];

    const summary = [
      `**${article.title ?? host}**${article.byline ? ` — ${article.byline}` : ""}`,
      "",
      "Key points:",
      ...points.map((point) => `- ${point}`),
    ].join("\n");
    // surfaced verbatim as the step summary below

    return retrievalTargetOutcome({
      status: "ok",
      summary:
        summary.length > 0
          ? `Read ${truncate(article.title ?? host, 80)} (${article.wordCount} words) and pulled ${points.length} key point(s).`
          : "read",
      evidence: evidenceItems,
      sources: [readerSource],
      articles: [
        {
          id: newId("ar"),
          title: article.title ?? host,
          url,
          domain: host,
          source: host,
          snippet: truncate(points[0] ?? article.paragraphs[0] ?? "", 240),
          publishedAt: article.publishedAt,
        },
      ],
    });
  },
};

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "link";
  }
}

export const webSkills: SkillDefinition[] = [
  saavnMusic,
  youtubeVideo,
  googleNewsSkill,
  openWebSkill,
  articleReaderSkill,
];

// The keyword groups are imported from the retrieval module so the planner's
// intent detection and these skills stay in lockstep.
