import { concurrency, request, source } from "@/lib/net/http";
import { evidence } from "@/lib/skills/emit";
import type {
  ArticleItem,
  MediaItem,
  NetContext,
  SkillDefinition,
  SkillOutcome,
  SourceRef,
} from "@/lib/types";
import { newId, truncate } from "@/lib/utils";

/**
 * Retrieval skills: they go and find something — images, footage, articles,
 * news — across free, documented, licence-carrying sources, and they hand back
 * direct asset URLs with the attribution that licence requires.
 *
 * Two rules hold everywhere in this file:
 *   1. A result is only returned with the licence and author the source states.
 *      When a source does not state one, the item says so instead of guessing.
 *   2. Keyed sources (Pexels, Pixabay, Unsplash) extend coverage when a key is
 *      present; their absence never turns into a fabricated result.
 */

const MAX_PER_SOURCE_CAP = 24;

function budget(target: { meta?: Record<string, string> }): number {
  const requested = Number(target.meta?.perSource ?? "8");
  if (!Number.isFinite(requested)) {
    return 8;
  }
  return Math.min(MAX_PER_SOURCE_CAP, Math.max(3, Math.round(requested)));
}

function reusableOnly(target: { meta?: Record<string, string> }): boolean {
  return target.meta?.licence !== "any";
}

function queryOf(target: { value: string; meta?: Record<string, string> }): string {
  const fromMeta = target.meta?.query?.trim();
  return (fromMeta && fromMeta.length > 1 ? fromMeta : target.value).trim();
}

function stripHtml(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function mediaItem(input: Omit<MediaItem, "id">): MediaItem {
  return { id: newId("md"), ...input };
}

function articleItem(input: Omit<ArticleItem, "id">): ArticleItem {
  return { id: newId("ar"), ...input };
}

function timeOf(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const stamp = Date.parse(value);
  return Number.isNaN(stamp) ? undefined : stamp;
}

/** Internet Archive lengths arrive as seconds or h:mm:ss. */
function durationOf(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  if (/^\d+(\.\d+)?$/.test(value)) {
    return Math.round(Number(value) * 1000);
  }
  const parts = value.split(":").map((part) => Number(part));
  if (parts.some((part) => Number.isNaN(part))) {
    return undefined;
  }
  const seconds = parts.reduce((total, part) => total * 60 + part, 0);
  return Math.round(seconds * 1000);
}

/* ------------------------------------------------------------------ Commons */

interface CommonsExtMeta {
  value?: string;
}

interface CommonsImageInfo {
  url?: string;
  thumburl?: string;
  descriptionurl?: string;
  mime?: string;
  width?: number;
  height?: number;
  size?: number;
  duration?: number;
  user?: string;
  extmetadata?: Record<string, CommonsExtMeta>;
}

interface CommonsResponse {
  query?: {
    pages?: Record<string, { title?: string; imageinfo?: CommonsImageInfo[] }>;
  };
}

const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const COMMONS_SOURCE = {
  id: "commons",
  label: "Wikimedia Commons",
  url: "https://commons.wikimedia.org/",
} as const;

function commonsSource(): SourceRef {
  return source(COMMONS_SOURCE.id, COMMONS_SOURCE.label, COMMONS_SOURCE.url, "dataset");
}

async function commonsSearch(
  query: string,
  kind: "image" | "video" | "audio",
  limit: number,
  ctx: NetContext,
): Promise<{ items: MediaItem[]; error?: string }> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    origin: "*",
    generator: "search",
    gsrsearch: `${
      kind === "image"
        ? "filetype:bitmap"
        : kind === "video"
          ? "filetype:video"
          : "filetype:audio"
    } ${query}`,
    gsrnamespace: "6",
    gsrlimit: String(limit),
    prop: "imageinfo",
    iiprop: "url|size|mime|extmetadata|user|dimensions",
    iiurlwidth: "640",
  });

  const result = await request<CommonsResponse>(
    `${COMMONS_API}?${params.toString()}`,
    ctx,
    { timeoutMs: 9000, retries: 0 },
  );
  if (!result.ok) {
    return { items: [], error: result.error.message };
  }

  const pages = Object.values(result.data.query?.pages ?? {});
  const items: MediaItem[] = [];
  for (const page of pages) {
    const info = page.imageinfo?.[0];
    if (!info?.url) {
      continue;
    }
    const meta = info.extmetadata ?? {};
    const title =
      stripHtml(meta.ImageDescription?.value) ??
      (page.title ?? "").replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, "");
    items.push(
      mediaItem({
        kind,
        title: truncate(title || "Untitled file", 140),
        url: info.url,
        thumbnailUrl: info.thumburl ?? info.url,
        pageUrl: info.descriptionurl,
        source: COMMONS_SOURCE.label,
        sourceId: COMMONS_SOURCE.id,
        licence:
          stripHtml(meta.LicenseShortName?.value) ?? "Wikimedia Commons free licence",
        licenceUrl: stripHtml(meta.LicenseUrl?.value),
        author: stripHtml(meta.Artist?.value) ?? info.user,
        width: info.width,
        height: info.height,
        durationMs: info.duration ? Math.round(info.duration * 1000) : undefined,
        bytes: info.size,
        mime: info.mime,
        publishedAt: timeOf(meta.DateTimeOriginal?.value),
        query,
      }),
    );
  }
  return { items };
}

/** Commons stores files under their content hash, so a SHA-1 hit is a real match. */
async function commonsBySha1(
  sha1Hex: string,
  ctx: NetContext,
): Promise<MediaItem | undefined> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    origin: "*",
    list: "allimages",
    aisha1: sha1Hex,
    ailimit: "3",
    aiprop: "url|size|mime|extmetadata|user",
  });
  const result = await request<{
    query?: { allimages?: Array<CommonsImageInfo & { name?: string }> };
  }>(`${COMMONS_API}?${params.toString()}`, ctx, { timeoutMs: 8000, retries: 0 });
  if (!result.ok) {
    return undefined;
  }
  const hit = result.data.query?.allimages?.[0];
  if (!hit?.url) {
    return undefined;
  }
  const meta = hit.extmetadata ?? {};
  return mediaItem({
    kind: hit.mime?.startsWith("video") ? "video" : "image",
    title: hit.name ?? "Commons file",
    url: hit.url,
    thumbnailUrl: hit.url,
    pageUrl: hit.descriptionurl,
    source: COMMONS_SOURCE.label,
    sourceId: COMMONS_SOURCE.id,
    licence: stripHtml(meta.LicenseShortName?.value) ?? "Wikimedia Commons free licence",
    licenceUrl: stripHtml(meta.LicenseUrl?.value),
    author: stripHtml(meta.Artist?.value) ?? hit.user,
    width: hit.width,
    height: hit.height,
    bytes: hit.size,
    mime: hit.mime,
  });
}

/* ---------------------------------------------------------------- Openverse */

interface OpenverseResponse {
  results?: Array<{
    id?: string;
    title?: string;
    url?: string;
    thumbnail?: string;
    creator?: string;
    license?: string;
    license_version?: string;
    license_url?: string;
    foreign_landing_url?: string;
    width?: number;
    height?: number;
    filesize?: number;
    source?: string;
    mature?: boolean;
    attribution?: string;
  }>;
}

const OPENVERSE_SOURCE = {
  id: "openverse",
  label: "Openverse",
  url: "https://openverse.org/",
} as const;

function openverseSource(): SourceRef {
  return source(
    OPENVERSE_SOURCE.id,
    OPENVERSE_SOURCE.label,
    OPENVERSE_SOURCE.url,
    "dataset",
  );
}

async function openverseSearch(
  query: string,
  limit: number,
  reusable: boolean,
  language: string | undefined,
  ctx: NetContext,
): Promise<{ items: MediaItem[]; error?: string }> {
  const params = new URLSearchParams({
    q: query,
    page_size: String(Math.min(20, limit)),
  });
  if (reusable) {
    params.set("license_type", "commercial");
  }
  if (language) {
    params.set("language", language);
  }

  const result = await request<OpenverseResponse>(
    `https://api.openverse.org/v1/images/?${params.toString()}`,
    ctx,
    { timeoutMs: 9000, retries: 0 },
  );
  if (!result.ok) {
    return { items: [], error: result.error.message };
  }

  const items: MediaItem[] = [];
  for (const hit of result.data.results ?? []) {
    if (!hit.url) {
      continue;
    }
    const licence = [hit.license?.toUpperCase(), hit.license_version]
      .filter(Boolean)
      .join(" ");
    items.push(
      mediaItem({
        kind: "image",
        title: truncate(stripHtml(hit.title) || "Untitled image", 140),
        url: hit.url,
        thumbnailUrl: hit.thumbnail ?? hit.url,
        pageUrl: hit.foreign_landing_url,
        source: `Openverse · ${hit.source ?? "aggregated"}`,
        sourceId: OPENVERSE_SOURCE.id,
        licence: licence || "Creative Commons",
        licenceUrl: hit.license_url,
        author: hit.creator,
        width: hit.width,
        height: hit.height,
        bytes: hit.filesize,
        query,
      }),
    );
  }
  return { items };
}

