import { isRelayOk, relayJson, relayText } from "@/lib/client/cors-fetch";

/**
 * YouTube search from the browser. YouTube's own endpoint sends no CORS
 * headers, so the chain is: public Piped API mirrors → Invidious mirrors →
 * the YouTube results page itself through the relay chain (parsed for its
 * embedded result data). Playback happens in the app through YouTube's
 * official nocookie embed; nothing is rehosted or stripped of ads/attribution.
 */

export interface VideoHit {
  videoId: string;
  title: string;
  author?: string;
  durationSec?: number;
  views?: number;
  published?: string;
  thumbnailUrl?: string;
}

export interface YoutubeOutcome {
  hits: VideoHit[];
  via: string;
  error?: string;
}

const PIPED_INSTANCES = [
  "https://pipedapi.kavin.rocks",
  "https://pipedapi.adminforge.de",
  "https://api.piped.private.coffee",
  "https://pipedapi.drgns.space",
  "https://pipedapi.reallyaweso.me",
  "https://api.piped.yt",
];

const INVIDIOUS_INSTANCES = [
  "https://inv.nadeko.net",
  "https://invidious.nerdvpn.de",
  "https://yewtu.be",
  "https://invidious.f5.si",
  "https://invidious.privacyredirect.com",
  "https://iv.datura.network",
];

function parseDuration(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }
  if (typeof value === "string") {
    const parts = value.split(":").map((part) => Number.parseInt(part, 10));
    if (parts.every((part) => Number.isFinite(part)) && parts.length > 0) {
      return parts.reduce((total, part) => total * 60 + part, 0);
    }
    const flat = Number.parseInt(value, 10);
    if (Number.isFinite(flat) && flat > 0) {
      return flat;
    }
  }
  return undefined;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

interface MirrorResult {
  via: string;
  hits: VideoHit[];
}

function parsePipedItem(item: Record<string, unknown>): VideoHit | undefined {
  const url = String(item.url ?? "");
  const id = /(?:v=|\/)([\w-]{11})/.exec(url)?.[1] ?? String(item.id ?? "");
  if (!/[\w-]{11}/.test(id)) {
    return undefined;
  }
  return {
    videoId: id,
    title: decodeEntities(String(item.title ?? "")),
    author: item.uploaderName ? String(item.uploaderName) : undefined,
    durationSec: parseDuration(item.duration),
    views: typeof item.views === "number" ? item.views : undefined,
    published: item.uploadedDate ? String(item.uploadedDate) : undefined,
    thumbnailUrl: item.thumbnail ? String(item.thumbnail) : undefined,
  };
}

