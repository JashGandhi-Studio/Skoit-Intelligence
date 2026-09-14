"use client";

import { BrainCircuit, Copy, FileDown, Printer, ShieldCheck } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/misc";
import type { TurnView } from "@/lib/client/cases";
import { copyText, download } from "@/lib/utils";

export function Briefing({ turn, caseTitle }: { turn: TurnView; caseTitle: string }) {
  if (!turn.answer) {
    return null;
  }

  const markdown = turn.answer.replace(
    /\[(\d{1,2})\]/g,
    (_match, index) => `[${index}](#source-${index})`,
  );

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
