import { isRelayOk, relayJson } from "@/lib/client/cors-fetch";
import { newId } from "@/lib/utils";

/**
 * JioSaavn — the catalogue India actually listens to, searched from the browser.
 *
 * Two routes, tried in order:
 *   1. saavn.dev — a public, keyless JioSaavn API that returns decoded CDN urls;
 *   2. JioSaavn's own web API (api.php) through the relay chain, decrypting the
 *      media link locally. The media link is DES-ECB encrypted with a fixed,
 *      widely documented key; decrypting it in the browser is exactly what the
 *      official web player itself does.
 *
 * The console does not rehost anything: playback and downloads hit
 * aac.saavncdn.com directly, the same CDN the official player uses. These are
 * full-length songs, not 30-second previews — labelled as catalogue streams
 * for personal listening, never as licence-clear material.
 */

export interface SaavnTrack {
  id: string;
  title: string;
  artist: string;
  album?: string;
  year?: string;
  language?: string;
  durationSec?: number;
  imageUrl?: string;
  streamUrl?: string;
  permaUrl?: string;
  label?: string;
  via: string;
}

const SAAVN_DEV = "https://saavn.dev/api/search/songs";
const JIOSAAVN_API = "https://www.jiosaavn.com/api.php";

/** Fixed, documented key the JioSaavn web player uses for media links. */
const DES_KEY = "38346591";

import CryptoJS from "crypto-js";

export function decryptMediaUrlSync(encrypted: string): string | undefined {
  try {
    const key = CryptoJS.enc.Utf8.parse(DES_KEY);
    const decrypted = CryptoJS.DES.decrypt(encrypted, key, {
      mode: CryptoJS.mode.ECB,
      padding: CryptoJS.pad.Pkcs7,
    }).toString(CryptoJS.enc.Utf8);
    return decrypted.startsWith("http") ? decrypted : undefined;
  } catch {
    return undefined;
  }
}

function bumpQuality(url: string): string {
  return url.replace("_96.mp4", "_320.mp4").replace("_160.mp4", "_320.mp4");
}

function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function hiResImage(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }
  return url.replace("150x150", "500x500").replace("50x50", "500x500");
}