function parseInvidiousItem(item: Record<string, unknown>): VideoHit | undefined {
  const id = String(item.videoId ?? "");
  if (!/[\w-]{11}/.test(id)) {
    return undefined;
  }
  const thumbs = item.videoThumbnails as Array<{ url?: string }> | undefined;
  return {
    videoId: id,
    title: decodeEntities(String(item.title ?? "")),
    author: item.author ? String(item.author) : undefined,
    durationSec: parseDuration(item.lengthSeconds),
    views: typeof item.viewCount === "number" ? item.viewCount : undefined,
    published: item.publishedText ? String(item.publishedText) : undefined,
    thumbnailUrl:
      thumbs?.find((thumb) => /hqdefault|mqdefault/.test(String(thumb.url ?? "")))?.url ??
      `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
  };
}

/** Ask every mirror of a family at once; the first useful answer wins. */
async function raceMirrors(
  builds: Array<{ via: string; url: string; parse: (data: unknown) => VideoHit[] }>,
  signal?: AbortSignal,
): Promise<MirrorResult | undefined> {
  const attempts = builds.map(async (build): Promise<MirrorResult> => {
    const fetched = await relayJson<unknown>(build.url, {
      timeoutMs: 8_000,
      signal,
      skipDirect: true,
    });
    if (!isRelayOk(fetched)) {
      throw new Error(fetched.error);
    }
    const hits = build.parse(fetched.data).filter((hit): hit is VideoHit => Boolean(hit));
    if (hits.length === 0) {
      throw new Error("empty");
    }
    return { via: build.via, hits };
  });
  try {
    return await Promise.any(attempts);
  } catch {
    return undefined;
  }
}

async function viaPiped(
  query: string,
  signal?: AbortSignal,
): Promise<VideoHit[] | undefined> {
  const winner = await raceMirrors(
    PIPED_INSTANCES.map((base) => ({
      via: `piped (${new URL(base).hostname})`,
      url: `${base}/search?q=${encodeURIComponent(query)}&filter=videos`,
      parse: (data: unknown) => {
        const items = (data as { items?: Array<Record<string, unknown>> }).items;
        return Array.isArray(items)
          ? items.map(parsePipedItem).filter((hit): hit is VideoHit => Boolean(hit))
          : [];
      },
    })),
    signal,
  );
  return winner?.hits;
}

async function viaInvidious(
  query: string,
  signal?: AbortSignal,
): Promise<VideoHit[] | undefined> {
  const winner = await raceMirrors(
    INVIDIOUS_INSTANCES.map((base) => ({
      via: `invidious (${new URL(base).hostname})`,
      url: `${base}/api/v1/search?q=${encodeURIComponent(query)}&type=video&sort_by=relevance`,
      parse: (data: unknown) =>
        Array.isArray(data)
          ? (data as Array<Record<string, unknown>>)
              .map(parseInvidiousItem)
              .filter((hit): hit is VideoHit => Boolean(hit))
          : [],
    })),
    signal,
  );
  return winner?.hits;
}

/** Last resort: the results page itself, parsed for its embedded JSON. */
async function viaYoutubePage(
  query: string,
  signal?: AbortSignal,
): Promise<VideoHit[] | undefined> {
  const fetched = await relayText(
    `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&hl=en&gl=IN`,
    {
      // youtube.com never sends CORS headers, so the browser skips the direct
      // attempt; on the server "direct" is the only route and works.
      skipDirect: true,
      timeoutMs: 12_000,
      signal,
    },
  );
  if (!isRelayOk(fetched)) {
    return undefined;
  }
  const html = fetched.data;
  const hits: VideoHit[] = [];
  const seen = new Set<string>();
  const pattern =
    /"videoRenderer":\{"videoId":"([\w-]{11})"[\s\S]{0,2400}?"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/g;
  let match: RegExpExecArray | null = pattern.exec(html);
  while (match !== null && hits.length < 20) {
    const id = match[1];
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    const title = decodeEntities(
      match[2]
        .replace(/\\u([\dA-Fa-f]{4})/g, (_, code) =>
          String.fromCharCode(Number.parseInt(code, 16)),
        )
        .replace(/\\"/g, '"'),
    );
    const ownerChunk = html.slice(match.index, match.index + 4000);
    const author = /"ownerText":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/.exec(
      ownerChunk,
    )?.[1];
    const length = /"lengthText":[^}]*?"simpleText":"([\d:]+)"/.exec(ownerChunk)?.[1];
    hits.push({
      videoId: id,
      title,
      author: author ? decodeEntities(author.replace(/\\"/g, '"')) : undefined,
      durationSec: parseDuration(length),
      thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    });
    match = pattern.exec(html);
  }
  return hits.length > 0 ? hits : undefined;
}

export async function youtubeSearch(
  query: string,
  options: { limit?: number; signal?: AbortSignal } = {},
): Promise<YoutubeOutcome> {
  const limit = Math.min(options.limit ?? 12, 30);
  const errors: string[] = [];

  const piped = await viaPiped(query, options.signal);
  if (piped?.length) {
    return { hits: piped.slice(0, limit), via: "piped" };
  }
  errors.push("piped mirrors unreachable");

  const invidious = await viaInvidious(query, options.signal);
  if (invidious?.length) {
    return { hits: invidious.slice(0, limit), via: "invidious" };
  }
  errors.push("invidious mirrors unreachable");

  const page = await viaYoutubePage(query, options.signal);
  if (page?.length) {
    return { hits: page.slice(0, limit), via: "youtube page" };
  }
  errors.push("youtube page unreachable");

  return { hits: [], via: "none", error: errors.join(" · ") };
}

/**
 * Candidate routes for saving a YouTube video locally. Invidious mirrors can
 * hand over a direct MP4 stream (itag 18); when none of them answer, the
 * caller falls back to the console's download proxy and finally to opening
 * the source page. Nothing here decrypts or strips DRM — it is the same
 * public stream the player shows.
 */
export function youtubeDownloadCandidates(videoId: string): string[] {
  const routes: string[] = [];
  for (const base of INVIDIOUS_INSTANCES) {
    routes.push(`${base}/latest_version?id=${encodeURIComponent(videoId)}&itag=18`);
  }
  routes.push(`https://www.youtube.com/watch?v=${videoId}`);
  return routes;
}
