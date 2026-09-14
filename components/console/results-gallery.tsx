"use client";

import { Download, ExternalLink, Film, ImageOff, Newspaper } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import type { ArticleItem, MediaItem } from "@/lib/types";
import { cn } from "@/lib/utils";

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function licenceTone(licence?: string): "success" | "warning" | "neutral" {
  if (!licence) {
    return "warning";
  }
  return /public domain|cc0|cc[- ]?by(?![- ]?nc)|no restrictions|us gov/i.test(licence)
    ? "success"
    : "neutral";
}

/** Grid tile: the thumbnail when the source published one, an honest placeholder when not. */
function ImageTile({ item }: { item: MediaItem }) {
  const [failed, setFailed] = useState(false);
  const thumb = item.thumbnailUrl ?? (item.kind === "image" ? item.url : undefined);

  return (
    <figure className="group overflow-hidden rounded-xl border border-hairline bg-surface">
      <a
        href={item.pageUrl ?? item.url}
        target="_blank"
        rel="noreferrer noopener"
        className="relative block aspect-[4/3] overflow-hidden bg-surface-2"
      >
        {thumb && !failed ? (
          // biome-ignore lint/performance/noImgElement: third-party thumbnails load straight from the source library — routing them through next/image would hide the true origin and add a proxy hop that a blocked egress cannot serve.
          <img
            src={thumb}
            alt={item.title}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
            className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          />
        ) : (
          <span className="flex size-full flex-col items-center justify-center gap-1.5 text-faint-foreground">
            <ImageOff className="size-4" />
            <span className="text-[10.5px]">{item.source}</span>
          </span>
        )}
        <span className="absolute left-1.5 top-1.5 flex gap-1">
          <Badge tone={licenceTone(item.licence)} mono>
            {item.licence ? item.licence.slice(0, 22) : "licence not stated"}
          </Badge>
        </span>
        {item.kind === "video" && item.durationMs ? (
          <span className="tabular absolute bottom-1.5 right-1.5 rounded-full bg-ink/80 px-1.5 py-0.5 text-[10px] text-background">
            {Math.round(item.durationMs / 1000)}s
          </span>
        ) : null}
      </a>
      <figcaption className="space-y-1 p-2">
        <p
          className="line-clamp-2 text-[11.5px] leading-snug text-foreground"
          title={item.title}
        >
          {item.title}
        </p>
        <p className="flex items-center justify-between gap-2 text-[10.5px] text-muted-foreground">
          <span className="truncate">{item.source}</span>
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer noopener"
            download
            className="flex shrink-0 items-center gap-1 text-primary-strong hover:underline"
          >
            <Download className="size-3" />
            file
          </a>
        </p>
        {item.author ? (
          <p className="truncate text-[10.5px] text-faint-foreground" title={item.author}>
            {item.author}
          </p>
        ) : null}
      </figcaption>
    </figure>
  );
}

function MediaRow({ item }: { item: MediaItem }) {
  return (
    <li className="flex items-start gap-3 rounded-xl border border-hairline bg-surface p-2.5">
      <a
        href={item.pageUrl ?? item.url}
        target="_blank"
        rel="noreferrer noopener"
        className="relative block h-14 w-24 shrink-0 overflow-hidden rounded-lg bg-surface-2"
      >
        {item.thumbnailUrl ? (
          // biome-ignore lint/performance/noImgElement: same reason as the grid tiles — the thumbnail must come from the source library.
          <img
            src={item.thumbnailUrl}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            className="size-full object-cover"
          />
        ) : (
          <span className="flex size-full items-center justify-center text-faint-foreground">
            <Film className="size-4" />
          </span>
        )}
      </a>
      <div className="min-w-0 flex-1">
        <a
          href={item.pageUrl ?? item.url}
          target="_blank"
          rel="noreferrer noopener"
          className="line-clamp-2 text-[12.5px] leading-snug text-foreground hover:text-primary-strong"
        >
          {item.title}
        </a>
        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[10.5px] text-muted-foreground">
          <span>{item.source}</span>
          {item.durationMs ? (
            <span className="tabular">· {Math.round(item.durationMs / 1000)}s</span>
          ) : null}
          {item.width && item.height ? (
            <span className="tabular">
              · {item.width}×{item.height}
            </span>
          ) : null}
          {item.publishedAt ? (
            <span className="tabular">
              · {new Date(item.publishedAt).toISOString().slice(0, 10)}
            </span>
          ) : null}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Badge tone={licenceTone(item.licence)} mono>
            {item.licence ?? "licence not stated"}
          </Badge>
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer noopener"
            download
            className="flex items-center gap-1 text-[10.5px] text-primary-strong hover:underline"
          >
            <Download className="size-3" />
            download
          </a>
          <a
            href={item.pageUrl ?? item.url}
            target="_blank"
            rel="noreferrer noopener"
            className="flex items-center gap-1 text-[10.5px] text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="size-3" />
            source page
          </a>
        </div>
      </div>
    </li>
  );
}

