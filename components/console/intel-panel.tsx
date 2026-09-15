"use client";

import {
  Activity,
  Database,
  Fingerprint,
  Link2,
  ShieldAlert,
  ShieldQuestion,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tab, TabContent, TabList, Tabs } from "@/components/ui/misc";
import type { TurnView } from "@/lib/client/cases";
import { cn, formatClock } from "@/lib/utils";

const BAND_TONE: Record<string, "success" | "info" | "warning" | "danger"> = {
  minimal: "success",
  guarded: "info",
  elevated: "warning",
  high: "danger",
  severe: "danger",
};

const SEVERITY_TONE: Record<string, "danger" | "warning" | "info" | "neutral"> = {
  critical: "danger",
  high: "danger",
  medium: "warning",
  low: "info",
  info: "neutral",
};

export function RiskGauge({
  score,
  band,
  summary,
  factors,
}: {
  score: number;
  band: string;
  summary: string;
  factors: Array<{ label: string; weight: number; detail: string }>;
}) {
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const dash = (Math.max(0, Math.min(100, score)) / 100) * circumference;
  const color =
    band === "minimal"
      ? "var(--success)"
      : band === "guarded"
        ? "var(--info)"
        : band === "elevated"
          ? "var(--warning)"
          : "var(--danger)";

  return (
    <div className="rounded-xl border border-hairline bg-surface p-3.5">
      <div className="flex items-center gap-3.5">
        <div className="relative grid size-[86px] shrink-0 place-items-center">
          <svg viewBox="0 0 80 80" className="absolute inset-0 -rotate-90">
            <circle
              cx="40"
              cy="40"
              r={radius}
              fill="none"
              stroke="var(--hairline)"
              strokeWidth="6"
            />
            <circle
              cx="40"
              cy="40"
              r={radius}
              fill="none"
              stroke={color}
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={`${dash} ${circumference}`}
              className="transition-[stroke-dasharray] duration-500"
            />
          </svg>
          <div className="text-center">
            <div className="tabular text-[19px] leading-none font-semibold text-foreground">
              {score}
            </div>
            <div className="mt-0.5 text-[9.5px] tracking-wide text-faint-foreground uppercase">
              /100
            </div>
          </div>
        </div>
        <div className="min-w-0">
          <Badge tone={BAND_TONE[band] ?? "neutral"} mono>
            {band}
          </Badge>
          <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
            {summary}
          </p>
        </div>
      </div>

      {factors.length > 0 ? (
        <ul className="mt-3 space-y-1.5 border-t border-hairline pt-3">
          {factors.map((factor) => (
            <li
              key={`${factor.label}-${factor.weight}`}
              className="flex items-start gap-2.5"
            >
              <span className="tabular mt-px w-7 shrink-0 text-right font-mono text-[11px] text-faint-foreground">
                +{factor.weight}
              </span>
              <span className="min-w-0">
                <span className="block text-[12.5px] font-medium text-foreground">
                  {factor.label}
                </span>
                <span className="block text-[11.5px] leading-relaxed text-muted-foreground">
                  {factor.detail}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function EmptyIntel({ hint }: { hint: string }) {
  return (
    <div className="grid place-items-center rounded-xl border border-dashed border-hairline px-4 py-8 text-center">
      <ShieldQuestion className="size-5 text-faint-foreground" />
      <p className="mt-2 max-w-[240px] text-[12.5px] leading-relaxed text-faint-foreground">
        {hint}
      </p>
    </div>
  );
}

export function IntelPanel({
  turn,
  className,
}: {
  turn: TurnView | null;
  className?: string;
}) {
  const findings = turn?.evidence ?? [];
  const flagged = findings.filter((item) => item.severity && item.severity !== "info");
  const entities = turn?.entities ?? [];
  const sources = turn?.sources ?? [];

  return (
    <div className={cn("flex h-full min-h-0 flex-col gap-3", className)}>
      {turn?.risk ? (
        <RiskGauge
          score={turn.risk.score}
          band={turn.risk.band}
          summary={turn.risk.summary}
          factors={turn.risk.factors}
        />
      ) : (
        <div className="rounded-xl border border-hairline bg-surface p-3.5">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Activity className="size-4" />
            <span className="text-[12px] font-medium tracking-wide uppercase">
              Risk read
            </span>
          </div>
          <p className="mt-2 text-[12.5px] leading-relaxed text-faint-foreground">
            The risk band is computed arithmetically from what the sources returned —
            including penalties for sources that could not be reached. It stays empty
            until a collection run finishes.
          </p>
        </div>
      )}

      <Tabs defaultValue="findings" className="flex min-h-0 flex-1 flex-col gap-2.5">
        <TabList className="w-full justify-between">
          <Tab value="findings" count={findings.length}>
            Findings
          </Tab>
          <Tab value="entities" count={entities.length}>
            Pivots
          </Tab>
          <Tab value="sources" count={sources.length}>
            Sources
          </Tab>
        </TabList>

        <TabContent value="findings">
          <div className="thin-scroll h-full overflow-y-auto">
            {findings.length === 0 ? (
              <EmptyIntel hint="Findings appear here as each skill reports. Every entry is evidence with a source, a confidence level and, where relevant, a severity." />
            ) : (
              <ul className="space-y-2 pr-1 pb-4">
                {findings.map((item) => (
                  <li
                    key={item.id}
                    className="rounded-lg border border-hairline bg-surface p-2.5"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[12px] font-medium text-foreground">
                        {item.label}
                      </span>
                      {item.severity && item.severity !== "info" ? (
                        <Badge tone={SEVERITY_TONE[item.severity] ?? "neutral"} mono>
                          {item.severity}
                        </Badge>
                      ) : null}
                      <Badge tone="neutral" mono={false}>
                        {item.confidence}
                      </Badge>
                    </div>
                    <p className="data-mono mt-1.5 break-words text-foreground">
                      {item.value}
                    </p>
                    {item.detail ? (
                      <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
                        {item.detail}
                      </p>
                    ) : null}
                    <p className="mt-1.5 text-[10.5px] text-faint-foreground">
                      {item.skillId} · {formatClock(item.observedAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </TabContent>

        <TabContent value="entities">
          <div className="thin-scroll h-full overflow-y-auto">
            {entities.length === 0 ? (
              <EmptyIntel hint="Anything the sources surfaced that is worth pivoting on — subdomains, addresses, handles, dates — is grouped here." />
            ) : (
              <ul className="space-y-1.5 pr-1 pb-4">
                {entities.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-start gap-2.5 rounded-lg border border-hairline bg-surface px-2.5 py-2"
                  >
                    <Fingerprint className="mt-0.5 size-3.5 shrink-0 text-faint-foreground" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <Badge tone="info" mono>
                          {item.type}
                        </Badge>
                        <Badge tone="neutral" mono>
                          {item.confidence}
                        </Badge>
                      </div>
                      <p className="data-mono mt-1 break-all text-foreground">
                        {item.value}
                      </p>
                      {item.label ? (
                        <p className="mt-0.5 text-[11px] text-faint-foreground">
                          {item.label}
                        </p>
                      ) : null}
                      {item.attributes.length > 0 ? (
                        <p className="mt-0.5 text-[11px] text-faint-foreground">
                          {item.attributes
                            .map((attribute) => `${attribute.key}=${attribute.value}`)
                            .join(" · ")}
                        </p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </TabContent>

        <TabContent value="sources">
          <div className="thin-scroll h-full overflow-y-auto">
            {sources.length === 0 ? (
              <EmptyIntel hint="Every consulted source is listed with the time it was accessed, whether it succeeded or not. Unreachable sources stay visible here." />
            ) : (
              <ul className="space-y-1.5 pr-1 pb-4">
                {sources.map((sourceRef, index) => (
                  <li
                    key={sourceRef.id}
                    className="rounded-lg border border-hairline bg-surface px-2.5 py-2"
                  >
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 font-mono text-[10.5px] text-faint-foreground tabular">
                        [{index + 1}]
                      </span>
                      <div className="min-w-0">
                        <p className="text-[12.5px] font-medium text-foreground">
                          {sourceRef.label}
                        </p>
                        {sourceRef.url ? (
                          <a
                            href={sourceRef.url}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-primary-strong hover:underline"
                          >
                            <Link2 className="size-3 shrink-0" />
                            <span className="truncate">{sourceRef.url}</span>
                          </a>
                        ) : (
                          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-faint-foreground">
                            <Database className="size-3" /> local dataset, no network call
                          </p>
                        )}
                        <p className="mt-0.5 text-[10.5px] text-faint-foreground">
                          {sourceRef.kind} · accessed {formatClock(sourceRef.accessedAt)}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </TabContent>
      </Tabs>

      {turn?.stats ? (
        <div className="flex items-center gap-3 rounded-xl border border-hairline bg-surface-2/60 px-3 py-2">
          <Sparkles className="size-3.5 text-primary" />
          <p className="text-[11.5px] text-muted-foreground">
            {turn.stats.steps} skills · {turn.stats.evidence} findings ·{" "}
            {turn.stats.entities} pivots · {turn.stats.sources} sources
            {turn.media.length + turn.articles.length > 0 ? (
              <>
                {" "}
                · {turn.media.filter((item) => item.kind === "image").length} image(s) ·{" "}
                {turn.media.filter((item) => item.kind === "video").length} clip(s) ·{" "}
                {turn.articles.length} article(s)
              </>
            ) : null}
          </p>
        </div>
      ) : null}

      {flagged.length > 0 ? (
        <div className="flex items-start gap-2 rounded-xl border border-warning/35 bg-warning/8 px-3 py-2">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-warning" />
          <p className="text-[11.5px] leading-relaxed text-muted-foreground">
            {flagged.length} finding{flagged.length === 1 ? "" : "s"} carry a severity
            above informational. Handle the case file accordingly — it may contain
            personal data.
          </p>
        </div>
      ) : null}
    </div>
  );
}
