"use client";

import {
  AudioLines,
  BookOpen,
  Download,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Images,
  Music2,
  Play,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Video,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { OffersTable, PapersShelf, TranslateStrip } from "@/components/console/shelves";
import type { ViewerRequest } from "@/components/console/viewers";
import { Badge } from "@/components/ui/badge";
import { forceDownload } from "@/lib/client/download";
import { looksLikePdf } from "@/lib/client/web-search";
import type { ArticleItem, MediaItem } from "@/lib/types";

import { cn, truncate } from "@/lib/utils";

/**
 * The gallery for what the skills actually brought back: images with their
 * licence and author, clips, audio and reporting. Every tile points at the
 * source that published the asset — the console never rehosts a file and never
 * shows an item without saying where it came from.
 */

function isReusable(item: MediaItem): boolean {
  const licence = (item.licence ?? "").toLowerCase();
  if (!licence) {
    return false;
  }
  if (/all rights reserved|no licence|not stated|unknown/.test(licence)) {
    return false;
  }
  return /public domain|cc0|cc by|creative commons|og[c]?l|mit|apache|unlicense/.test(
    licence,
  );
}

function licenceLabel(item: MediaItem): string {
  if (item.access === "preview") {
    return "30-second preview";
  }
  return item.licence ? truncate(item.licence, 46) : "licence not stated";
}

function AudioLine({ item }: { item: MediaItem }) {
  const [failed, setFailed] = useState(false);
  const downloadable = item.access !== "preview" && !item.previewOnly;

  return (
    <li className="rounded-xl border border-hairline bg-surface p-2.5">
      <div className="flex items-start gap-2.5">
        <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg border border-hairline bg-surface-2">
          {item.thumbnailUrl ? (
            // biome-ignore lint/performance/noImgElement: artwork is served by the catalogue that published it.
            <img
              src={item.thumbnailUrl}
              alt=""
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              className="size-full object-cover"
            />
          ) : (
            <Music2 className="size-4 text-faint-foreground" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-[12.5px] leading-snug text-foreground">
            {item.title}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] text-muted-foreground">
            <span>{item.artist ?? item.author ?? item.source}</span>
            {item.durationMs ? (
              <span className="tabular">
                {Math.round(item.durationMs / 1000 / 60)}:
                {String(Math.round((item.durationMs / 1000) % 60)).padStart(2, "0")}
              </span>
            ) : null}
            <span className={isReusable(item) ? "text-success" : "text-warning"}>
              {licenceLabel(item)}
            </span>
          </p>
        </div>
        {item.exact ? (
          <span className="flex shrink-0 items-center gap-1 rounded-full border border-success/40 bg-success/10 px-1.5 py-0.5 text-[9.5px] font-medium text-success">
            <Sparkles className="size-2.5" />
            exact match
          </span>
        ) : null}
        <div className="flex shrink-0 items-center gap-1">
          {item.pageUrl ? (
            <a
              href={item.pageUrl}
              target="_blank"
              rel="noreferrer noopener"
              aria-label={`Open the source page for ${item.title}`}
              className="grid size-7 place-items-center rounded-lg border border-hairline text-muted-foreground transition-colors hover:text-foreground"
            >
              <ExternalLink className="size-3.5" />
            </a>
          ) : null}
          {downloadable ? (
            <button
              type="button"
              aria-label={`Download ${item.title}`}
              onClick={() =>
                void forceDownload(
                  item.url,
                  `${item.title}${item.artist ? ` - ${item.artist}` : ""}`,
                  {
                    ext: ".mp3",
                    prefix: "skoit-track",
                  },
                ).then((result) => {
                  toast[result.mode === "failed" ? "error" : "success"](
                    result.mode === "failed"
                      ? "The source refused a direct copy — it opened in a tab instead"
                      : `Saved ${result.filename}`,
                  );
                })
              }
              className="grid size-7 place-items-center rounded-lg border border-hairline text-primary-strong transition-colors hover:bg-primary-soft"
            >
              <Download className="size-3.5" />
            </button>
          ) : null}
        </div>
      </div>
      {failed ? (
        <p className="mt-2 flex items-center gap-1.5 text-[10.5px] text-warning">
          <TriangleAlert className="size-3" />
          This preview would not play in the browser — open the source page instead.
        </p>
      ) : (
        // biome-ignore lint/a11y/useMediaCaption: these are music and field recordings; no caption track exists at the source.
        <audio
          controls
          preload="none"
          src={item.url}
          onError={() => setFailed(true)}
          className="mt-2 h-8 w-full"
        />
      )}
    </li>
  );
}

function ImageTile({
  item,
  onOpenViewer,
}: {
  item: MediaItem;
  onOpenViewer: (request: ViewerRequest) => void;
}) {
  const reusable = isReusable(item);
  return (
    <figure className="group overflow-hidden rounded-xl border border-hairline bg-surface">
      <button
        type="button"
        onClick={() => onOpenViewer({ type: "image", item })}
        className="relative block aspect-[4/3] w-full cursor-zoom-in overflow-hidden bg-surface-2"
        aria-label={`View ${item.title}`}
      >
        {item.thumbnailUrl ? (
          // biome-ignore lint/performance/noImgElement: thumbnails must come from the source's own CDN.
          <img
            src={item.thumbnailUrl}
            alt={item.title}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            className="size-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          />
        ) : (
          <span className="grid size-full place-items-center text-faint-foreground">
            <ImageIcon className="size-5" />
          </span>
        )}
        <span
          className={cn(
            "pointer-events-none absolute bottom-1.5 left-1.5 inline-flex max-w-[calc(100%-12px)] items-center gap-1 rounded-full px-1.5 py-0.5 text-[9.5px] font-medium backdrop-blur",
            reusable ? "bg-success/85 text-background" : "bg-warning/85 text-background",
          )}
        >
          {reusable ? <ShieldCheck className="size-2.5" /> : null}
          <span className="truncate">{licenceLabel(item)}</span>
        </span>
      </button>
      <figcaption className="p-2">
        <p className="line-clamp-2 text-[11.5px] leading-snug text-foreground">
          {item.title}
        </p>
        <p className="mt-0.5 truncate text-[10.5px] text-muted-foreground">
          {item.source}
          {item.author ? ` · ${truncate(item.author, 24)}` : ""}
          {item.width && item.height ? ` · ${item.width}×${item.height}` : ""}
        </p>
        <div className="mt-1.5 flex items-center gap-1.5">
          <a
            href={item.pageUrl ?? item.url}
            target="_blank"
            rel="noreferrer noopener"
            className="flex items-center gap-1 rounded-lg border border-hairline px-1.5 py-1 text-[10.5px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <ExternalLink className="size-3" />
            Source
          </a>
          <button
            type="button"
            onClick={() =>
              void forceDownload(item.url, item.title, { prefix: "skoit-image" }).then(
                (result) => {
                  toast[result.mode === "failed" ? "error" : "success"](
                    result.mode === "failed"
                      ? "The source refused a direct copy — it opened in a tab instead"
                      : `Saved ${result.filename}`,
                  );
                },
              )
            }
            className="flex items-center gap-1 rounded-lg border border-hairline px-1.5 py-1 text-[10.5px] text-primary-strong transition-colors hover:bg-primary-soft"
          >
            <Download className="size-3" />
            Download
          </button>
        </div>
      </figcaption>
    </figure>
  );
}

function ClipRow({
  item,
  onOpenViewer,
}: {
  item: MediaItem;
  onOpenViewer: (request: ViewerRequest) => void;
}) {
  const embeddable = Boolean(item.embedUrl);
  return (
    <li className="flex items-center gap-2.5 rounded-xl border border-hairline bg-surface p-2">
      <span className="relative grid h-12 w-[68px] shrink-0 place-items-center overflow-hidden rounded-lg border border-hairline bg-surface-2">
        {item.thumbnailUrl ? (
          // biome-ignore lint/performance/noImgElement: clip thumbnails belong to the host that published them.
          <img
            src={item.thumbnailUrl}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            className="size-full object-cover"
          />
        ) : (
          <Video className="size-4 text-faint-foreground" />
        )}
        {item.durationMs ? (
          <span className="tabular absolute right-1 bottom-1 rounded bg-background/85 px-1 text-[9.5px] text-foreground">
            {Math.round(item.durationMs / 1000)}s
          </span>
        ) : null}
      </span>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-[12px] leading-snug text-foreground">
          {item.title}
        </p>
        <p className="mt-0.5 truncate text-[10.5px] text-muted-foreground">
          {item.source}
          {item.licence ? ` · ${truncate(item.licence, 34)}` : " · licence not stated"}
          {item.bytes ? ` · ${Math.round(item.bytes / 1024 / 1024)} MB` : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          aria-label={`Play ${item.title} in the console`}
          onClick={() => onOpenViewer({ type: "video", item })}
          className="flex h-7 items-center gap-1 rounded-lg border border-primary/40 bg-primary-soft px-2 text-[10.5px] font-medium text-primary-strong transition-colors hover:bg-primary/20"
        >
          <Play className="size-3" />
          {embeddable ? "Play" : "Watch"}
        </button>
        {!embeddable ? (
          <button
            type="button"
            aria-label={`Download ${item.title}`}
            onClick={() =>
              void forceDownload(item.url, item.title, {
                ext: ".mp4",
                prefix: "skoit-clip",
              }).then((result) => {
                toast[result.mode === "failed" ? "error" : "success"](
                  result.mode === "failed"
                    ? "The source refused a direct copy — it opened in a tab instead"
                    : `Saved ${result.filename}`,
                );
              })
            }
            className="grid size-7 place-items-center rounded-lg border border-hairline text-primary-strong transition-colors hover:bg-primary-soft"
          >
            <Download className="size-3.5" />
          </button>
        ) : null}
        <a
          href={item.pageUrl ?? item.url}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={`Open the source page for ${item.title}`}
          className="grid size-7 place-items-center rounded-lg border border-hairline text-muted-foreground transition-colors hover:text-foreground"
        >
          <ExternalLink className="size-3.5" />
        </a>
      </div>
    </li>
  );
}

function ArticleRow({
  item,
  onOpenViewer,
  translated,
}: {
  item: ArticleItem;
  onOpenViewer: (request: ViewerRequest) => void;
  translated?: { title?: string; snippet?: string };
}) {
  const independent = (item.corroborations ?? 0) > 0;
  const isPdf = looksLikePdf(item.url);
  const shownTitle = translated?.title || item.title;
  const shownSnippet = translated?.snippet || item.snippet;
  return (
    <li className="rounded-xl border border-hairline bg-surface p-2.5 transition-colors hover:border-primary/30">
      <button
        type="button"
        onClick={() =>
          isPdf
            ? onOpenViewer({ type: "pdf", url: item.url, title: item.title })
            : onOpenViewer({ type: "article", article: item })
        }
        className="text-left text-[12.5px] leading-snug font-medium text-foreground transition-colors hover:text-primary-strong"
      >
        {shownTitle}
      </button>
      {shownSnippet ? (
        <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
          {shownSnippet}
        </p>
      ) : null}

      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] text-muted-foreground">
        <span>{item.domain}</span>
        {item.publishedAt ? (
          <span className="tabular">
            {new Date(item.publishedAt).toISOString().slice(0, 10)}
          </span>
        ) : null}
        {independent ? (
          <Badge tone="success" mono>
            +{item.corroborations} independent source(s)
          </Badge>
        ) : null}
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() =>
              isPdf
                ? onOpenViewer({ type: "pdf", url: item.url, title: item.title })
                : onOpenViewer({ type: "article", article: item })
            }
            className="inline-flex items-center gap-1 rounded-lg border border-primary/40 bg-primary-soft px-2 py-1 text-[10.5px] font-medium text-primary-strong transition-colors hover:bg-primary/20"
          >
            {isPdf ? <FileText className="size-3" /> : <BookOpen className="size-3" />}
            {isPdf ? "Open PDF" : "Read"}
          </button>
          {isPdf ? (
            <button
              type="button"
              onClick={() =>
                void forceDownload(item.url, item.title, {
                  ext: ".pdf",
                  prefix: "skoit-pdf",
                }).then((result) => {
                  toast[result.mode === "failed" ? "error" : "success"](
                    result.mode === "failed"
                      ? "The source refused a direct copy — it opened in a tab instead"
                      : `Saved ${result.filename}`,
                  );
                })
              }
              className="inline-flex items-center gap-1 rounded-lg border border-hairline px-2 py-1 text-[10.5px] text-primary-strong transition-colors hover:bg-primary-soft"
            >
              <Download className="size-3" />
              Download
            </button>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export function ResultsGallery({
  media,
  articles,
  onOpenViewer,
}: {
  media?: MediaItem[];
  articles?: ArticleItem[];
  onOpenViewer: (request: ViewerRequest) => void;
}) {
  const [translations, setTranslations] = useState<{
    titles: Map<string, string>;
    snippets: Map<string, string> | null;
  } | null>(null);

  const items = media ?? [];
  const reports = articles ?? [];
  const images = items.filter((item) => item.kind === "image");
  const clips = items.filter((item) => item.kind === "video");
  const audio = items.filter((item) => item.kind === "audio");

  // The structured shelves pull their items out of the plain list.
  const papers = reports.filter((item) => item.shelf === "papers");
  const offers = reports.filter((item) => item.shelf === "offers");
  const plainReports = reports.filter(
    (item) => item.shelf !== "papers" && item.shelf !== "offers",
  );
  const newsLike = plainReports.filter(
    (item) => item.publishedAt || item.shelf === undefined,
  );

  if (images.length + clips.length + audio.length + reports.length === 0) {
    return null;
  }

  const unlicensed = items.filter((item) => !item.licence).length;
  const previews = audio.filter(
    (item) => item.access === "preview" || item.previewOnly,
  ).length;

  return (
    <section className="print-block animate-rise space-y-3 rounded-2xl border border-hairline bg-surface/60 p-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-[12.5px] font-semibold tracking-tight text-foreground">
          <Images className="size-3.5 text-primary" />
          Found for you
        </h3>
        <p className="flex flex-wrap items-center gap-1.5 text-[10.5px] text-muted-foreground">
          {images.length > 0 ? (
            <Badge tone="neutral" mono>
              {images.length} image{images.length === 1 ? "" : "s"}
            </Badge>
          ) : null}
          {clips.length > 0 ? (
            <Badge tone="neutral" mono>
              {clips.length} clip{clips.length === 1 ? "" : "s"}
            </Badge>
          ) : null}
          {audio.length > 0 ? (
            <Badge tone="neutral" mono>
              {audio.length} track{audio.length === 1 ? "" : "s"}
            </Badge>
          ) : null}
          {reports.length > 0 ? (
            <Badge tone="neutral" mono>
              {reports.length} article{reports.length === 1 ? "" : "s"}
            </Badge>
          ) : null}
        </p>
      </header>

      {images.length > 0 ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {images.slice(0, 16).map((item) => (
            <ImageTile key={item.id} item={item} onOpenViewer={onOpenViewer} />
          ))}
        </div>
      ) : null}

      {audio.length > 0 ? (
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            <AudioLines className="size-3" />
            Audio
          </p>
          <ul className="space-y-2">
            {audio.slice(0, 8).map((item) => (
              <AudioLine key={item.id} item={item} />
            ))}
          </ul>
        </div>
      ) : null}

      {clips.length > 0 ? (
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            <Video className="size-3" />
            Footage
          </p>
          <ul className="space-y-2">
            {clips.slice(0, 10).map((item) => (
              <ClipRow key={item.id} item={item} onOpenViewer={onOpenViewer} />
            ))}
          </ul>
        </div>
      ) : null}

      {papers.length > 0 ? (
        <PapersShelf
          items={papers}
          onOpenViewer={(request) =>
            request.type === "pdf"
              ? onOpenViewer({ type: "pdf", url: request.url, title: request.title })
              : onOpenViewer({ type: "article", article: request.article })
          }
        />
      ) : null}

      {offers.length > 0 ? <OffersTable items={offers} /> : null}

      {plainReports.length > 0 ? (
        <div className="space-y-2">
          {newsLike.length > 0 ? (
            <TranslateStrip
              articles={newsLike.slice(0, 12)}
              onTranslation={(titles, snippets) => setTranslations({ titles, snippets })}
            />
          ) : null}
          <ul className="space-y-2">
            {plainReports.slice(0, 12).map((item) => (
              <ArticleRow
                key={item.id}
                item={item}
                onOpenViewer={onOpenViewer}
                translated={
                  translations
                    ? {
                        title: translations.titles.get(item.url),
                        snippet: translations.snippets?.get(item.url) ?? undefined,
                      }
                    : undefined
                }
              />
            ))}
          </ul>
        </div>
      ) : null}

      <p className="border-t border-hairline pt-2 text-[10.5px] leading-relaxed text-faint-foreground">
        Tap anything to open it in the console — reader, player or viewer — and download
        it from there. Files are served by the source that published them — nothing is
        rehosted here.
        {unlicensed > 0
          ? ` ${unlicensed} item(s) state no licence: check the source page before you reuse them.`
          : ""}
        {previews > 0
          ? ` ${previews} track(s) are official 30-second previews; the download button appears only for files published under a free licence.`
          : ""}
      </p>
    </section>
  );
}