/* -------------------------------------------------------------- NASA imagery */

const NASA_SOURCE = {
  id: "nasa",
  label: "NASA Image and Video Library",
  url: "https://images.nasa.gov/",
} as const;

function nasaSource(): SourceRef {
  return source(NASA_SOURCE.id, NASA_SOURCE.label, NASA_SOURCE.url, "dataset");
}

interface NasaResponse {
  collection?: {
    items?: Array<{
      href?: string;
      data?: Array<{
        nasa_id?: string;
        title?: string;
        description?: string;
        date_created?: string;
        media_type?: string;
        center?: string;
      }>;
      links?: Array<{ href?: string; rel?: string }>;
    }>;
  };
}

async function nasaAssetUrl(
  nasaId: string,
  ctx: NetContext,
): Promise<string | undefined> {
  const result = await request<{ collection?: { items?: Array<{ href?: string }> } }>(
    `https://images-api.nasa.gov/asset/${encodeURIComponent(nasaId)}`,
    ctx,
    { timeoutMs: 8000, retries: 0 },
  );
  if (!result.ok) {
    return undefined;
  }
  const hrefs = (result.data.collection?.items ?? [])
    .map((item) => item.href)
    .filter((href): href is string => Boolean(href));
  return (
    hrefs.find((href) => /~orig\.(mp4|jpg|png|webm)$/i.test(href)) ??
    hrefs.find((href) => /\.(mp4|webm)$/i.test(href)) ??
    hrefs.find((href) => /~(large|medium|orig)\.(jpg|png)$/i.test(href)) ??
    hrefs[0]
  );
}

async function nasaSearch(
  query: string,
  kind: "image" | "video",
  limit: number,
  ctx: NetContext,
): Promise<{ items: MediaItem[]; error?: string }> {
  const params = new URLSearchParams({
    q: query,
    media_type: kind,
    page_size: String(Math.min(20, limit)),
  });
  const result = await request<NasaResponse>(
    `https://images-api.nasa.gov/search?${params.toString()}`,
    ctx,
    { timeoutMs: 9000, retries: 0 },
  );
  if (!result.ok) {
    return { items: [], error: result.error.message };
  }

  const raw = (result.data.collection?.items ?? []).slice(0, limit);
  const resolved = await concurrency(raw, 3, async (item) => {
    const data = item.data?.[0];
    if (!data) {
      return undefined;
    }
    const preview = item.links?.find((link) => link.rel === "preview")?.href;
    const thumbnail = preview ?? item.links?.[0]?.href;
    let url = thumbnail;
    if (kind === "video" && data.nasa_id) {
      url = (await nasaAssetUrl(data.nasa_id, ctx)) ?? thumbnail;
    } else if (thumbnail) {
      // NASA asset names carry a size token: upgrade the preview for a usable file.
      url = thumbnail.replace(/~thumb\.(jpg|png)$/i, "~medium.$1");
    }
    if (!url) {
      return undefined;
    }
    return mediaItem({
      kind,
      title: truncate(stripHtml(data.title) || "NASA asset", 140),
      url,
      thumbnailUrl: thumbnail,
      pageUrl: data.nasa_id
        ? `https://images.nasa.gov/details-${encodeURIComponent(data.nasa_id)}`
        : undefined,
      source: NASA_SOURCE.label,
      sourceId: NASA_SOURCE.id,
      licence: "NASA media — generally not copyrighted, verify usage guidelines",
      licenceUrl: "https://www.nasa.gov/nasa-brand-center/images-and-media/",
      author: data.center ?? "NASA",
      publishedAt: timeOf(data.date_created),
      query,
    });
  });
  return { items: resolved.filter((item): item is MediaItem => Boolean(item)) };
}

/* --------------------------------------------------------- Internet Archive */

const ARCHIVE_SOURCE = {
  id: "archive-org",
  label: "Internet Archive",
  url: "https://archive.org/",
} as const;

function archiveSource(): SourceRef {
  return source(ARCHIVE_SOURCE.id, ARCHIVE_SOURCE.label, ARCHIVE_SOURCE.url, "archive");
}

interface ArchiveSearchResponse {
  response?: {
    docs?: Array<{
      identifier?: string;
      title?: string;
      description?: string;
      licenseurl?: string;
      year?: string | number;
      date?: string;
      creator?: string | string[];
    }>;
  };
}

interface ArchiveMetadata {
  files?: Array<{
    name?: string;
    format?: string;
    size?: string;
    length?: string;
    source?: string;
  }>;
}

async function archiveVideoSearch(
  query: string,
  limit: number,
  ctx: NetContext,
): Promise<{ items: MediaItem[]; error?: string }> {
  const params = new URLSearchParams({
    q: `${query} AND mediatype:movies`,
    rows: String(limit),
    page: "1",
    output: "json",
  });
  for (const field of [
    "identifier",
    "title",
    "description",
    "licenseurl",
    "year",
    "date",
    "creator",
  ]) {
    params.append("fl[]", field);
  }

  const result = await request<ArchiveSearchResponse>(
    `https://archive.org/advancedsearch.php?${params.toString()}`,
    ctx,
    { timeoutMs: 10000, retries: 0 },
  );
  if (!result.ok) {
    return { items: [], error: result.error.message };
  }

  const docs = (result.data.response?.docs ?? []).filter(
    (doc): doc is { identifier: string } & typeof doc => Boolean(doc.identifier),
  );
  const items = await concurrency(docs, 4, async (doc) => {
    const metadata = await request<ArchiveMetadata>(
      `https://archive.org/metadata/${encodeURIComponent(doc.identifier)}`,
      ctx,
      { timeoutMs: 8000, retries: 0 },
    );
    if (!metadata.ok) {
      return undefined;
    }
    const files = (metadata.data.files ?? []).filter(
      (file) => file.name && /\.(mp4|webm|ogv|m4v)$/i.test(file.name),
    );
    const file = files.find((candidate) => candidate.source === "original") ?? files[0];
    if (!file?.name) {
      return undefined;
    }
    return mediaItem({
      kind: "video",
      title: truncate(stripHtml(doc.title) || doc.identifier, 140),
      url: `https://archive.org/download/${encodeURIComponent(doc.identifier)}/${encodeURIComponent(file.name)}`,
      thumbnailUrl: `https://archive.org/services/img/${encodeURIComponent(doc.identifier)}`,
      pageUrl: `https://archive.org/details/${encodeURIComponent(doc.identifier)}`,
      source: ARCHIVE_SOURCE.label,
      sourceId: ARCHIVE_SOURCE.id,
      licence: doc.licenseurl
        ? `Item licence: ${doc.licenseurl}`
        : "No licence stated on the item — check the item page before reuse",
      licenceUrl: doc.licenseurl,
      author: Array.isArray(doc.creator) ? doc.creator.join(", ") : doc.creator,
      durationMs: durationOf(file.length),
      bytes: file.size ? Number(file.size) : undefined,
      mime: file.format,
      publishedAt: timeOf(doc.date ?? String(doc.year ?? "")),
      query,
    });
  });

  return { items: items.filter((item): item is MediaItem => Boolean(item)) };
}

/* ------------------------------------------------------- Keyed stock sources */

function pexelsSource(): SourceRef {
  return source("pexels", "Pexels", "https://www.pexels.com/", "dataset");
}

interface PexelsPhoto {
  id?: number;
  width?: number;
  height?: number;
  url?: string;
  photographer?: string;
  alt?: string;
  src?: Record<string, string>;
}

interface PexelsVideo {
  id?: number;
  width?: number;
  height?: number;
  url?: string;
  duration?: number;
  image?: string;
  user?: { name?: string };
  video_files?: Array<{
    link?: string;
    quality?: string;
    file_type?: string;
    width?: number;
  }>;
}

async function pexelsSearch(
  query: string,
  kind: "image" | "video",
  limit: number,
  key: string,
  ctx: NetContext,
): Promise<{ items: MediaItem[]; error?: string }> {
  const params = new URLSearchParams({
    query,
    per_page: String(Math.min(24, Math.max(3, limit))),
  });
  const endpoint =
    kind === "image"
      ? `https://api.pexels.com/v1/search?${params.toString()}`
      : `https://api.pexels.com/videos/search?${params.toString()}`;
  const result = await request<{ photos?: PexelsPhoto[]; videos?: PexelsVideo[] }>(
    endpoint,
    ctx,
    { timeoutMs: 9000, retries: 0, headers: { authorization: key } },
  );
  if (!result.ok) {
    return { items: [], error: result.error.message };
  }

  if (kind === "image") {
    return {
      items: (result.data.photos ?? []).flatMap((hit) => {
        const url = hit.src?.original ?? hit.src?.large2x ?? hit.src?.large;
        if (!url) {
          return [];
        }
        return [
          mediaItem({
            kind: "image",
            title: truncate(hit.alt || `Pexels photo ${hit.id ?? ""}`, 140),
            url,
            thumbnailUrl: hit.src?.medium ?? hit.src?.small ?? url,
            pageUrl: hit.url,
            source: "Pexels",
            sourceId: "pexels",
            licence: "Pexels License — free for commercial use, no attribution required",
            licenceUrl: "https://www.pexels.com/license/",
            author: hit.photographer,
            width: hit.width,
            height: hit.height,
            query,
          }),
        ];
      }),
    };
  }

  return {
    items: (result.data.videos ?? []).flatMap((hit) => {
      const file =
        hit.video_files?.find(
          (item) => item.quality === "hd" && item.file_type === "video/mp4",
        ) ??
        hit.video_files?.find((item) => item.file_type === "video/mp4") ??
        hit.video_files?.[0];
      if (!file?.link) {
        return [];
      }
      return [
        mediaItem({
          kind: "video",
          title: truncate(`Pexels clip ${hit.id ?? ""}`, 140),
          url: file.link,
          thumbnailUrl: hit.image,
          pageUrl: hit.url,
          source: "Pexels",
          sourceId: "pexels",
          licence: "Pexels License — free for commercial use, no attribution required",
          licenceUrl: "https://www.pexels.com/license/",
          author: hit.user?.name,
          width: hit.width,
          height: hit.height,
          durationMs: hit.duration ? hit.duration * 1000 : undefined,
          mime: file.file_type,
          query,
        }),
      ];
    }),
  };
}

