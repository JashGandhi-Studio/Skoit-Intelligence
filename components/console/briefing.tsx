"use client";

import {
  BrainCircuit,
  CircleStop,
  Copy,
  FileDown,
  Globe2,
  Printer,
  ShieldCheck,
  Volume2,
} from "lucide-react";
import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/misc";
import type { TurnView } from "@/lib/client/cases";
import { buildStyledPdf, markdownishToInput } from "@/lib/client/pdf-make";
import { NEWS_EDITIONS, QUICK_COUNTRY_CODES } from "@/lib/news-editions";
import { copyText, download } from "@/lib/utils";

export function Briefing({
  turn,
  caseTitle,
  onQuickPrompt,
}: {
  turn: TurnView;
  caseTitle: string;
  onQuickPrompt?: (prompt: string) => void;
}) {
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  if (!turn.answer) {
    return null;
  }

  // Speak the briefing in the language the question was asked in — the
  // browser's own voices, nothing recorded or uploaded.
  const speakLanguage = /[\u0900-\u097F]/.test(turn.answer)
    ? "hi-IN"
    : /[\u0980-\u09FF]/.test(turn.answer)
      ? "bn-IN"
      : /[\u0B80-\u0BFF]/.test(turn.answer)
        ? "ta-IN"
        : turn.answerMode === "model" && turn.question
          ? /[\u0900-\u097F]/.test(turn.question)
            ? "hi-IN"
            : "en-IN"
          : "en-IN";

  const toggleSpeak = () => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      toast.error("This browser has no speech voices");
      return;
    }
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const spoken = (turn.answer ?? "")
      .replace(/[#*_`>[\]]/g, " ")
      .replace(/https?:\/\/\S+/g, " ")
      .slice(0, 2400);
    const utterance = new SpeechSynthesisUtterance(spoken);
    utterance.lang = speakLanguage;
    utterance.rate = 1;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    setSpeaking(true);
  };

  const asksCountry = turn.answer.includes("{{ASK_COUNTRY}}");
  const markdown = turn.answer
    .replace("{{ASK_COUNTRY}}", "")
    .trim()
    .replace(/\[(\d{1,2})\]/g, (_match, index) => `[${index}](#source-${index})`);

  const saveAsPdf = async () => {
    const sections = markdownishToInput(
      turn.answer ?? "",
      turn.question.slice(0, 120) || "SkOiT briefing",
      caseTitle,
    );
    const built = await buildStyledPdf({
      ...sections,
      meta: `SkOiT analyst briefing · case: ${caseTitle} · ${new Date().toLocaleDateString()}`,
      links: turn.sources
        .filter((entry) => entry.url)
        .map((entry) => ({ label: entry.label, url: entry.url as string })),
    });
    const { downloadGenerated } = await import("@/lib/client/download");
    downloadGenerated(built.filename, built.blob);
    toast.success(`Briefing saved as ${built.filename}`);
  };

  return (
    <article className="animate-rise rounded-xl border border-hairline bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <BrainCircuit className="size-4 text-primary" />
          <span className="text-[12px] font-medium tracking-wide text-muted-foreground uppercase">
            Analyst briefing
          </span>
          <Badge tone={turn.answerMode === "model" ? "primary" : "neutral"} mono>
            {turn.answerMode === "model" ? (turn.model ?? "model") : "deterministic"}
          </Badge>
        </div>
        <div className="no-print flex items-center gap-1">
          <Tip label={`Read this briefing aloud (${speakLanguage})`}>
            <Button variant="ghost" size="iconSm" onClick={toggleSpeak}>
              {speaking ? <CircleStop className="text-danger" /> : <Volume2 />}
            </Button>
          </Tip>
          <Tip label="Save this briefing as a formatted PDF">
            <Button variant="ghost" size="iconSm" onClick={() => void saveAsPdf()}>
              <FileDown className="text-primary-strong" />
            </Button>
          </Tip>
          <Tip label="Copy the briefing as markdown">
            <Button
              variant="ghost"
              size="iconSm"
              onClick={async () => {
                const ok = await copyText(turn.answer ?? "");
                toast[ok ? "success" : "error"](
                  ok ? "Briefing copied" : "Clipboard blocked by the browser",
                );
              }}
            >
              <Copy />
            </Button>
          </Tip>
          <Tip label="Download this briefing">
            <Button
              variant="ghost"
              size="iconSm"
              onClick={() =>
                download(
                  `${caseTitle.replace(/\s+/g, "-").toLowerCase()}-briefing.md`,
                  `# ${turn.question}\n\n${turn.answer ?? ""}`,
                  "text/markdown",
                )
              }
            >
              <FileDown />
            </Button>
          </Tip>
          <Tip label="Print or save as PDF">
            <Button variant="ghost" size="iconSm" onClick={() => window.print()}>
              <Printer />
            </Button>
          </Tip>
        </div>
      </header>

      <div className="prose-skoit prose prose-sm max-w-none px-4 py-3.5 dark:prose-invert">
        <Markdown
          remarkPlugins={[remarkGfm]}
          components={{
            h3: ({ children }) => (
              <h3 className="mt-4 mb-2 flex items-center gap-2 text-[13px] font-semibold tracking-wide text-muted-foreground uppercase first:mt-0">
                {children}
              </h3>
            ),
            p: ({ children }) => <p className="mb-2.5 leading-relaxed">{children}</p>,
            ul: ({ children }) => <ul className="mb-3 space-y-1.5 pl-4">{children}</ul>,
            li: ({ children }) => (
              <li className="leading-relaxed marker:text-hairline-strong">{children}</li>
            ),
            strong: ({ children }) => (
              <strong className="font-semibold text-foreground">{children}</strong>
            ),
            code: ({ children, className }) => (
              <code
                className={
                  className
                    ? "block overflow-x-auto rounded-lg border border-hairline bg-surface-2 p-2 font-mono text-[12px]"
                    : "rounded bg-surface-2 px-1 py-0.5 font-mono text-[11.5px] text-foreground"
                }
              >
                {children}
              </code>
            ),
            a: ({ href, children }) => {
              if (href?.startsWith("#source-")) {
                return (
                  <a
                    href={href}
                    className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded border border-hairline-strong bg-surface-2 px-1 align-middle font-mono text-[10px] text-primary-strong no-underline hover:border-primary/50"
                  >
                    {children}
                  </a>
                );
              }
              return (
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-primary-strong underline decoration-dotted"
                >
                  {children}
                </a>
              );
            },
          }}
        >
          {markdown}
        </Markdown>
      </div>

      {asksCountry && onQuickPrompt ? (
        <div className="border-t border-hairline px-4 py-3">
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-faint-foreground uppercase">
            <Globe2 className="size-3.5 text-primary" />
            Tap your country
          </p>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_COUNTRY_CODES.map((code) => {
              const edition = NEWS_EDITIONS.find((entry) => entry.code === code);
              if (!edition) {
                return null;
              }
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() =>
                    onQuickPrompt(`Show the latest news from ${edition.label}`)
                  }
                  className="flex items-center gap-1.5 rounded-full border border-hairline px-3 py-1.5 text-[12.5px] font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-primary-soft"
                >
                  <span aria-hidden>{edition.flag}</span>
                  {edition.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {turn.sources.length > 0 ? (
        <footer className="border-t border-hairline px-4 py-3">
          <div className="mb-2 flex items-center gap-2">
            <ShieldCheck className="size-3.5 text-success" />
            <span className="text-[11px] font-medium tracking-wide text-faint-foreground uppercase">
              Cited sources
            </span>
          </div>
          <ol className="grid gap-1.5 sm:grid-cols-2">
            {turn.sources.map((sourceRef, index) => (
              <li
                key={sourceRef.id}
                id={`source-${index + 1}`}
                className="flex items-start gap-2 text-[12px] text-muted-foreground"
              >
                <span className="mt-px font-mono text-[10.5px] text-faint-foreground tabular">
                  [{index + 1}]
                </span>
                {sourceRef.url ? (
                  <a
                    href={sourceRef.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="truncate hover:text-foreground hover:underline"
                  >
                    {sourceRef.label}
                  </a>
                ) : (
                  <span className="truncate">{sourceRef.label}</span>
                )}
              </li>
            ))}
          </ol>
        </footer>
      ) : null}
    </article>
  );
}