export function normalizeForMatch(value: string): string {
  return decodeEntities(value)
    .toLowerCase()
    .replace(/\((?:from|feat|ft|lyrics|video|official|audio|song|full)[^)]*\)/g, " ")
    .replace(/\[(?:from|feat|ft|lyrics|video|official|audio|song|full)[^\]]*\]/g, " ")
    .replace(/[^a-z0-9\u0900-\u097F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * How well a track answers the ask. The user asked for *that* song — a search
 * that returns fifteen unrelated tracks is a failure, so results below the
 * precision bar are cut when the query names a specific song.
 */
export function scoreTrack(query: string, track: SaavnTrack): number {
  const q = normalizeForMatch(query);
  const t = normalizeForMatch(track.title);
  const artist = normalizeForMatch(track.artist ?? "");
  if (!q || !t) {
    return 0;
  }
  let score = 0;
  const VERSION_SUFFIX =
    /^(remix|lofi|lo-fi|slowed|reverb|sped\s?up|nightcore|cover|live|unplugged|instrumental|karaoke|version|acoustic|lyrics|video|audio|edit|extended|remaster(ed)?|feat(uring)?\.?|ft\.?|with\s+lyrics|full\s+song|official\s+(video|audio))?$/;
  if (t === q) {
    score = 100;
  } else if (t.startsWith(q)) {
    // "Kesariya (Lo-Fi Remix)" is the same song; "Kesariya Balam" is not.
    const remainder = t.slice(q.length).trim();
    score = remainder.length === 0 ? 100 : VERSION_SUFFIX.test(remainder) ? 82 : 56;
  } else if (q.startsWith(t) && t.length >= 4) {
    // the ask carried extra context (an artist, a movie) — the song still is it
    score = 84;
  } else if (t.includes(q)) {
    score = 56;
  } else {
    // token overlap, in case the ask was "song name artist" in another order
    const qTokens = new Set(q.split(" "));
    const tTokens = t.split(" ");
    const hits = tTokens.filter((token) => qTokens.has(token)).length;
    score = Math.round((hits / Math.max(tTokens.length, 1)) * 46);
  }
  if (artist && q.includes(artist.split(" ")[0])) {
    score += 12;
  }
  return Math.min(score, 100);
}

interface SaavnDevImage {
  quality?: string;
  url?: string;
}
interface SaavnDevDownload {
  quality?: string;
  url?: string;
  link?: string;
}
interface SaavnDevSong {
  id?: string;
  name?: string;
  title?: string;
  year?: string | number;
  duration?: string | number;
  language?: string;
  label?: string;
  url?: string;
  image?: SaavnDevImage[];
  downloadUrl?: SaavnDevDownload[];
  primaryArtists?: string | string[];
  artists?: { primary?: Array<{ name?: string }> };
  album?: { name?: string } | string;
}

function pickQuality(
  entries: SaavnDevImage[] | SaavnDevDownload[] | undefined,
  needle: string,
): string | undefined {
  if (!Array.isArray(entries)) {
    return undefined;
  }
  return entries.find((entry) => String(entry.quality ?? "").includes(needle))?.url;
}

function artistOf(song: SaavnDevSong): string {
  if (typeof song.primaryArtists === "string" && song.primaryArtists.trim()) {
    return song.primaryArtists.trim();
  }
  if (Array.isArray(song.primaryArtists) && song.primaryArtists.length > 0) {
    return song.primaryArtists.filter(Boolean).join(", ");
  }
  const primary = song.artists?.primary?.map((item) => item.name).filter(Boolean) ?? [];
  return primary.join(", ");
}

function albumOf(song: SaavnDevSong): string | undefined {
  if (!song.album) {
    return undefined;
  }
  return typeof song.album === "string" ? song.album : song.album.name;
}

async function viaSaavnDev(query: string, limit: number, signal?: AbortSignal) {
  const url = `${SAAVN_DEV}?query=${encodeURIComponent(query)}&limit=${limit}&page=0`;
  const fetched = await relayJson<{
    success?: boolean;
    data?: { results?: SaavnDevSong[] };
  }>(url, {
    timeoutMs: 12_000,
    signal,
  });
  if (!isRelayOk(fetched) || !fetched.data?.data?.results) {
    return undefined;
  }
  return fetched.data.data.results.map<SaavnTrack>((song) => ({
    id: String(song.id ?? newId("sv")),
    title: decodeEntities(song.name ?? song.title ?? "Unknown title"),
    artist: artistOf(song) || "Unknown artist",
    album: albumOf(song),
    year: song.year ? String(song.year) : undefined,
    language: song.language,
    durationSec: Number(song.duration) || undefined,
    imageUrl: hiResImage(pickQuality(song.image, "500") ?? song.image?.[0]?.url),
    streamUrl:
      pickQuality(song.downloadUrl, "320") ??
      pickQuality(song.downloadUrl, "160") ??
      pickQuality(song.downloadUrl, "96") ??
      song.downloadUrl?.[0]?.url,
    permaUrl: song.url,
    label: song.label,
    via: "saavn.dev",
  }));
}

interface JioSong {
  id?: string;
  name?: string;
  title?: string;
  year?: string | number;
  duration?: string | number;
  language?: string;
  label?: string;
  url?: string;
  perma_url?: string;
  image?: Array<{ quality?: string; link?: string; url?: string }>;
  downloadUrl?: Array<{ quality?: string; link?: string; url?: string }>;
  primaryArtists?: string | string[];
  more_info?: {
    encrypted_media_url?: string;
    primaryArtists?: string[];
    singerList?: string;
    album?: string;
    duration?: string | number;
    language?: string;
    label?: string;
    perma_url?: string;
  };
}

async function viaJioSaavnApi(query: string, limit: number, signal?: AbortSignal) {
  const url = `${JIOSAAVN_API}?__call=search.getResults&_format=json&_marker=0&api_version=4&ctx=web6Dot0&p=1&n=${limit}&q=${encodeURIComponent(query)}`;
  const fetched = await relayJson<{ results?: JioSong[] }>(url, {
    timeoutMs: 14_000,
    signal,
    skipDirect: true,
  });
  if (!isRelayOk(fetched) || !Array.isArray(fetched.data?.results)) {
    return undefined;
  }
  return fetched.data.results.map<SaavnTrack>((song) => {
    const info = song.more_info ?? {};
    const direct =
      pickQuality(song.downloadUrl as SaavnDevDownload[], "320") ??
      (song.downloadUrl as SaavnDevDownload[] | undefined)?.[0]?.url ??
      (song.downloadUrl as SaavnDevDownload[] | undefined)?.[0]?.link;
    const decrypted = info.encrypted_media_url
      ? decryptMediaUrlSync(info.encrypted_media_url)
      : undefined;
    const stream =
      (direct?.startsWith("http") ? direct : undefined) ??
      (decrypted ? bumpQuality(decrypted) : undefined);
    return {
      id: String(song.id ?? newId("sv")),
      title: decodeEntities(song.name ?? song.title ?? "Unknown title"),
      artist:
        (Array.isArray(info.primaryArtists)
          ? info.primaryArtists.join(", ")
          : undefined) ??
        (typeof song.primaryArtists === "string" ? song.primaryArtists : undefined) ??
        info.singerList ??
        "Unknown artist",
      album:
        info.album ??
        (typeof song === "object" && "album" in song
          ? String((song as { album?: { name?: string } }).album?.name ?? "") || undefined
          : undefined),
      year: song.year ? String(song.year) : undefined,
      language: song.language ?? info.language,
      durationSec: Number(song.duration ?? info.duration) || undefined,
      imageUrl: hiResImage(
        (song.image as Array<{ quality?: string; link?: string }> | undefined)?.find(
          (entry) => String(entry.quality ?? "").includes("500"),
        )?.link ??
          song.image?.[0]?.link ??
          song.image?.[0]?.url,
      ),
      streamUrl: stream,
      permaUrl: song.url ?? info.perma_url,
      label: song.label ?? info.label,
      via: "jiosaavn",
    };
  });
}

export interface SaavnSearchResult {
  tracks: SaavnTrack[];
  via: string;
  errors: string[];
}

/**
 * Search JioSaavn. `precise` keeps only results that actually answer the ask —
 * the exact song (and its versions), not the rest of the search dump.
 */
export async function saavnSearch(
  query: string,
  options: { limit?: number; precise?: boolean; signal?: AbortSignal } = {},
): Promise<SaavnSearchResult> {
  const limit = Math.min(options.limit ?? 12, 30);
  const errors: string[] = [];

  const dev = await viaSaavnDev(query, limit, options.signal).catch(() => undefined);
  let tracks = dev && dev.length > 0 ? dev : [];

  if (tracks.length === 0) {
    const jio = await viaJioSaavnApi(query, limit, options.signal).catch(() => undefined);
    if (jio && jio.length > 0) {
      tracks = jio;
    } else {
      if (!dev) {
        errors.push("saavn.dev unreachable");
      }
      errors.push("jiosaavn api unreachable");
    }
  }

  // Drop tracks with no playable link — a result that cannot play is not a result.
  tracks = tracks.filter((track) => track.streamUrl?.startsWith("http"));
  const deduped = Array.from(
    new Map(tracks.map((track) => [`${track.title}|${track.artist}`, track])).values(),
  );

  const ranked = deduped
    .map((track) => ({ track, score: scoreTrack(query, track) }))
    .sort(
      (a, b) =>
        b.score - a.score || (a.track.durationSec ?? 999) - (b.track.durationSec ?? 999),
    );

  // Precision gate: when an exact (or prefix) match exists, mere substring
  // hits are dropped — the ask was for THAT song, not the search dump.
  const best = ranked[0]?.score ?? 0;
  const cutoff = options.precise ? (best >= 84 ? 60 : 46) : 0;
  const kept = (
    options.precise ? ranked.filter((item) => item.score >= cutoff) : ranked
  ).slice(0, options.precise ? 8 : limit);

  return {
    tracks: kept.map((item) => item.track),
    via: tracks[0]?.via ?? "none",
    errors,
  };
}