function pixabaySource(): SourceRef {
  return source("pixabay", "Pixabay", "https://pixabay.com/", "dataset");
}

interface PixabayImage {
  id?: number;
  pageURL?: string;
  largeImageURL?: string;
  webformatURL?: string;
  imageWidth?: number;
  imageHeight?: number;
  user?: string;
  tags?: string;
}

interface PixabayVideo {
  id?: number;
  pageURL?: string;
  duration?: number;
  picture_id?: string;
  user?: string;
  tags?: string;
  videos?: Record<
    string,
    { url?: string; width?: number; height?: number; size?: number }
  >;
}

async function pixabaySearch(
  query: string,
  kind: "image" | "video",
  limit: number,
  key: string,
  ctx: NetContext,
): Promise<{ items: MediaItem[]; error?: string }> {
  const params = new URLSearchParams({
    key,
    q: query,
    per_page: String(Math.min(24, Math.max(3, limit))),
    safesearch: "true",
  });
  if (kind === "image") {
    params.set("image_type", "photo");
  }
  const endpoint =
    kind === "image"
      ? `https://pixabay.com/api/?${params.toString()}`
      : `https://pixabay.com/api/videos/?${params.toString()}`;

  const result = await request<{ hits?: Array<PixabayImage & PixabayVideo> }>(
    endpoint,
    ctx,
    {
      timeoutMs: 9000,
      retries: 0,
    },
  );
  if (!result.ok) {
    return { items: [], error: result.error.message };
  }

  const items = (result.data.hits ?? []).flatMap((hit) => {
    if (kind === "image") {
      const url = hit.largeImageURL ?? hit.webformatURL;
      if (!url) {
        return [];
      }
      return [
        mediaItem({
          kind: "image",
          title: truncate(hit.tags || `Pixabay photo ${hit.id ?? ""}`, 140),
          url,
          thumbnailUrl: hit.webformatURL ?? url,
          pageUrl: hit.pageURL,
          source: "Pixabay",
          sourceId: "pixabay",
          licence:
            "Pixabay Content License — free for commercial use, no attribution required",
          licenceUrl: "https://pixabay.com/service/license-summary/",
          author: hit.user,
          width: hit.imageWidth,
          height: hit.imageHeight,
          query,
        }),
      ];
    }
    const file = hit.videos?.large ?? hit.videos?.medium ?? hit.videos?.small;
    if (!file?.url) {
      return [];
    }
    return [
      mediaItem({
        kind: "video",
        title: truncate(hit.tags || `Pixabay clip ${hit.id ?? ""}`, 140),
        url: file.url,
        thumbnailUrl: hit.picture_id
          ? `https://i.vimeocdn.com/video/${hit.picture_id}_640x360.jpg`
          : undefined,
        pageUrl: hit.pageURL,
        source: "Pixabay",
        sourceId: "pixabay",
        licence:
          "Pixabay Content License — free for commercial use, no attribution required",
        licenceUrl: "https://pixabay.com/service/license-summary/",
        author: hit.user,
        width: file.width,
        height: file.height,
        bytes: file.size,
        durationMs: hit.duration ? hit.duration * 1000 : undefined,
        query,
      }),
    ];
  });

  return { items };
}

function unsplashSource(): SourceRef {
  return source("unsplash", "Unsplash", "https://unsplash.com/", "dataset");
}

interface UnsplashResponse {
  results?: Array<{
    id?: string;
    alt_description?: string;
    description?: string;
    width?: number;
    height?: number;
    links?: { html?: string };
    urls?: { raw?: string; full?: string; regular?: string; small?: string };
    user?: { name?: string; links?: { html?: string } };
  }>;
}

async function unsplashSearch(
  query: string,
  limit: number,
  key: string,
  ctx: NetContext,
): Promise<{ items: MediaItem[]; error?: string }> {
  const params = new URLSearchParams({
    query,
    per_page: String(Math.min(24, Math.max(3, limit))),
  });
  const result = await request<UnsplashResponse>(
    `https://api.unsplash.com/search/photos?${params.toString()}`,
    ctx,
    { timeoutMs: 9000, retries: 0, headers: { authorization: `Client-ID ${key}` } },
  );
  if (!result.ok) {
    return { items: [], error: result.error.message };
  }

  return {
    items: (result.data.results ?? []).flatMap((hit) => {
      const url = hit.urls?.full ?? hit.urls?.regular;
      if (!url) {
        return [];
      }
      return [
        mediaItem({
          kind: "image",
          title: truncate(
            hit.description ?? hit.alt_description ?? "Unsplash photo",
            140,
          ),
          url,
          thumbnailUrl: hit.urls?.small ?? url,
          pageUrl: hit.links?.html,
          source: "Unsplash",
          sourceId: "unsplash",
          licence: "Unsplash License — free to use, attribution appreciated",
          licenceUrl: "https://unsplash.com/license",
          author: hit.user?.name,
          width: hit.width,
          height: hit.height,
          query,
        }),
      ];
    }),
  };
}

/* --------------------------------------------------------------------- News */

const GDELT_SOURCE = {
  id: "gdelt",
  label: "GDELT news index",
  url: "https://www.gdeltproject.org/",
} as const;

function gdeltSource(): SourceRef {
  return source(GDELT_SOURCE.id, GDELT_SOURCE.label, GDELT_SOURCE.url, "dataset");
}

const HN_SOURCE = {
  id: "hn-algolia",
  label: "Hacker News (Algolia)",
  url: "https://hn.algolia.com/",
} as const;

function hnSource(): SourceRef {
  return source(HN_SOURCE.id, HN_SOURCE.label, HN_SOURCE.url, "dataset");
}

const WIKI_SOURCE = {
  id: "wikipedia",
  label: "Wikipedia",
  url: "https://www.wikipedia.org/",
} as const;

function wikiSource(): SourceRef {
  return source(WIKI_SOURCE.id, WIKI_SOURCE.label, WIKI_SOURCE.url, "dataset");
}

const LANGUAGE_NAMES: Record<string, string> = {
  en: "english",
  hi: "hindi",
  mr: "marathi",
  ta: "tamil",
  te: "telugu",
  bn: "bengali",
  gu: "gujarati",
  kn: "kannada",
  ml: "malayalam",
};

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

function gdeltSeen(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!match) {
    return undefined;
  }
  const [, year, month, day, hour, minute, second] = match;
  return Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
}

interface GdeltResponse {
  articles?: Array<{
    url?: string;
    title?: string;
    seendate?: string;
    socialimage?: string;
    domain?: string;
    language?: string;
    sourcecountry?: string;
  }>;
}

async function gdeltSearch(
  query: string,
  limit: number,
  options: { language?: string; region?: string; timespan: string },
  ctx: NetContext,
): Promise<{ items: ArticleItem[]; error?: string }> {
  const operators = [`"${query.replace(/"/g, "")}"`];
  const languageName = options.language ? LANGUAGE_NAMES[options.language] : undefined;
  if (languageName) {
    operators.push(`sourcelang:${languageName}`);
  }
  if (options.region && /^[A-Z]{2}$/.test(options.region)) {
    operators.push(`sourcecountry:${options.region}`);
  }

  const params = new URLSearchParams({
    query: operators.join(" "),
    mode: "ArtList",
    format: "json",
    maxrecords: String(Math.min(75, Math.max(5, limit * 3))),
    sort: "DateDesc",
    timespan: options.timespan,
  });

  const result = await request<GdeltResponse>(
    `https://api.gdeltproject.org/api/v2/doc/doc?${params.toString()}`,
    ctx,
    { timeoutMs: 10000, retries: 0 },
  );
  if (!result.ok) {
    return { items: [], error: result.error.message };
  }

  const items = (result.data.articles ?? []).flatMap((hit) => {
    if (!hit.url || !hit.title) {
      return [];
    }
    return [
      articleItem({
        title: truncate(stripHtml(hit.title) ?? hit.title, 180),
        url: hit.url,
        domain: hit.domain ?? domainOf(hit.url),
        source: GDELT_SOURCE.label,
        sourceId: GDELT_SOURCE.id,
        publishedAt: gdeltSeen(hit.seendate),
        language: hit.language,
        country: hit.sourcecountry,
        imageUrl: hit.socialimage,
        query,
      }),
    ];
  });
  return { items };
}