function ArticleRow({ item }: { item: ArticleItem }) {
  const corroborations = item.corroborations ?? 0;
  return (
    <li className="rounded-xl border border-hairline bg-surface p-2.5">
      <a
        href={item.url}
        target="_blank"
        rel="noreferrer noopener"
        className="line-clamp-2 text-[12.5px] leading-snug text-foreground hover:text-primary-strong"
      >
        {item.title}
      </a>
      {item.snippet ? (
        <p className="mt-1 line-clamp-2 text-[11.5px] leading-relaxed text-muted-foreground">
          {item.snippet}
        </p>
      ) : null}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <span className="data-mono">{hostOf(item.url)}</span>
        {item.publishedAt ? (
          <span className="tabular">
            · {new Date(item.publishedAt).toISOString().slice(0, 10)}
          </span>
        ) : null}
        {corroborations > 0 ? (
          <Badge tone="success" mono>
            +{corroborations} independent
          </Badge>
        ) : (
          <Badge tone="warning" mono>
            single source
          </Badge>
        )}
        {item.syndicated ? (
          <Badge tone="neutral" mono>
            syndicated
          </Badge>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Everything the retrieval skills actually returned, with the licence each source
 * states. Nothing is rendered that a skill did not return.
 */
export function ResultsGallery({
  media,
  articles,
}: {
  media: MediaItem[];
  articles: ArticleItem[];
}) {
  if (media.length === 0 && articles.length === 0) {
    return null;
  }

  const images = media.filter((item) => item.kind === "image");
  const clips = media.filter((item) => item.kind === "video");
  const unlicensed = media.filter((item) => !item.licence).length;

  return (
    <section className="space-y-3.5">
      {images.length > 0 ? (
        <div>
          <p className="mb-2 flex items-center gap-2 text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground">
            Images
            <span className="tabular text-faint-foreground">{images.length}</span>
          </p>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
            {images.map((item) => (
              <ImageTile key={item.id} item={item} />
            ))}
          </div>
        </div>
      ) : null}

      {clips.length > 0 ? (
        <div>
          <p className="mb-2 flex items-center gap-2 text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground">
            Video &amp; B-roll
            <span className="tabular text-faint-foreground">{clips.length}</span>
          </p>
          <ul className="space-y-2">
            {clips.map((item) => (
              <MediaRow key={item.id} item={item} />
            ))}
          </ul>
        </div>
      ) : null}

      {articles.length > 0 ? (
        <div>
          <p className="mb-2 flex items-center gap-2 text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground">
            <Newspaper className="size-3.5" />
            Reporting
            <span className="tabular text-faint-foreground">{articles.length}</span>
          </p>
          <ul className="space-y-2">
            {articles.map((item) => (
              <ArticleRow key={item.id} item={item} />
            ))}
          </ul>
        </div>
      ) : null}

      <p
        className={cn(
          "text-[10.5px] leading-relaxed text-faint-foreground",
          unlicensed > 0 && "text-warning",
        )}
      >
        {unlicensed > 0
          ? `${unlicensed} item(s) carry no licence at the source — check before you publish. `
          : ""}
        Links open the original source. “Download” points at the file that source
        published; licences are quoted exactly as stated there.
      </p>
    </section>
  );
}
