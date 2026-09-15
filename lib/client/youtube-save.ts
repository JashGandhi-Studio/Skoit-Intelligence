import {
  downloadGenerated,
  fileNameFor,
  proxiedDownloadUrl,
} from "@/lib/client/download";
import { youtubeDownloadCandidates } from "@/lib/client/youtube";

/**
 * Save a YouTube video locally: each mirror route is fetched through the
 * console's own download proxy (so cross-origin refusals do not matter), the
 * first real stream wins. When every route fails the video is opened on its
 * source page so the ask still lands somewhere useful.
 *
 * The stream saved is the same public MP4 the embed player shows — nothing is
 * decrypted and no protection is bypassed; the uploader's terms still apply.
 */
export async function saveYoutubeVideo(
  videoId: string,
  title: string,
): Promise<{ mode: "saved" | "opened" }> {
  for (const candidate of youtubeDownloadCandidates(videoId)) {
    try {
      const response = await fetch(proxiedDownloadUrl(candidate), {
        cache: "no-store",
      });
      if (!response.ok) {
        continue;
      }
      const blob = await response.blob();
      if (blob.size < 10_000) {
        continue; // an error page, not a video
      }
      const filename = fileNameFor(title, undefined, ".mp4", "skoit-video");
      downloadGenerated(filename, blob, "video/mp4");
      return { mode: "saved" };
    } catch {
      /* next route */
    }
  }
  window.open(
    `https://www.youtube.com/watch?v=${videoId}`,
    "_blank",
    "noopener,noreferrer",
  );
  return { mode: "opened" };
}

export function youtubeIdOfEmbed(embedUrl: string | undefined): string | null {
  if (!embedUrl) {
    return null;
  }
  return /\/embed\/([\w-]{11})/.exec(embedUrl)?.[1] ?? null;
}