async function hnSearch(
  query: string,
  limit: number,
  ctx: NetContext,
): Promise<{ items: ArticleItem[]; error?: string }> {
  const params = new URLSearchParams({
    query,
    tags: "story",
    hitsPerPage: String(Math.min(20, limit)),
  });
  const result = await request<{
    hits?: Array<{
      objectID?: string;
      title?: string;
      url?: string;
      story_text?: string;
      created_at_i?: number;
      points?: number;
      num_comments?: number;
    }>;
  }>(`https://hn.algolia.com/api/v1/search?${params.toString()}`, ctx, {
    timeoutMs: 9000,
    retries: 0,
  });
  if (!result.ok) {
    return { items: [], error: result.error.message };
  }

  return {
    items: (result.data.hits ?? []).flatMap((hit) => {
      if (!hit.title || !hit.objectID) {
        return [];
      }
      const url = hit.url?.startsWith("http")
        ? hit.url
        : `https://news.ycombinator.com/item?id=${hit.objectID}`;
      return [
        articleItem({
          title: truncate(stripHtml(hit.title) ?? hit.title, 180),
          url,
          domain: hit.url ? domainOf(hit.url) : "news.ycombinator.com",
          source: HN_SOURCE.label,
          sourceId: HN_SOURCE.id,
          snippet: hit.story_text
            ? truncate(stripHtml(hit.story_text) ?? "", 240)
            : undefined,
          publishedAt: hit.created_at_i ? hit.created_at_i * 1000 : undefined,
          query,
        }),
      ];
    }),
  };
}

