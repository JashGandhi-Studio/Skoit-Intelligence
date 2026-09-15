"use client";

import {
  ArrowUpRight,
  BookOpenText,
  Download,
  ExternalLink,
  FileText,
  LoaderCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { isRelayOk, relayBytes } from "@/lib/client/cors-fetch";
import { forceDownload } from "@/lib/client/download";
import { buildStyledPdf, type PdfDocInput, type PdfSection } from "@/lib/client/pdf-make";
import { type ExtractedArticle, keyPointsOf, readArticle } from "@/lib/client/reader";
import { saveYoutubeVideo, youtubeIdOfEmbed } from "@/lib/client/youtube-save";
import type { ArticleItem, MediaItem } from "@/lib/types";
import { formatRelative, truncate } from "@/lib/utils";

/**
 * Everything the console finds can now be consumed *inside* the console:
 * articles read in place (and saved as clean PDFs), PDFs viewed without
 * leaving, YouTube videos played in the official player, images shown full
 * size. Every viewer also carries the escape hatches — open original, direct
 * download — so nothing is a dead end.
 */

export type ViewerRequest =
  | { type: "article"; article: ArticleItem }
  | { type: "pdf"; url: string; title: string }
  | { type: "video"; item: MediaItem }
  | { type: "image"; item: MediaItem }
  | { type: "file"; name: string; url: string; mime?: string; sizeBytes?: number };

export function viewerKey(request: ViewerRequest | null): string {
  if (!request) {
    return "none";
  }
  if (request.type === "pdf") {
    return `pdf:${request.url}`;
  }
  if (request.type === "file") {
    return `file:${request.name}:${request.url}`;
  }
  return `item:${request.type}`;
}

/* ------------------------------------------------------------- reader ----- */

function articleToPdfInput(article: ExtractedArticle, sourceUrl: string): PdfDocInput {
  const sections: PdfSection[] = [];
  if (article.paragraphs.length > 0) {
    // Break long extractions into headed chunks so the PDF reads like a document.
    const chunkSize = 6;
    for (let index = 0; index < article.paragraphs.length; index += chunkSize) {
      sections.push({
        heading:
          index === 0 ? undefined : `Continued (${Math.floor(index / chunkSize) + 1})`,
        paragraphs: article.paragraphs.slice(index, index + chunkSize),
      });
    }
  }
  if (article.links.length > 0) {
    sections.push({
      heading: "Links found in the article",
      bullets: article.links.map((link) => `${link.label}: ${link.url}`),
    });
  }
  return {
    title: article.title ?? "Article",
    subtitle: article.byline,
    meta: `Read in SkOiT · ${new URL(sourceUrl).hostname} · saved ${new Date().toLocaleDateString()}`,
    sections,
    footerNote: `Source: ${sourceUrl}`,
  };
}

function ReaderPane({ article }: { article: ArticleItem }) {
  const [state, setState] = useState<
    | { phase: "loading" }
    | { phase: "error"; message: string }
    | { phase: "ready"; extracted: ExtractedArticle }
  >({ phase: "loading" });
  const [building, setBuilding] = useState(false);

  useEffect(() => {
    let alive = true;
    setState({ phase: "loading" });
    readArticle(article.url)
      .then((result) => {
        if (!alive) {
          return;
        }
        if (result.article) {
          setState({ phase: "ready", extracted: result.article });
        } else {
          setState({
            phase: "error",
            message: result.error ?? "could not read this page",
          });
        }
      })
      .catch(() => {
        if (alive) {
          setState({ phase: "error", message: "reading this page failed" });
        }
      });
    return () => {
      alive = false;
    };
  }, [article.url]);

  const saveAsPdf = async () => {
    if (state.phase !== "ready") {
      return;
    }
    setBuilding(true);
    try {
      const input = articleToPdfInput(state.extracted, article.url);
      const built = await buildStyledPdf(input);
      forceDownloadFromBlob(built.blob, built.filename);
      toast.success(`Saved “${truncate(built.filename, 40)}”`);
    } catch {
      toast.error("The PDF could not be built in this browser");
    } finally {
      setBuilding(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="neutral" mono>
          {article.domain}
        </Badge>
        {article.publishedAt ? (
          <span className="text-[11px] text-faint-foreground">
            {formatRelative(article.publishedAt)}
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            variant="primary"
            size="sm"
            disabled={state.phase !== "ready" || building}
            onClick={() => void saveAsPdf()}
          >
            {building ? <LoaderCircle className="animate-spin" /> : <FileText />}
            Save as PDF
          </Button>
          <a
            href={article.url}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-hairline px-2.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <ExternalLink className="size-3.5" />
            Original
          </a>
        </div>
      </div>

      <h2 className="text-balance text-[17px] leading-snug font-semibold tracking-tight text-foreground">
        {state.phase === "ready"
          ? (state.extracted.title ?? article.title)
          : article.title}
      </h2>
      {state.phase === "ready" && state.extracted.byline ? (
        <p className="text-[12px] text-muted-foreground">{state.extracted.byline}</p>
      ) : null}

      {state.phase === "loading" ? (
        <div className="flex items-center gap-2 rounded-xl border border-hairline bg-surface-2/60 px-3.5 py-4 text-[12.5px] text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin text-primary" />
          Pulling the article text out of the page…
        </div>
      ) : null}

      {state.phase === "error" ? (
        <div className="rounded-xl border border-hairline bg-surface-2/60 px-3.5 py-4 text-[12.5px] leading-relaxed text-muted-foreground">
          <p className="mb-2 font-medium text-foreground">
            This page would not give up its text.
          </p>
          <p className="mb-3">{state.message} — some sites block readers entirely.</p>
          <a
            href={article.url}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-primary-strong hover:underline"
          >
            <ArrowUpRight className="size-3.5" />
            Read it at {article.domain} instead
          </a>
        </div>
      ) : null}

      {state.phase === "ready" ? (
        <>
          {(() => {
            const points = keyPointsOf(state.extracted, 3);
            if (points.length < 2) {
              return null;
            }
            return (
              <div className="rounded-xl border border-primary/25 bg-primary-soft/60 px-3.5 py-3">
                <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-primary-strong uppercase">
                  <BookOpenText className="size-3.5" />
                  Key points
                </p>
                <ul className="space-y-1.5">
                  {points.map((point) => (
                    <li
                      key={point.slice(0, 48)}
                      className="text-[12.5px] leading-relaxed text-foreground"
                    >
                      · {truncate(point, 240)}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })()}

          <div className="prose-skoit prose prose-sm max-w-none dark:prose-invert">
            {state.extracted.paragraphs.map((paragraph) => (
              <p key={paragraph.slice(0, 48)} className="mb-3 leading-[1.75]">
                {paragraph}
              </p>
            ))}
          </div>

          {state.extracted.links.length > 0 ? (
            <div className="rounded-xl border border-hairline bg-surface-2/50 px-3.5 py-3">
              <p className="mb-2 text-[11px] font-medium tracking-wide text-faint-foreground uppercase">
                Links in this article ({state.extracted.links.length})
              </p>
              <ul className="grid gap-1 sm:grid-cols-2">
                {state.extracted.links.slice(0, 24).map((link) => (
                  <li key={link.url} className="min-w-0">
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="block truncate text-[12px] text-muted-foreground hover:text-foreground hover:underline"
                      title={`${link.label} — ${link.url}`}
                    >
                      {truncate(link.label || link.url, 56)}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- pdf ----- */

function PdfPane({ url, title }: { url: string; title: string }) {
  const [state, setState] = useState<
    | { phase: "loading" }
    | { phase: "error"; message: string }
    | { phase: "ready"; blobUrl: string }
    | { phase: "direct" }
  >({ phase: "loading" });

  useEffect(() => {
    let alive = true;
    let created: string | null = null;
    setState({ phase: "loading" });
    (async () => {
      const fetched = await relayBytes(url, { timeoutMs: 20_000 });
      if (!alive) {
        return;
      }
      if (isRelayOk(fetched)) {
        const blob = new Blob([fetched.data.bytes.slice().buffer as ArrayBuffer], {
          type: fetched.data.mime || "application/pdf",
        });
        created = URL.createObjectURL(blob);
        setState({ phase: "ready", blobUrl: created });
      } else if (/^https?:\/\//i.test(url)) {
        // The relay chain failed, but the browser may still display the PDF
        // directly from the publisher (its own viewer needs no CORS).
        setState({ phase: "direct" });
      } else {
        setState({ phase: "error", message: fetched.error });
      }
    })().catch(() => {
      if (alive) {
        setState({ phase: "error", message: "the PDF could not be fetched" });
      }
    });
    return () => {
      alive = false;
      if (created) {
        URL.revokeObjectURL(created);
      }
    };
  }, [url]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span
          className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground"
          title={title}
        >
          {title}
        </span>
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            void forceDownload(url, title, { ext: ".pdf", prefix: "skoit-pdf" }).then(
              (result) => {
                toast[result.mode === "failed" ? "error" : "success"](
                  result.mode === "failed"
                    ? "Download failed — the file opened in a tab instead"
                    : `Saved ${result.filename}`,
                );
              },
            );
          }}
        >
          <Download />
          Download PDF
        </Button>
        <a
          href={url}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-hairline px-2.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ExternalLink className="size-3.5" />
          Open
        </a>
      </div>
      {state.phase === "loading" ? (
        <div className="flex h-64 items-center justify-center gap-2 rounded-xl border border-hairline bg-surface-2/50 text-[12.5px] text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin text-primary" />
          Fetching the PDF…
        </div>
      ) : null}
      {state.phase === "direct" ? (
        <iframe
          src={url}
          title={`PDF preview — ${title}`}
          className="h-[70dvh] min-h-100 w-full rounded-xl border border-hairline bg-surface-2"
        />
      ) : null}
      {state.phase === "error" ? (
        <div className="rounded-xl border border-hairline bg-surface-2/50 px-3.5 py-4 text-[12.5px] leading-relaxed text-muted-foreground">
          <p className="mb-2 font-medium text-foreground">
            The PDF could not be shown here.
          </p>
          <p>
            {state.message}. Use “Open” above — it will load straight from the source.
          </p>
        </div>
      ) : null}
      {state.phase === "ready" ? (
        <iframe
          src={state.blobUrl}
          title={`PDF preview — ${title}`}
          className="h-[70dvh] min-h-100 w-full rounded-xl border border-hairline bg-surface-2"
        />
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------- file ----- */

function kindOf(
  mime: string | undefined,
  name: string,
): "image" | "video" | "audio" | "pdf" | "text" | "other" {
  const type = (mime ?? "").toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (type === "application/pdf" || /\.pdf$/i.test(name)) return "pdf";
  if (
    type.startsWith("text/") ||
    /^(application\/(json|xml|javascript|x-yaml|sql|csv|rtf))/i.test(type) ||
    /\.(txt|json|csv|log|md|eml|xml|yaml|yml|srt|vtt|html?|ts|tsx|js|py|java|c|cpp|css)$/i.test(
      name,
    )
  ) {
    return "text";
  }
  return "other";
}

/**
 * The everything-else viewer: any file the analyst attached opens here —
 * images, audio, video, PDFs, plain text — with an honest card (and a
 * download) for formats a browser cannot render.
 */
function FilePane({
  name,
  url,
  mime,
  sizeBytes,
}: {
  name: string;
  url: string;
  mime?: string;
  sizeBytes?: number;
}) {
  const kind = kindOf(mime, name);
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (kind !== "text") {
      return;
    }
    let alive = true;
    fetch(url)
      .then((response) => response.text())
      .then((value) => {
        if (alive) {
          setText(value.slice(0, 60_000));
        }
      })
      .catch(() => {
        if (alive) {
          setText(null);
        }
      });
    return () => {
      alive = false;
    };
  }, [kind, url]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <FileText className="size-4 shrink-0 text-faint-foreground" />
        <span
          className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground"
          title={name}
        >
          {name}
        </span>
        {sizeBytes ? (
          <Badge tone="neutral" mono>
            {(sizeBytes / 1024 / 1024).toFixed(1)} MB
          </Badge>
        ) : null}
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            void forceDownload(url, name, {}).then((result) => {
              toast[result.mode === "failed" ? "error" : "success"](
                result.mode === "failed"
                  ? "The file could not be saved"
                  : `Saved ${result.filename}`,
              );
            });
          }}
        >
          <Download />
          Download
        </Button>
      </div>

      {kind === "image" ? (
        // biome-ignore lint/performance/noImgElement: the analyst's own file, shown locally
        <img
          src={url}
          alt={name}
          className="max-h-[64dvh] w-full rounded-xl border border-hairline object-contain"
        />
      ) : null}

      {kind === "video" ? (
        // biome-ignore lint/a11y/useMediaCaption: user's own file, no caption track exists
        <video
          src={url}
          controls
          playsInline
          className="max-h-[64dvh] w-full rounded-xl border border-hairline bg-black"
        />
      ) : null}

      {kind === "audio" ? (
        // biome-ignore lint/a11y/useMediaCaption: user's own file, no caption track exists
        <audio src={url} controls className="w-full" />
      ) : null}

      {kind === "pdf" ? (
        <iframe
          src={url}
          title={`PDF preview — ${name}`}
          className="h-[64dvh] w-full rounded-xl border border-hairline bg-surface-2"
        />
      ) : null}

      {kind === "text" ? (
        <pre className="thin-scroll max-h-[60dvh] overflow-auto rounded-xl border border-hairline bg-surface-2/60 p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-foreground">
          {text ?? "Reading the file…"}
        </pre>
      ) : null}

      {kind === "other" ? (
        <div className="rounded-xl border border-hairline bg-surface-2/60 px-3.5 py-4 text-[12.5px] leading-relaxed text-muted-foreground">
          <p className="mb-1 font-medium text-foreground">
            {mime || "Unknown format"} — the browser cannot display this one.
          </p>
          <p>The file is attached intact; use Download to save a copy.</p>
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------- video ----- */

function VideoPane({ item }: { item: MediaItem }) {
  const embed = item.embedUrl;
  const videoId = youtubeIdOfEmbed(embed);
  const [saving, setSaving] = useState(false);

  const saveYoutube = () => {
    if (!videoId) {
      return;
    }
    setSaving(true);
    const toastId = toast.loading("Looking for a downloadable stream…");
    void saveYoutubeVideo(videoId, item.title).then((result) => {
      setSaving(false);
      if (result.mode === "saved") {
        toast.success(`Saved “${truncate(item.title, 48)}”`, { id: toastId });
      } else {
        toast.info("No direct stream answered — the video opened on YouTube instead", {
          id: toastId,
        });
      }
    });
  };

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl border border-hairline bg-black">
        {embed ? (
          <iframe
            src={`${embed}&autoplay=1`}
            title={item.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            className="aspect-video w-full"
          />
        ) : (
          // biome-ignore lint/a11y/useMediaCaption: footage clips carry no caption track at the source.
          <video
            src={item.url}
            controls
            autoPlay
            playsInline
            className="aspect-video w-full"
          />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-[13px] leading-snug font-medium text-foreground">
          {item.title}
        </p>
        <Badge tone="neutral" mono>
          {item.source}
        </Badge>
        {embed && videoId ? (
          <Button variant="primary" size="sm" disabled={saving} onClick={saveYoutube}>
            {saving ? <LoaderCircle className="animate-spin" /> : <Download />}
            Download
          </Button>
        ) : null}
        {!embed ? (
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              void forceDownload(item.url, item.title, {
                ext: ".mp4",
                prefix: "skoit-clip",
              }).then((result) => {
                toast[result.mode === "failed" ? "error" : "success"](
                  result.mode === "failed"
                    ? "The source refused a direct copy — it opened in a tab instead"
                    : `Saved ${result.filename}`,
                );
              });
            }}
          >
            <Download />
            Download
          </Button>
        ) : null}
        <a
          href={item.pageUrl ?? item.url}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-hairline px-2.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ExternalLink className="size-3.5" />
          {embed ? "YouTube" : "Source"}
        </a>
      </div>
      {embed ? (
        <p className="text-[10.5px] leading-relaxed text-faint-foreground">
          Played through YouTube's official player — views count for the creator, and
          their terms apply. Download saves the public stream where a mirror provides it;
          otherwise the video opens on its source page.
        </p>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------- image ----- */

function ImagePane({ item }: { item: MediaItem }) {
  const src = item.thumbnailUrl ?? item.url;
  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl border border-hairline bg-surface-2">
        {/* biome-ignore lint/performance/noImgElement: viewer loads the source's own CDN asset. */}
        <img
          src={src}
          alt={item.title}
          referrerPolicy="no-referrer"
          className="max-h-[70dvh] w-full object-contain"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-[12.5px] leading-snug text-foreground">
          {item.title}
        </p>
        <Badge tone="neutral" mono>
          {item.source}
        </Badge>
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            void forceDownload(item.url, item.title, { prefix: "skoit-image" }).then(
              (result) => {
                toast[result.mode === "failed" ? "error" : "success"](
                  result.mode === "failed"
                    ? "The source refused a direct copy — it opened in a tab instead"
                    : `Saved ${result.filename}`,
                );
              },
            );
          }}
        >
          <Download />
          Download
        </Button>
        {item.pageUrl ? (
          <a
            href={item.pageUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-hairline px-2.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <ExternalLink className="size-3.5" />
            Source
          </a>
        ) : null}
      </div>
      {item.author || item.licence ? (
        <p className="text-[10.5px] text-faint-foreground">
          {[item.author, item.licence].filter(Boolean).join(" · ")}
        </p>
      ) : null}
    </div>
  );
}

function forceDownloadFromBlob(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 20_000);
}

/* --------------------------------------------------------------- shell ---- */

export function ViewerDialog({
  request,
  open,
  onOpenChange,
}: {
  request: ViewerRequest | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const width = useMemo(() => {
    if (!request) {
      return "";
    }
    return request.type === "article"
      ? "sm:max-w-[720px] w-[calc(100vw-1.5rem)]"
      : "sm:max-w-[820px] w-[calc(100vw-1.5rem)]";
  }, [request]);

  const title =
    request?.type === "article"
      ? "Reader"
      : request?.type === "pdf"
        ? "PDF viewer"
        : request?.type === "video"
          ? "Video player"
          : request?.type === "file"
            ? "File viewer"
            : "Image viewer";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} className={width}>
        {request?.type === "article" ? <ReaderPane article={request.article} /> : null}
        {request?.type === "pdf" ? (
          <PdfPane url={request.url} title={request.title} />
        ) : null}
        {request?.type === "video" ? <VideoPane item={request.item} /> : null}
        {request?.type === "image" ? <ImagePane item={request.item} /> : null}
        {request?.type === "file" ? (
          <FilePane
            name={request.name}
            url={request.url}
            mime={request.mime}
            sizeBytes={request.sizeBytes}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
