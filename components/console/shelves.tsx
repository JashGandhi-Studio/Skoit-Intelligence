"use client";

import {
  BookOpen,
  Download,
  GraduationCap,
  Languages,
  LoaderCircle,
  ShoppingCart,
  Tag,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { forceDownload } from "@/lib/client/download";
import { translateArticles } from "@/lib/client/translate";
import { looksLikePdf } from "@/lib/client/web-search";
import type { ArticleItem } from "@/lib/types";
import { cn, truncate } from "@/lib/utils";
import { priceFromSnippet } from "@/lib/verify-values";

/**
 * Structured shelves for the two asks that deserve better than a link list:
 * board papers (year · board · subject · direct PDF) and product offers
 * (same item, store by store, with the honest "this price is from the search
 * snippet" label). Plus the instant translate strip for news.
 */

/* ------------------------------------------------------------ papers ----- */

function boardOf(item: ArticleItem): { label: string; tone: string } {
  const text = `${item.title} ${item.snippet ?? ""}`.toLowerCase();
  if (/\bicse\b|cisce/.test(text)) {
    return {
      label: "ICSE",
      tone: "border-primary/40 bg-primary-soft text-primary-strong",
    };
  }
  if (/\bisc\b\b|cisce/.test(text)) {
    return {
      label: "ISC",
      tone: "border-primary/40 bg-primary-soft text-primary-strong",
    };
  }
  if (/\bcbse\b/.test(text)) {
    return { label: "CBSE", tone: "border-accent/40 bg-accent-soft text-accent" };
  }
  if (/\b(ssc|hsc)\b|maharashtra state board/.test(text)) {
    return { label: "State board", tone: "border-success/40 bg-success/10 text-success" };
  }
  if (/\bigcse\b|cambridge/.test(text)) {
    return { label: "IGCSE", tone: "border-warning/40 bg-warning/10 text-warning" };
  }
  if (/\bib\b|international baccalaureate/.test(text)) {
    return { label: "IB", tone: "border-warning/40 bg-warning/10 text-warning" };
  }
  return { label: "Board?", tone: "border-hairline bg-surface-2 text-muted-foreground" };
}

function yearOf(item: ArticleItem): string | undefined {
  const years = item.title.match(/\b(20[0-2]\d)\b/g);
  return years?.[0];
}

function subjectOf(item: ArticleItem): string | undefined {
  const subjects = [
    "physics",
    "chemistry",
    "mathematics",
    "maths",
    "biology",
    "english",
    "hindi",
    "marathi",
    "history",
    "civics",
    "geography",
    "economics",
    "accounts",
    "accountancy",
    "commerce",
    "science",
    "social science",
    "computer",
    "environmental",
  ];
  const text = item.title.toLowerCase();
  return subjects.find((subject) => text.includes(subject));
}

export function PapersShelf({
  items,
  onOpenViewer,
}: {
  items: ArticleItem[];
  onOpenViewer: (request: {
    type: "pdf" | "article";
    url: string;
    title: string;
    article: ArticleItem;
  }) => void;
}) {
  if (items.length === 0) {
    return null;
  }
  const sorted = [...items].sort((a, b) => {
    const pdfDelta = Number(looksLikePdf(b.url)) - Number(looksLikePdf(a.url));
    if (pdfDelta !== 0) {
      return pdfDelta;
    }
    return (yearOf(b) ?? "0").localeCompare(yearOf(a) ?? "0");
  });
  const pdfCount = sorted.filter((item) => looksLikePdf(item.url)).length;

  return (
    <section className="animate-rise space-y-2 rounded-2xl border border-hairline bg-surface/60 p-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-[12.5px] font-semibold tracking-tight text-foreground">
          <GraduationCap className="size-4 text-primary" />
          Papers shelf
          <span className="text-[11px] font-normal text-faint-foreground">
            {pdfCount > 0
              ? `${pdfCount} direct PDF${pdfCount === 1 ? "" : "s"}`
              : "open each to download"}
          </span>
        </h3>
      </header>
      <ul className="space-y-1.5">
        {sorted.slice(0, 14).map((item) => {
          const board = boardOf(item);
          const year = yearOf(item);
          const subject = subjectOf(item);
          const isPdf = looksLikePdf(item.url);
          return (
            <li
              key={item.id}
              className="flex flex-wrap items-center gap-2 rounded-xl border border-hairline bg-surface px-2.5 py-2 transition-colors hover:border-primary/30"
            >
              <span
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                  board.tone,
                )}
              >
                {board.label}
              </span>
              {year ? (
                <span className="rounded-full bg-surface-3 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {year}
                </span>
              ) : null}
              {subject ? (
                <span className="text-[11px] text-muted-foreground capitalize">
                  {subject}
                </span>
              ) : null}
              <button
                type="button"
                onClick={() =>
                  isPdf
                    ? onOpenViewer({
                        type: "pdf",
                        url: item.url,
                        title: item.title,
                        article: item,
                      })
                    : onOpenViewer({
                        type: "article",
                        url: item.url,
                        title: item.title,
                        article: item,
                      })
                }
                className="min-w-0 flex-1 text-left text-[12.5px] leading-snug font-medium text-foreground hover:text-primary-strong"
                title={item.title}
              >
                {truncate(item.title, 96)}
              </button>
              <div className="flex shrink-0 items-center gap-1.5">
                <Button
                  variant="primary"
                  size="sm"
                  className="h-7 px-2 text-[11px]"
                  onClick={() =>
                    isPdf
                      ? onOpenViewer({
                          type: "pdf",
                          url: item.url,
                          title: item.title,
                          article: item,
                        })
                      : onOpenViewer({
                          type: "article",
                          url: item.url,
                          title: item.title,
                          article: item,
                        })
                  }
                >
                  <BookOpen />
                  {isPdf ? "Open" : "Read"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-[11px]"
                  onClick={() =>
                    void forceDownload(item.url, item.title, {
                      ext: isPdf ? ".pdf" : "",
                      prefix: "skoit-paper",
                    }).then((result) => {
                      toast[result.mode === "failed" ? "error" : "success"](
                        result.mode === "failed"
                          ? "The source refused a direct copy — it opened in a tab instead"
                          : `Saved ${result.filename}`,
                      );
                    })
                  }
                >
                  <Download />
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="border-t border-hairline pt-2 text-[10.5px] text-faint-foreground">
        Boards: ICSE/ISC (CISCE), CBSE, state boards, IGCSE/IB — labelled from the page
        itself; “Board?” means the source did not say clearly. Open a paper before
        printing: formatting is the publisher's.
      </p>
    </section>
  );
}

/* ------------------------------------------------------------ offers ----- */

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").split(".")[0];
  } catch {
    return "store";
  }
}

export function OffersTable({ items }: { items: ArticleItem[] }) {
  if (items.length === 0) {
    return null;
  }
  const rows = items
    .map((item) => ({
      item,
      price: item.snippet ? priceFromSnippet(`${item.title} ${item.snippet}`) : undefined,
    }))
    .sort((a, b) => (a.price?.value ?? Infinity) - (b.price?.value ?? Infinity));
  const withPrices = rows.filter((row) => row.price).length;

  return (
    <section className="animate-rise space-y-2 rounded-2xl border border-hairline bg-surface/60 p-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-[12.5px] font-semibold tracking-tight text-foreground">
          <ShoppingCart className="size-4 text-primary" />
          Price hunt
        </h3>
        <span className="text-[10.5px] text-faint-foreground">
          {withPrices > 0
            ? `${withPrices} listing(s) with a visible price — sorted cheapest first`
            : "open each listing to see its live price"}
        </span>
      </header>
      <div className="overflow-x-auto rounded-xl border border-hairline">
        <table className="w-full min-w-[430px] text-left text-[12px]">
          <thead>
            <tr className="border-b border-hairline bg-surface-2/70 text-[10.5px] tracking-wide text-faint-foreground uppercase">
              <th className="px-2.5 py-1.5 font-medium">Store</th>
              <th className="px-2.5 py-1.5 font-medium">Listing</th>
              <th className="px-2.5 py-1.5 font-medium">Price in snippet</th>
              <th className="px-2.5 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 12).map(({ item, price }) => (
              <tr key={item.id} className="border-b border-hairline/60 last:border-0">
                <td className="px-2.5 py-2 font-medium text-foreground">
                  {hostLabel(item.url)}
                </td>
                <td className="max-w-55 px-2.5 py-2">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="line-clamp-2 text-muted-foreground hover:text-primary-strong"
                    title={item.title}
                  >
                    {truncate(item.title, 72)}
                  </a>
                </td>
                <td className="px-2.5 py-2">
                  {price ? (
                    <span className="flex items-center gap-1.5">
                      <Tag className="size-3 text-primary" />
                      <span className="font-mono text-[12.5px] font-medium text-foreground">
                        ₹{price.value.toLocaleString("en-IN")}
                      </span>
                    </span>
                  ) : (
                    <span className="text-[11px] text-faint-foreground">open to see</span>
                  )}
                </td>
                <td className="px-2.5 py-2 text-right">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex h-7 items-center rounded-lg border border-hairline px-2 text-[11px] text-primary-strong hover:bg-primary-soft"
                  >
                    Open
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-hairline pt-2 text-[10.5px] leading-relaxed text-faint-foreground">
        Every figure above is read from the search snippet, which can be hours old or show
        a variant of the item — the store's own page is the only price that counts. Stores
        also block automated price checks, so nothing here is quoted as authoritative.
      </p>
    </section>
  );
}

/* --------------------------------------------------------- translate ----- */

export function TranslateStrip({
  articles,
  onTranslation,
}: {
  articles: ArticleItem[];
  onTranslation: (
    titles: Map<string, string>,
    snippets: Map<string, string> | null,
  ) => void;
}) {
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(false);
  const [partial, setPartial] = useState(0);

  if (articles.length === 0) {
    return null;
  }

  const run = async (langCode: string) => {
    setBusy(true);
    try {
      const result = await translateArticles(
        articles.map((article) => ({
          url: article.url,
          title: article.title,
          snippet: article.snippet,
        })),
        langCode,
        { max: 12 },
      );
      if (result.titles.size === 0) {
        toast.error("Translation could not be reached — showing originals");
        onTranslation(new Map(), null);
        setActive(false);
      } else {
        onTranslation(result.titles, result.snippets);
        setPartial(result.partial);
        setActive(true);
      }
      setTarget(langCode);
    } catch {
      toast.error("Translation failed — showing originals");
      onTranslation(new Map(), null);
      setActive(false);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    onTranslation(new Map(), null);
    setActive(false);
    setTarget("");
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-hairline bg-surface-2/50 px-3 py-2">
      <Languages className="size-3.5 text-primary" />
      {busy ? (
        <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <LoaderCircle className="size-3.5 animate-spin" />
          Translating headlines…
        </span>
      ) : active ? (
        <span className="text-[12px] text-muted-foreground">
          Machine translation
          {partial > 0 ? ` (${partial} skipped)` : ""} —{" "}
          <button
            type="button"
            className="font-medium text-primary-strong hover:underline"
            onClick={reset}
          >
            show originals
          </button>
        </span>
      ) : (
        <span className="text-[12px] text-muted-foreground">Translate headlines to:</span>
      )}
      <div className="flex flex-wrap gap-1">
        {[
          ["hi", "हिंदी"],
          ["mr", "मराठी"],
          ["ta", "தமிழ்"],
          ["te", "తెలుగు"],
          ["bn", "বাংলা"],
          ["gu", "ગુજરાતી"],
          ["en", "English"],
        ].map(([code, label]) => (
          <button
            key={code}
            type="button"
            disabled={busy}
            onClick={() => void run(code)}
            className={cn(
              "rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-50",
              target === code && active
                ? "border-primary/50 bg-primary-soft text-primary-strong"
                : "border-hairline text-muted-foreground hover:bg-surface",
            )}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
