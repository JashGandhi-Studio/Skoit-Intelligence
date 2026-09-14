"use client";

import { Crosshair, Route } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/misc";
import type { TurnView } from "@/lib/client/cases";

const KIND_TONE: Record<string, "primary" | "info" | "warning" | "neutral"> = {
  domain: "primary",
  url: "info",
  ip: "primary",
  email: "warning",
  phone: "warning",
  username: "info",
  person: "warning",
  coordinate: "info",
  hash: "neutral",
  text: "neutral",
};

export function PlanCard({ turn }: { turn: TurnView }) {
  const total = turn.steps.length;
  const settled = turn.steps.filter((step) =>
    ["ok", "partial", "unreachable", "blocked", "error", "skipped"].includes(step.status),
  ).length;
  const progress = total === 0 ? 0 : Math.round((settled / total) * 100);

  if (total === 0 && turn.targets.length === 0) {
    return null;
  }

  return (
    <div className="rounded-xl border border-hairline bg-surface-2/50 p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Route className="size-3.5 text-primary" />
          <span className="text-[12px] font-medium tracking-wide text-muted-foreground uppercase">
            Collection plan
          </span>
          <span className="tabular text-[11px] text-faint-foreground">
            {settled}/{total} settled
          </span>
        </div>
        <Progress value={progress} className="h-1 w-24" />
      </div>

      {turn.targets.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Crosshair className="size-3.5 text-faint-foreground" />
          {turn.targets.slice(0, 6).map((target) => (
            <Badge
              key={`${target.kind}-${target.value}`}
              tone={KIND_TONE[target.kind] ?? "neutral"}
              mono
            >
              {target.kind}:{" "}
              {target.value.length > 42 ? `${target.value.slice(0, 40)}…` : target.value}
            </Badge>
          ))}
        </div>
      ) : null}

      {turn.rationale ? (
        <p className="mt-2.5 text-[12.5px] leading-relaxed text-muted-foreground">
          {turn.rationale}
        </p>
      ) : null}
    </div>
  );
}