async function wikipediaContext(
  query: string,
  language: string | undefined,
  ctx: NetContext,
): Promise<{ items: ArticleItem[]; error?: string }> {
  const lang = language && /^[a-z]{2}$/.test(language) ? language : "en";
  const searchParams = new URLSearchParams({
    action: "query",
    format: "json",
    origin: "*",
    list: "search",
    srsearch: query,
    srlimit: "2",
  });
  const found = await request<{
    query?: { search?: Array<{ title?: string; snippet?: string }> };
  }>(`https://${lang}.wikipedia.org/w/api.php?${searchParams.toString()}`, ctx, {
    timeoutMs: 9000,
    retries: 0,
  });
  if (!found.ok) {
    return { items: [], error: found.error.message };
  }

  const hits = (found.data.query?.search ?? []).slice(0, 2);
  return {
    items: hits.flatMap((hit) => {
      if (!hit.title) {
        return [];
      }
      return [
        articleItem({
          title: hit.title,
          url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(hit.title.replace(/\s/g, "_"))}`,
          domain: `${lang}.wikipedia.org`,
          source: WIKI_SOURCE.label,
          sourceId: WIKI_SOURCE.id,
          snippet: truncate(stripHtml(hit.snippet) ?? "", 240),
          language: lang,
          query,
        }),
      ];
    }),
  };
}

/* ------------------------------------------------------ Story corroboration */

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "to",
  "in",
  "on",
  "for",
  "with",
  "at",
  "by",
  "from",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "has",
  "have",
  "had",
  "it",
  "its",
  "this",
  "that",
  "these",
  "those",
  "as",
  "after",
  "over",
  "under",
  "new",
  "says",
  "say",
  "said",
  "will",
  "would",
  "not",
  "but",
  "about",
  "into",
  "amid",
  "more",
  "than",
  "then",
  "how",
  "why",
  "what",
  "who",
  "when",
  "where",
  "his",
  "her",
  "their",
  "they",
  "you",
  "your",
  "we",
  "our",
  "may",
  "can",
  "could",
  "should",
  "also",
  "just",
  "up",
  "out",
  "off",
  "now",
  "one",
  "two",
  "first",
  "last",
  "day",
  "days",
  "year",
  "years",
  "news",
]);

function titleTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 2 && !STOP_WORDS.has(token)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) {
    return 0;
  }
  let shared = 0;
  for (const token of a) {
    if (b.has(token)) {
      shared += 1;
    }
  }
  return shared / (a.size + b.size - shared);
}

/**
 * Groups articles that describe the same story and counts how many *distinct
 * domains* carry it. Two independent domains is corroboration; one is a single
 * source, and the briefing says which is which.
 */
export function corroborate(articles: ArticleItem[]): {
  articles: ArticleItem[];
  clusters: number;
  multiSource: number;
  singleSource: number;
  domains: string[];
} {
  const clusters: Array<{ tokens: Set<string>; members: ArticleItem[] }> = [];

  for (const article of articles) {
    const tokens = titleTokens(article.title);
    const match = clusters.find((cluster) => jaccard(cluster.tokens, tokens) >= 0.6);
    if (match) {
      match.members.push(article);
    } else {
      clusters.push({ tokens, members: [article] });
    }
  }

  const domains = Array.from(new Set(articles.map((article) => article.domain)));
  let multiSource = 0;
  let singleSource = 0;
  const enriched = articles.map((article) => ({ ...article }));

  for (const cluster of clusters) {
    const clusterDomains = Array.from(
      new Set(cluster.members.map((member) => member.domain)),
    );
    const titles = new Set(
      cluster.members.map((member) => member.title.toLowerCase().replace(/\s+/g, " ")),
    );
    const syndicated = clusterDomains.length >= 3 && titles.size < clusterDomains.length;
    if (clusterDomains.length >= 2) {
      multiSource += 1;
    } else {
      singleSource += 1;
    }
    for (const member of cluster.members) {
      const target = enriched.find((item) => item.id === member.id);
      if (!target) {
        continue;
      }
      target.corroborations = Math.max(0, clusterDomains.length - 1);
      target.corroborating = clusterDomains.filter((domain) => domain !== member.domain);
      target.syndicated = syndicated;
    }
  }

  return {
    articles: enriched,
    clusters: clusters.length,
    multiSource,
    singleSource,
    domains,
  };
}

/* ------------------------------------------------------------------- Skills */

const IMAGE_KEYWORDS = [
  "image",
  "images",
  "photo",
  "photos",
  "picture",
  "pictures",
  "pic",
  "pics",
  "wallpaper",
  "wallpapers",
  "poster",
  "posters",
  "stock photo",
  "stock image",
  "illustration",
  "illustrations",
  "graphic",
  "graphics",
  "thumbnail",
  "banner",
  "logo",
  "diagram",
  "screenshot",
  "photo chahiye",
  "image chahiye",
  "dikhao",
];

const VIDEO_KEYWORDS = [
  "video",
  "videos",
  "clip",
  "clips",
  "footage",
  "b-roll",
  "broll",
  "b roll",
  "stock video",
  "reel",
  "reels",
  "animation",
  "timelapse",
  "drone shot",
  "video chahiye",
  "video dikhao",
];

const NEWS_KEYWORDS = [
  "news",
  "latest",
  "headline",
  "headlines",
  "breaking",
  "update",
  "updates",
  "khabar",
  "samachar",
  "today",
  "current",
  "this week",
  "happening",
];

const ARTICLE_KEYWORDS = [
  "article",
  "articles",
  "blog",
  "blogs",
  "post",
  "posts",
  "essay",
  "paper",
  "papers",
  "study",
  "research",
  "report",
  "reports",
  "tutorial",
  "guide",
  "documentation",
  "read about",
  "reading",
];

function resultOutcome(partial: {
  media?: MediaItem[];
  articles?: ArticleItem[];
  evidence: SkillOutcome["evidence"];
  entities?: SkillOutcome["entities"];
  sources: SourceRef[];
  summary: string;
  status?: SkillOutcome["status"];
  error?: SkillOutcome["error"];
}): SkillOutcome {
  return {
    status:
      partial.status ??
      (partial.media?.length || partial.articles?.length ? "ok" : "partial"),
    summary: partial.summary,
    evidence: partial.evidence,
    entities: partial.entities ?? [],
    sources: partial.sources,
    media: partial.media,
    articles: partial.articles,
    error: partial.error,
  };
}

function licenceRow(
  skillId: string,
  items: MediaItem[],
  src: SourceRef[],
): SkillOutcome["evidence"] {
  const byLicence = new Map<string, number>();
  for (const item of items) {
    const key = item.licence ?? "not stated";
    byLicence.set(key, (byLicence.get(key) ?? 0) + 1);
  }
  return Array.from(byLicence.entries())
    .slice(0, 6)
    .map(([licence, count]) =>
      evidence(skillId, "Licence", `${count} × ${truncate(licence, 90)}`, {
        source: src[0],
        kind: "record",
        confidence: licence === "not stated" ? "unknown" : "confirmed",
        severity: licence === "not stated" ? "low" : undefined,
      }),
    );
}

export const imageSearch: SkillDefinition = {
  id: "image-search",
  name: "Image finder",
  short: "Images",
  description:
    "Finds reusable images for a topic — Wikimedia Commons, Openverse and NASA without a key, Pexels, Pixabay and Unsplash when keyed — and returns direct file URLs with author and licence.",
  category: "retrieval",
  runtime: "live",
  accepts: ["text"],
  produces: ["images", "licence"],
  keywords: IMAGE_KEYWORDS,
  clientFallback: true,
  async run(target, ctx) {
    const skill = "image-search";
    const query = queryOf(target);
    const limit = budget(target);
    const reusable = reusableOnly(target);
    const language = target.meta?.language;
    ctx.log(`Searching image sources for “${query}”`);

    const sources: SourceRef[] = [commonsSource(), openverseSource(), nasaSource()];
    const failures: string[] = [];
    const items: MediaItem[] = [];

    const commons = await commonsSearch(query, "image", limit, ctx);
    items.push(...commons.items);
    if (commons.error) {
      failures.push(`Wikimedia Commons: ${commons.error}`);
    }

    const openverse = await openverseSearch(query, limit, reusable, language, ctx);
    items.push(...openverse.items);
    if (openverse.error) {
      failures.push(`Openverse: ${openverse.error}`);
    }

    const nasa = await nasaSearch(query, "image", Math.min(6, limit), ctx);
    items.push(...nasa.items);
    if (nasa.error) {
      failures.push(`NASA: ${nasa.error}`);
    }

    const pexelsKey = ctx.env("PEXELS_API_KEY");
    if (pexelsKey) {
      const pexels = await pexelsSearch(query, "image", limit, pexelsKey, ctx);
      items.push(...pexels.items);
      if (pexels.error) {
        failures.push(`Pexels: ${pexels.error}`);
      } else if (pexels.items.length > 0) {
        sources.push(pexelsSource());
      }
    }
    const pixabayKey = ctx.env("PIXABAY_API_KEY");
    if (pixabayKey) {
      const pixabay = await pixabaySearch(query, "image", limit, pixabayKey, ctx);
      items.push(...pixabay.items);
      if (pixabay.error) {
        failures.push(`Pixabay: ${pixabay.error}`);
      } else if (pixabay.items.length > 0) {
        sources.push(pixabaySource());
      }
    }
    const unsplashKey = ctx.env("UNSPLASH_ACCESS_KEY");
    if (unsplashKey) {
      const unsplash = await unsplashSearch(query, limit, unsplashKey, ctx);
      items.push(...unsplash.items);
      if (unsplash.error) {
        failures.push(`Unsplash: ${unsplash.error}`);
      } else if (unsplash.items.length > 0) {
        sources.push(unsplashSource());
      }
    }

    const filtered = reusable
      ? items.filter(
          (item) =>
            !/non-?free|fair use|copyright only|all rights reserved/i.test(
              item.licence ?? "",
            ),
        )
      : items;
    const deduped = Array.from(
      new Map(filtered.map((item) => [item.url, item])).values(),
    );

    const evidenceItems = [
      evidence(
        skill,
        "Images found",
        `${deduped.length} result(s) for “${query}” after deduplication`,
        {
          source: sources[0],
          detail: `${items.length} raw result(s) before dedupe; ${deduped.length} carry a usable licence.`,
        },
      ),
      ...licenceRow(skill, deduped, sources),
    ];
    if (deduped.length > 0) {
      evidenceItems.push(
        evidence(skill, "Top match", deduped[0].title, {
          source: sources.find((item) => item.id === deduped[0].sourceId) ?? sources[0],
          detail: `${deduped[0].source}${deduped[0].author ? ` · ${deduped[0].author}` : ""} — ${deduped[0].url}`,
          kind: "artifact",
        }),
      );
    }
    const keyHints = [
      pexelsKey ? undefined : "PEXELS_API_KEY",
      pixabayKey ? undefined : "PIXABAY_API_KEY",
      unsplashKey ? undefined : "UNSPLASH_ACCESS_KEY",
    ].filter(Boolean) as string[];
    if (keyHints.length > 0) {
      evidenceItems.push(
        evidence(skill, "Untapped sources", keyHints.join(", "), {
          source: sources[0],
          kind: "warning",
          severity: "info",
          confidence: "confirmed",
          detail:
            "These stock libraries are wired and will join the search as soon as their key is present in Settings.",
        }),
      );
    }

    const status: SkillOutcome["status"] =
      deduped.length > 0 ? (failures.length > 0 ? "partial" : "ok") : "unreachable";

    return resultOutcome({
      media: deduped,
      evidence: evidenceItems,
      sources,
      status,
      summary:
        deduped.length > 0
          ? `${deduped.length} reusable image(s) for “${query}” from ${
              new Set(deduped.map((item) => item.sourceId)).size
            } source(s).`
          : `No images returned for “${query}”${
              failures.length ? ` — ${failures[0]}` : ""
            }.`,
      error:
        deduped.length === 0 && failures.length > 0
          ? { code: "egress_blocked", message: failures[0] }
          : undefined,
    });
  },
};

export const videoSearch: SkillDefinition = {
  id: "video-search",
  name: "Video finder",
  short: "Video",
  description:
    "Finds downloadable footage and clips — Wikimedia Commons video, the Internet Archive and NASA without a key, Pexels and Pixabay when keyed — with licence, poster frame and duration.",
  category: "retrieval",
  runtime: "live",
  accepts: ["text"],
  produces: ["videos", "licence"],
  keywords: VIDEO_KEYWORDS,
  clientFallback: true,
  async run(target, ctx) {
    const skill = "video-search";
    const query = queryOf(target);
    const limit = budget(target);
    const reusable = reusableOnly(target);
    ctx.log(`Searching video sources for “${query}”`);

    const sources: SourceRef[] = [commonsSource(), archiveSource(), nasaSource()];
    const failures: string[] = [];
    const items: MediaItem[] = [];

    const commons = await commonsSearch(query, "video", limit, ctx);
    items.push(...commons.items);
    if (commons.error) {
      failures.push(`Wikimedia Commons: ${commons.error}`);
    }

    const archive = await archiveVideoSearch(query, limit, ctx);
    items.push(...archive.items);
    if (archive.error) {
      failures.push(`Internet Archive: ${archive.error}`);
    }

    const nasa = await nasaSearch(query, "video", Math.min(5, limit), ctx);
    items.push(...nasa.items);
    if (nasa.error) {
      failures.push(`NASA: ${nasa.error}`);
    }

    const pexelsKey = ctx.env("PEXELS_API_KEY");
    if (pexelsKey) {
      const pexels = await pexelsSearch(query, "video", limit, pexelsKey, ctx);
      items.push(...pexels.items);
      if (pexels.error) {
        failures.push(`Pexels: ${pexels.error}`);
      } else if (pexels.items.length > 0) {
        sources.push(pexelsSource());
      }
    }
    const pixabayKey = ctx.env("PIXABAY_API_KEY");
    if (pixabayKey) {
      const pixabay = await pixabaySearch(query, "video", limit, pixabayKey, ctx);
      items.push(...pixabay.items);
      if (pixabay.error) {
        failures.push(`Pixabay: ${pixabay.error}`);
      } else if (pixabay.items.length > 0) {
        sources.push(pixabaySource());
      }
    }

    const filtered = reusable
      ? items.filter(
          (item) =>
            !/no licence stated|check the item page|all rights reserved/i.test(
              item.licence ?? "",
            ),
        )
      : items;
    const deduped = Array.from(
      new Map(filtered.map((item) => [item.url, item])).values(),
    );
    const totalMinutes = deduped.reduce(
      (total, item) => total + (item.durationMs ?? 0) / 60000,
      0,
    );

    const evidenceItems = [
      evidence(
        skill,
        "Clips found",
        `${deduped.length} downloadable clip(s) for “${query}”`,
        {
          source: sources[0],
          detail: totalMinutes
            ? `Roughly ${totalMinutes.toFixed(1)} minute(s) of footage across the results.`
            : undefined,
        },
      ),
      ...licenceRow(skill, deduped, sources),
    ];
    if (deduped.length === 0) {
      evidenceItems.push(
        evidence(skill, "Video search", "no downloadable clip matched", {
          source: sources[0],
          kind: "warning",
          severity: "low",
          detail:
            failures.join(" · ") ||
            "Try a broader topic, or add a stock-video key in Settings for Pexels and Pixabay coverage.",
        }),
      );
    }

    return resultOutcome({
      media: deduped,
      evidence: evidenceItems,
      sources,
      status:
        deduped.length > 0 ? (failures.length > 0 ? "partial" : "ok") : "unreachable",
      summary:
        deduped.length > 0
          ? `${deduped.length} downloadable clip(s) for “${query}”.`
          : `No footage returned for “${query}”${failures.length ? ` — ${failures[0]}` : ""}.`,
    });
  },
};

export const newsSearch: SkillDefinition = {
  id: "news-search",
  name: "News & article finder",
  short: "News",
  description:
    "Finds articles and the latest reporting on a topic from the GDELT news index, with independent-domain corroboration counting, plus Hacker News discussion and encyclopedic background.",
  category: "retrieval",
  runtime: "live",
  accepts: ["text"],
  produces: ["articles", "news", "corroboration"],
  keywords: [...NEWS_KEYWORDS, ...ARTICLE_KEYWORDS],
  clientFallback: true,
  async run(target, ctx) {
    const skill = "news-search";
    const query = queryOf(target);
    const limit = budget(target);
    const language = target.meta?.language;
    const region = target.meta?.region;
    const timespan = target.meta?.timespan ?? "3d";
    ctx.log(`Searching news index for “${query}”`);

    const sources: SourceRef[] = [gdeltSource(), hnSource(), wikiSource()];
    const failures: string[] = [];
    const articles: ArticleItem[] = [];

    const gdelt = await gdeltSearch(query, limit, { language, region, timespan }, ctx);
    articles.push(...gdelt.items);
    if (gdelt.error) {
      failures.push(`GDELT: ${gdelt.error}`);
    }

    const hn = await hnSearch(query, Math.min(8, limit), ctx);
    articles.push(...hn.items);
    if (hn.error) {
      failures.push(`Hacker News: ${hn.error}`);
    }

    const wiki = await wikipediaContext(query, language, ctx);
    articles.push(...wiki.items);
    if (wiki.error) {
      failures.push(`Wikipedia: ${wiki.error}`);
    }

    const deduped = Array.from(
      new Map(articles.map((article) => [article.url, article])).values(),
    ).sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0));
    const story = corroborate(deduped);

    const dated = deduped.filter((article) => article.publishedAt);
    const newest = dated[0]?.publishedAt;
    const oldest = dated[dated.length - 1]?.publishedAt;
    const evidenceItems: SkillOutcome["evidence"] = [
      evidence(
        skill,
        "Coverage found",
        `${deduped.length} item(s) from ${story.domains.length} domain(s), ${story.clusters} distinct story(ies)`,
        {
          source: sources[0],
          detail:
            newest && oldest
              ? `Publication window: ${new Date(oldest).toISOString().slice(0, 16).replace("T", " ")} → ${new Date(newest).toISOString().slice(0, 16).replace("T", " ")} UTC.`
              : undefined,
        },
      ),
    ];
    if (deduped.length > 0) {
      evidenceItems.push(
        evidence(
          skill,
          "Corroboration",
          story.multiSource > 0
            ? `${story.multiSource} story(ies) carried by 2 or more independent domains`
            : "no story was carried by more than one domain",
          {
            source: sources[0],
            confidence: story.multiSource > 0 ? "confirmed" : "possible",
            severity: story.multiSource > 0 ? undefined : "medium",
            detail:
              story.multiSource > 0
                ? story.articles
                    .filter((article) => (article.corroborations ?? 0) > 0)
                    .slice(0, 3)
                    .map(
                      (article) =>
                        `${article.title.slice(0, 70)} (+${article.corroborations} domain(s))`,
                    )
                    .join(" · ")
                : "Every story above appears on a single domain. Treat single-source reporting as unconfirmed until a second outlet carries it.",
          },
        ),
      );
    }
    if (story.singleSource > 0 && deduped.length > story.singleSource) {
      evidenceItems.push(
        evidence(
          skill,
          "Single-source stories",
          `${story.singleSource} of ${story.clusters}`,
          {
            source: sources[0],
            kind: "warning",
            severity: "low",
            confidence: "confirmed",
          },
        ),
      );
    }
    const syndicated = story.articles.filter((article) => article.syndicated);
    if (syndicated.length > 0) {
      evidenceItems.push(
        evidence(
          skill,
          "Syndicated copies",
          `${syndicated.length} item(s) repeat the same headline across outlets`,
          {
            source: sources[0],
            kind: "warning",
            severity: "low",
            detail:
              "Identical headlines across many domains are wire copies, not independent confirmation.",
          },
        ),
      );
    }

    return resultOutcome({
      articles: story.articles,
      evidence: evidenceItems,
      sources,
      status:
        deduped.length > 0 ? (failures.length > 0 ? "partial" : "ok") : "unreachable",
      summary:
        deduped.length > 0
          ? `${deduped.length} article(s) across ${story.domains.length} domain(s); ${story.multiSource} story(ies) corroborated by 2+ domains.`
          : `No articles returned for “${query}”${failures.length ? ` — ${failures[0]}` : ""}.`,
    });
  },
};

export const imageProvenance: SkillDefinition = {
  id: "image-provenance",
  name: "Image provenance",
  short: "Provenance",
  description:
    "Works out where an attached image or image URL came from: content hash checked against Wikimedia Commons, perceptual hash for manual matching, capture metadata, and an honest statement of what needs a keyed reverse-image provider.",
  category: "tradecraft",
  runtime: "live",
  accepts: ["text", "url"],
  produces: ["provenance", "hash-match"],
  keywords: [
    "provenance",
    "reverse image",
    "where is this image",
    "find this image",
    "source of this image",
    "original image",
    "image origin",
    "kahan se",
    "original photo",
  ],
  clientFallback: true,
  async run(target, ctx) {
    const skill = "image-provenance";
    const commonsRef = commonsSource();
    const evidenceItems: SkillOutcome["evidence"] = [];
    const sources: SourceRef[] = [commonsRef];
    const media: MediaItem[] = [];

    const attachments = target.meta?.attachments
      ? (JSON.parse(target.meta.attachments) as Array<{
          name: string;
          sha1?: string;
          sha256?: string;
          perceptual?: { ahash: string; dhash: string; width: number; height: number };
          exif?: Record<string, string | number | boolean>;
          coordinates?: { lat: number; lon: number };
        }>)
      : [];

    const candidates: Array<{
      label: string;
      sha1?: string;
      perceptual?: { ahash: string; dhash: string };
      exif?: Record<string, string | number | boolean>;
      coordinates?: { lat: number; lon: number };
    }> = attachments.map((item) => ({
      label: item.name,
      sha1: item.sha1,
      perceptual: item.perceptual,
      exif: item.exif,
      coordinates: item.coordinates,
    }));

    // A URL target: fetch the bytes (browser path) and hash them locally.
    if (target.kind === "url" && /^https?:/i.test(target.value)) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12_000);
        const response = await ctx.fetch(target.value, { signal: controller.signal });
        clearTimeout(timer);
        if (response.ok) {
          const bytes = new Uint8Array(await response.arrayBuffer());
          const { sha1 } = await import("@/lib/crypto/digest");
          const digest = await sha1(bytes);
          evidenceItems.push(
            evidence(skill, "Fetched image", `${bytes.length} byte(s)`, {
              source: commonsRef,
              detail: `SHA-1 ${digest}`,
              kind: "metric",
            }),
          );
          candidates.push({ label: target.value, sha1: digest });
        } else {
          evidenceItems.push(
            evidence(skill, "Fetch", `HTTP ${response.status}`, {
              source: commonsRef,
              kind: "warning",
              severity: "low",
              confidence: "confirmed",
            }),
          );
        }
      } catch (error) {
        evidenceItems.push(
          evidence(
            skill,
            "Fetch blocked",
            error instanceof Error ? error.message : "unknown error",
            {
              source: commonsRef,
              kind: "warning",
              severity: "low",
              detail:
                "Many hosts do not allow cross-origin reads of their files. Paste the image as an attachment instead — that path always works because the bytes never leave this machine.",
              confidence: "confirmed",
            },
          ),
        );
      }
    }

    for (const candidate of candidates) {
      if (candidate.perceptual) {
        evidenceItems.push(
          evidence(
            skill,
            `Perceptual hash — ${candidate.label}`,
            `aHash ${candidate.perceptual.ahash} · dHash ${candidate.perceptual.dhash}`,
            {
              source: commonsRef,
              kind: "metric",
              confidence: "confirmed",
              detail:
                "Two visually identical images share these hashes even after resizing or re-encoding. Use them to compare against a candidate file you already have.",
            },
          ),
        );
      }
      if (candidate.sha1) {
        const match = await commonsBySha1(candidate.sha1, ctx);
        if (match) {
          media.push(match);
          evidenceItems.push(
            evidence(skill, "Commons hash match", match.title, {
              source: commonsRef,
              severity: "medium",
              detail: `${match.licence ?? "licence unstated"}${match.author ? ` · ${match.author}` : ""} — ${match.pageUrl ?? match.url}`,
              kind: "artifact",
            }),
          );
        } else {
          evidenceItems.push(
            evidence(
              skill,
              "Commons hash match",
              "no file on Wikimedia Commons has this exact content hash",
              {
                source: commonsRef,
                confidence: "probable",
                detail:
                  "An exact-hash miss only rules out Commons. Reverse search across the wider web needs a keyed provider (TinEye, SerpAPI or SauceNAO); nothing here fabricates a match.",
              },
            ),
          );
        }
      }
      const camera = [candidate.exif?.Make, candidate.exif?.Model]
        .filter(Boolean)
        .join(" ");
      if (camera) {
        evidenceItems.push(
          evidence(skill, "Capture device", camera, {
            source: commonsRef,
            kind: "record",
            confidence: "confirmed",
          }),
        );
      }
      if (candidate.coordinates) {
        evidenceItems.push(
          evidence(
            skill,
            "Capture location",
            `${candidate.coordinates.lat.toFixed(5)}, ${candidate.coordinates.lon.toFixed(5)}`,
            {
              source: commonsRef,
              severity: "high",
              detail:
                "Metadata carried the camera's position. Treat it as personal data and corroborate it against imagery before relying on it.",
            },
          ),
        );
      }
    }

    if (candidates.length === 0) {
      evidenceItems.push(
        evidence(skill, "No image supplied", "nothing to trace", {
          source: commonsRef,
          kind: "warning",
          severity: "low",
          detail:
            "Attach the image (or give a direct image URL) and this skill will hash it, check Commons and report the perceptual hash.",
          confidence: "confirmed",
        }),
      );
    }

    return resultOutcome({
      media,
      evidence: evidenceItems,
      sources,
      status: candidates.length === 0 ? "partial" : "ok",
      summary:
        candidates.length === 0
          ? "No image supplied — nothing to trace."
          : `${candidates.length} image(s) hashed and checked against Wikimedia Commons${
              media.length ? `, ${media.length} exact match(es)` : ", no exact match"
            }.`,
    });
  },
};

/* --------------------------------------------------------- Audio & music */

const AUDIO_KEYWORDS = [
  "song",
  "songs",
  "music",
  "track",
  "audio",
  "mp3",
  "tune",
  "soundtrack",
  "bgm",
  "instrumental",
  "bhajan",
  "ghazal",
  "qawwali",
  "lofi",
  "lo-fi",
  "playlist",
  "gana",
  "gaana",
  "sangeet",
  "geet",
  "dhun",
  "raga",
  "ringtone",
  "jingle",
  "podcast audio",
  "गाना",
  "गाने",
  "संगीत",
  "संगीतमय",
  "धुन",
  "ऑडियो",
];

const OPENVERSE_AUDIO_API = "https://api.openverse.org/v1/audio/";

interface OpenverseAudioResponse {
  results?: Array<{
    id?: string;
    title?: string;
    creator?: string;
    url?: string;
    foreign_landing_url?: string;
    license?: string;
    license_version?: string;
    license_url?: string;
    provider?: string;
    source?: string;
    duration?: number;
    filesize?: number;
    filetype?: string;
    thumbnail?: string;
  }>;
}

async function openverseAudioSearch(
  query: string,
  limit: number,
  reusable: boolean,
  ctx: NetContext,
): Promise<{ items: MediaItem[]; error?: string }> {
  const params = new URLSearchParams({
    q: query,
    page_size: String(limit),
    mature: "false",
  });
  if (reusable) {
    params.set("license_type", "commercial");
  }
  const result = await request<OpenverseAudioResponse>(
    `${OPENVERSE_AUDIO_API}?${params.toString()}`,
    ctx,
    { timeoutMs: 9000, retries: 0 },
  );
  if (!result.ok) {
    return { items: [], error: result.error.message };
  }

  const items: MediaItem[] = [];
  for (const hit of result.data.results ?? []) {
    if (!hit.url || !hit.title) {
      continue;
    }
    const licence = hit.license
      ? `${hit.license.toUpperCase()}${hit.license_version ? ` ${hit.license_version}` : ""} (Openverse)`
      : undefined;
    items.push(
      mediaItem({
        kind: "audio",
        title: truncate(hit.title, 140),
        url: hit.url,
        pageUrl: hit.foreign_landing_url,
        thumbnailUrl: hit.thumbnail,
        source: hit.provider ? `Openverse · ${hit.provider}` : "Openverse",
        sourceId: "openverse",
        licence,
        licenceUrl: hit.license_url,
        author: hit.creator,
        artist: hit.creator,
        durationMs: typeof hit.duration === "number" ? hit.duration : undefined,
        bytes: typeof hit.filesize === "number" ? hit.filesize : undefined,
        mime: hit.filetype,
        query,
        access: "download",
      }),
    );
  }
  return { items };
}

interface ArchiveAudioMetadata {
  files?: Array<{
    name?: string;
    format?: string;
    size?: string;
    length?: string;
    source?: string;
    track?: string;
  }>;
}

/** Internet Archive audio: the largest keyless source of playable, licensable music. */
async function archiveAudioSearch(
  query: string,
  limit: number,
  ctx: NetContext,
): Promise<{ items: MediaItem[]; error?: string }> {
  const params = new URLSearchParams({
    q: `${query} AND mediatype:audio`,
    rows: String(limit),
    page: "1",
    output: "json",
  });
  for (const field of [
    "identifier",
    "title",
    "description",
    "licenseurl",
    "year",
    "date",
    "creator",
  ]) {
    params.append("fl[]", field);
  }

  const result = await request<ArchiveSearchResponse>(
    `https://archive.org/advancedsearch.php?${params.toString()}`,
    ctx,
    { timeoutMs: 10000, retries: 0 },
  );
  if (!result.ok) {
    return { items: [], error: result.error.message };
  }

  const docs = (result.data.response?.docs ?? []).filter(
    (doc): doc is { identifier: string } & typeof doc => Boolean(doc.identifier),
  );

  const items = await concurrency(docs, 4, async (doc) => {
    const metadata = await request<ArchiveAudioMetadata>(
      `https://archive.org/metadata/${encodeURIComponent(doc.identifier)}`,
      ctx,
      { timeoutMs: 8000, retries: 0 },
    );
    if (!metadata.ok) {
      return undefined;
    }
    const files = (metadata.data.files ?? []).filter(
      (file) => file.name && /\.(mp3|ogg|oga|flac|m4a|opus|wav)$/i.test(file.name),
    );
    const file = files.find((candidate) => candidate.source === "original") ?? files[0];
    if (!file?.name) {
      return undefined;
    }
    return mediaItem({
      kind: "audio",
      title: truncate(stripHtml(doc.title) || doc.identifier, 140),
      url: `https://archive.org/download/${encodeURIComponent(doc.identifier)}/${encodeURIComponent(file.name)}`,
      thumbnailUrl: `https://archive.org/services/img/${encodeURIComponent(doc.identifier)}`,
      pageUrl: `https://archive.org/details/${encodeURIComponent(doc.identifier)}`,
      source: ARCHIVE_SOURCE.label,
      sourceId: ARCHIVE_SOURCE.id,
      licence: doc.licenseurl
        ? `Item licence: ${doc.licenseurl}`
        : "No licence stated on the item — check the item page before reuse",
      licenceUrl: doc.licenseurl,
      author: Array.isArray(doc.creator) ? doc.creator.join(", ") : doc.creator,
      durationMs: durationOf(file.length),
      bytes: file.size ? Number(file.size) : undefined,
      mime: file.format,
      publishedAt: timeOf(doc.date ?? String(doc.year ?? "")),
      query,
      access: "download",
    });
  });

  return { items: items.filter((item): item is MediaItem => Boolean(item)) };
}

interface ItunesResponse {
  results?: Array<{
    trackName?: string;
    artistName?: string;
    collectionName?: string;
    previewUrl?: string;
    artworkUrl100?: string;
    trackViewUrl?: string;
    trackTimeMillis?: number;
    releaseDate?: string;
    primaryGenreName?: string;
  }>;
}

/**
 * Catalog previews. These are official 30-second excerpts with a link to the
 * store page — the console never offers a copyrighted full track as a file.
 */
async function itunesSearch(
  query: string,
  limit: number,
  ctx: NetContext,
): Promise<{ items: MediaItem[]; error?: string }> {
  const params = new URLSearchParams({
    term: query,
    media: "music",
    entity: "song",
    limit: String(limit),
  });
  const result = await request<ItunesResponse>(
    `https://itunes.apple.com/search?${params.toString()}`,
    ctx,
    { timeoutMs: 9000, retries: 0 },
  );
  if (!result.ok) {
    return { items: [], error: result.error.message };
  }

  const items: MediaItem[] = [];
  for (const hit of result.data.results ?? []) {
    if (!hit.previewUrl || !hit.trackName) {
      continue;
    }
    items.push(
      mediaItem({
        kind: "audio",
        title: truncate(
          `${hit.trackName}${hit.artistName ? ` — ${hit.artistName}` : ""}`,
          140,
        ),
        url: hit.previewUrl,
        pageUrl: hit.trackViewUrl,
        thumbnailUrl: hit.artworkUrl100?.replace("100x100", "400x400"),
        source: "Apple Music (iTunes catalog)",
        sourceId: "itunes",
        licence: "30-second licensed preview — full track from the store",
        author: hit.artistName,
        artist: hit.artistName,
        collection: hit.collectionName,
        durationMs: hit.trackTimeMillis,
        publishedAt: timeOf(hit.releaseDate),
        query,
        access: "preview",
        previewOnly: true,
        storeName: "Apple Music",
        storeUrl: hit.trackViewUrl,
      }),
    );
  }
  return { items };
}

interface DeezerResponse {
  data?: Array<{
    id?: number;
    title?: string;
    duration?: number;
    preview?: string;
    link?: string;
    artist?: { name?: string };
    album?: { title?: string; cover_medium?: string };
  }>;
}

async function deezerSearch(
  query: string,
  limit: number,
  ctx: NetContext,
): Promise<{ items: MediaItem[]; error?: string }> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  const result = await request<DeezerResponse>(
    `https://api.deezer.com/search?${params.toString()}`,
    ctx,
    { timeoutMs: 9000, retries: 0 },
  );
  if (!result.ok) {
    return { items: [], error: result.error.message };
  }

  const items: MediaItem[] = [];
  for (const hit of result.data.data ?? []) {
    if (!hit.preview || !hit.title) {
      continue;
    }
    items.push(
      mediaItem({
        kind: "audio",
        title: truncate(
          `${hit.title}${hit.artist?.name ? ` — ${hit.artist.name}` : ""}`,
          140,
        ),
        url: hit.preview,
        pageUrl: hit.link,
        thumbnailUrl: hit.album?.cover_medium,
        source: "Deezer catalog",
        sourceId: "deezer",
        licence: "30-second licensed preview — full track from the store",
        author: hit.artist?.name,
        artist: hit.artist?.name,
        collection: hit.album?.title,
        durationMs: typeof hit.duration === "number" ? hit.duration * 1000 : undefined,
        query,
        access: "preview",
        previewOnly: true,
        storeName: "Deezer",
        storeUrl: hit.link,
      }),
    );
  }
  return { items };
}

interface JamendoResponse {
  results?: Array<{
    id?: string;
    name?: string;
    artist_name?: string;
    album_name?: string;
    duration?: number;
    audio?: string;
    audiodownload?: string;
    audiodownload_allowed?: boolean;
    license_ccurl?: string;
    image?: string;
    shareurl?: string;
  }>;
}

const JAMENDO_SOURCE = {
  id: "jamendo",
  label: "Jamendo",
  url: "https://www.jamendo.com/",
} as const;

/**
 * Jamendo is Creative Commons end to end: its API gives the master file, and a
 * free client id is all it asks for. Nothing here is a rehost of copyrighted
 * work — the licence travels with the track.
 */
async function jamendoSearch(
  query: string,
  limit: number,
  key: string,
  ctx: NetContext,
): Promise<{ items: MediaItem[]; error?: string }> {
  const params = new URLSearchParams({
    client_id: key,
    format: "json",
    limit: String(limit),
    search: query,
    audioformat: "mp32",
    include: "licenses",
  });
  const result = await request<JamendoResponse>(
    `https://api.jamendo.com/v3.0/tracks/?${params.toString()}`,
    ctx,
    { timeoutMs: 9000, retries: 0 },
  );
  if (!result.ok) {
    return { items: [], error: result.error.message };
  }

  const items: MediaItem[] = [];
  for (const track of result.data.results ?? []) {
    const file = track.audiodownload ?? track.audio;
    if (!file || !track.name) {
      continue;
    }
    items.push(
      mediaItem({
        kind: "audio",
        title: truncate(
          `${track.name}${track.artist_name ? ` — ${track.artist_name}` : ""}`,
          140,
        ),
        url: file,
        pageUrl: track.shareurl,
        thumbnailUrl: track.image,
        source: JAMENDO_SOURCE.label,
        sourceId: JAMENDO_SOURCE.id,
        licence: "Creative Commons — see the licence link on the track page",
        licenceUrl: track.license_ccurl,
        author: track.artist_name,
        artist: track.artist_name,
        collection: track.album_name,
        durationMs:
          typeof track.duration === "number" ? track.duration * 1000 : undefined,
        mime: "audio/mpeg",
        query,
        access: "download",
      }),
    );
  }
  return { items };
}

export const audioSearch: SkillDefinition = {
  id: "audio-search",
  name: "Music & audio finder",
  short: "Audio",
  description:
    "Finds playable audio without a key — Internet Archive, Wikimedia Commons and Openverse for downloadable tracks with their licences, plus official 30-second catalog previews and store links for released music.",
  category: "retrieval",
  runtime: "live",
  accepts: ["text"],
  produces: ["audio", "licence"],
  keywords: AUDIO_KEYWORDS,
  clientFallback: true,
  async run(target, ctx) {
    const skill = "audio-search";
    const query = queryOf(target);
    const limit = budget(target);
    const reusable = reusableOnly(target);
    ctx.log(`Searching audio sources for “${query}”`);

    const sources: SourceRef[] = [archiveSource(), commonsSource(), openverseSource()];
    const jamendoKey = ctx.env("JAMENDO_CLIENT_ID");
    const failures: string[] = [];
    const items: MediaItem[] = [];
    let previews = 0;

    const archive = await archiveAudioSearch(query, limit, ctx);
    items.push(...archive.items);
    if (archive.error) {
      failures.push(`Internet Archive: ${archive.error}`);
    }

    const commons = await commonsSearch(query, "audio", limit, ctx);
    items.push(...commons.items);
    if (commons.error) {
      failures.push(`Wikimedia Commons: ${commons.error}`);
    }

    const openverse = await openverseAudioSearch(query, limit, reusable, ctx);
    items.push(...openverse.items);
    if (openverse.error) {
      failures.push(`Openverse: ${openverse.error}`);
    }

    if (jamendoKey) {
      const jamendo = await jamendoSearch(query, limit, jamendoKey, ctx);
      items.push(...jamendo.items);
      if (jamendo.error) {
        failures.push(`Jamendo: ${jamendo.error}`);
      } else if (jamendo.items.length > 0) {
        sources.push(
          source(JAMENDO_SOURCE.id, JAMENDO_SOURCE.label, JAMENDO_SOURCE.url, "api"),
        );
      }
    }

    const itunes = await itunesSearch(query, limit, ctx);
    items.push(...itunes.items);
    previews += itunes.items.length;
    if (itunes.error) {
      failures.push(`Apple Music catalog: ${itunes.error}`);
    }

    const deezer = await deezerSearch(query, limit, ctx);
    items.push(...deezer.items);
    previews += deezer.items.length;
    if (deezer.error) {
      failures.push(`Deezer catalog: ${deezer.error}`);
    }

    const filtered = reusable
      ? items.filter(
          (item) =>
            item.access === "preview" ||
            !/no licence stated|check the item page|all rights reserved/i.test(
              item.licence ?? "",
            ),
        )
      : items;
    const deduped = Array.from(
      new Map(filtered.map((item) => [item.url, item])).values(),
    );
    const downloadable = deduped.filter((item) => item.access !== "preview").length;

    const evidenceItems = [
      evidence(
        skill,
        "Tracks found",
        `${deduped.length} playable result(s) for “${query}”`,
        {
          source: sources[0],
          detail: `${downloadable} downloadable from free libraries, ${deduped.length - downloadable} licensed preview(s) with store links.`,
        },
      ),
      ...licenceRow(skill, deduped, sources),
    ];
    if (!jamendoKey) {
      evidenceItems.push(
        evidence(skill, "Untapped source", "Jamendo is not configured", {
          source: sources[0],
          kind: "record",
          severity: "low",
          detail:
            "A free Jamendo client id in Settings adds a full Creative Commons catalogue of downloadable master files. Its absence is reported rather than worked around.",
        }),
      );
    }
    if (previews > 0) {
      evidenceItems.push(
        evidence(
          skill,
          "Preview vs download",
          `${previews} catalog preview(s) — 30-second excerpts`,
          {
            source: sources[2],
            kind: "record",
            severity: "low",
            detail:
              "Released commercial tracks are previewed from the official catalog APIs and linked to the store. This console does not provide or host full copyrighted recordings — the downloadable results come from the free libraries and carry the licence their uploader stated.",
          },
        ),
      );
    }
    if (deduped.length === 0) {
      evidenceItems.push(
        evidence(skill, "Audio search", "nothing playable matched", {
          source: sources[0],
          kind: "warning",
          severity: "low",
          detail:
            failures.join(" · ") ||
            "Try the artist, album or film name rather than the full line of a verse.",
        }),
      );
    }

    return resultOutcome({
      media: deduped,
      evidence: evidenceItems,
      sources,
      status:
        deduped.length > 0 ? (failures.length > 0 ? "partial" : "ok") : "unreachable",
      summary:
        deduped.length > 0
          ? `${deduped.length} playable track(s) for “${query}” — ${downloadable} downloadable, ${deduped.length - downloadable} preview(s).`
          : `No audio returned for “${query}”${failures.length ? ` — ${failures[0]}` : ""}.`,
    });
  },
};

export const retrievalSkills: SkillDefinition[] = [
  imageSearch,
  videoSearch,
  audioSearch,
  newsSearch,
  imageProvenance,
];

/** Re-exported for the planner, which needs the same trigger vocabulary. */
export const retrievalVocabulary = {
  image: IMAGE_KEYWORDS,
  video: VIDEO_KEYWORDS,
  audio: AUDIO_KEYWORDS,
  news: NEWS_KEYWORDS,
  article: ARTICLE_KEYWORDS,
};
