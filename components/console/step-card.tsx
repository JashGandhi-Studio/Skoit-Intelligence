"use client";

import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  KeyRound,
  Loader2,
  MinusCircle,
  WifiOff,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import type { StepView } from "@/lib/client/cases";
import { cn, formatDuration } from "@/lib/utils";

const STATUS_META: Record<
  StepView["status"],
  {
    icon: typeof CheckCircle2;
    tone: "success" | "warning" | "danger" | "neutral" | "info";
    label: string;
  }
> = {
  queued: { icon: CircleDashed, tone: "neutral", label: "queued" },
  running: { icon: Loader2, tone: "info", label: "running" },
  ok: { icon: CheckCircle2, tone: "success", label: "ok" },
  partial: { icon: AlertTriangle, tone: "warning", label: "partial" },
  unreachable: { icon: WifiOff, tone: "warning", label: "unreachable" },
  blocked: { icon: KeyRound, tone: "neutral", label: "needs key" },
  error: { icon: XCircle, tone: "danger", label: "error" },
  skipped: { icon: MinusCircle, tone: "neutral", label: "skipped" },
};

const SEVERITY_TONE: Record<string, "danger" | "warning" | "info" | "neutral"> = {
  critical: "danger",
  high: "danger",
  medium: "warning",
  low: "info",
  info: "neutral",
};

export function StepCard({ step, index }: { step: StepView; index: number }) {
  const [open, setOpen] = useState(false);
  const meta = STATUS_META[step.status] ?? STATUS_META.queued;
  const Icon = meta.icon;
  const isRunning = step.status === "running";
  const notable = step.evidence.filter(
    (item) => item.severity && item.severity !== "info",
  );

  return (
    <div
      className={cn(
        "animate-rise rounded-xl border bg-surface transition-colors",
        step.status === "running" ? "border-primary/45" : "border-hairline",
        notable.some((item) => item.severity === "critical") && "border-danger/40",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-start gap-3 px-3.5 py-3 text-left"
        aria-expanded={open}
      >
        <span className="relative mt-0.5 grid size-5 place-items-center">
          <Icon
            className={cn(
              "size-4",
              isRunning && "animate-spin text-primary",
              step.status === "ok" && "text-success",
              step.status === "partial" && "text-warning",
              step.status === "unreachable" && "text-warning",
              step.status === "blocked" && "text-muted-foreground",
              step.status === "error" && "text-danger",
              step.status === "queued" && "text-faint-foreground",
              step.status === "skipped" && "text-faint-foreground",
            )}
          />
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-mono text-[11px] text-faint-foreground tabular">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="truncate text-[13.5px] font-medium text-foreground">
              {step.label}
            </span>
            <Badge tone={meta.tone}>{meta.label}</Badge>
            {step.durationMs !== undefined ? (
              <span className="tabular text-[11px] text-faint-foreground">
                {formatDuration(step.durationMs)}
              </span>
            ) : null}
            {step.evidence.length > 0 ? (
              <span className="tabular text-[11px] text-faint-foreground">
                {step.evidence.length} finding{step.evidence.length === 1 ? "" : "s"}
              </span>
            ) : null}
          </span>
          {step.summary ? (
            <span className="mt-1.5 block text-[12.5px] leading-relaxed text-muted-foreground">
              {step.summary}
            </span>
          ) : null}
        </span>
      </button>

      {open ? (
        <div className="space-y-3 border-t border-hairline px-3.5 py-3">
          <div>
            <div className="text-[11px] font-medium tracking-wide text-faint-foreground uppercase">
              Why this ran
            </div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
              {step.reason}
            </p>
          </div>

          {step.error ? (
            <div className="rounded-lg border border-hairline bg-surface-2 px-2.5 py-2">
              <div className="font-mono text-[10.5px] tracking-wide text-warning uppercase">
                {step.error.code}
              </div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                {step.error.message}
              </p>
            </div>
          ) : null}

          {step.evidence.length > 0 ? (
            <ul className="space-y-2">
              {step.evidence.map((item) => (
                <li
                  key={item.id}
                  className="rounded-lg border border-hairline bg-surface-2/60 px-2.5 py-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[12px] font-medium text-foreground">
                      {item.label}
                    </span>
                    {item.severity ? (
                      <Badge tone={SEVERITY_TONE[item.severity] ?? "neutral"} mono>
                        {item.severity}
                      </Badge>
                    ) : null}
                    <Badge tone="neutral" mono>
                      {item.confidence}
                    </Badge>
                  </div>
                  <div className="data-mono mt-1.5 break-words whitespace-pre-wrap text-foreground">
                    {item.value}
                  </div>
                  {item.detail ? (
                    <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
                      {item.detail}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12.5px] text-faint-foreground">
              No findings were returned by this source.
            </p>
          )}

          {step.logs.length > 0 ? (
            <div className="rounded-lg border border-hairline bg-surface-2/40 px-2.5 py-2">
              <div className="text-[11px] font-medium tracking-wide text-faint-foreground uppercase">
                Run log
              </div>
              <ul className="mt-1 space-y-0.5">
                {step.logs.map((log) => (
                  <li key={log.id} className="data-mono text-faint-foreground">
                    {log.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
