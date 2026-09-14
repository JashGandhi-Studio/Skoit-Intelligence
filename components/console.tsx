"use client";

import {
  ChevronDown,
  Info,
  Menu,
  Moon,
  PanelRight,
  Pencil,
  ShieldQuestion,
  Sun,
  Wifi,
  WifiOff,
  Wrench,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Briefing } from "@/components/console/briefing";
import { CaseSidebar } from "@/components/console/case-sidebar";
import { Composer, type ComposerSubmission } from "@/components/console/composer";
import { IntelPanel } from "@/components/console/intel-panel";
import { PlanCard } from "@/components/console/plan-card";
import { SettingsDialog } from "@/components/console/settings";
import { StepCard } from "@/components/console/step-card";
import { useTheme } from "@/components/theme-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/field";
import { Skeleton, Tip } from "@/components/ui/misc";
import {
  type AnalysisBundle,
  assessRisk,
  deterministicBriefing,
} from "@/lib/agent/synthesize";
import {
  applyEvent,
  bundleFromTurn,
  type TurnView,
  toCaseTurn,
  useCases,
} from "@/lib/client/cases";
import { runClientPass } from "@/lib/client/runner";
import { getSkill, manifest } from "@/lib/skills";
import { detectTargets } from "@/lib/skills/identify";
import type {
  AgentEvent,
  AgentRequest,
  CaseFile,
  CaseTurn,
  RiskAssessment,
} from "@/lib/types";
import { cn, formatDuration } from "@/lib/utils";

/**
 * Never lets a merged pass silently contradict the write-up: the model briefing
 * is kept and gains a labelled addendum, while an analyst briefing is rebuilt
 * over the merged bundle.
 */
function mergedAnswer(
  turn: TurnView,
  bundle: AnalysisBundle,
  risk: RiskAssessment,
  evidenceBeforePass: number,
): string {
  if (turn.answerMode !== "model" || !turn.answer) {
    return deterministicBriefing(bundle, risk);
  }
  const added = turn.evidence.slice(evidenceBeforePass);
  if (added.length === 0) {
    return turn.answer;
  }
  return [
    turn.answer,
    "",
    "---",
    "",
    "### Browser-side addendum",
    "",
    `Collected after the server pass, from this browser. Risk is re-scored over the merged set: **${risk.band}** (${risk.score}/100).`,
    "",
    ...added.map(
      (item) =>
        `- **${item.label}** — ${item.value}${item.detail ? `\n  - ${item.detail}` : ""}`,
    ),
  ].join("\n");
}

const STARTERS = [
  {
    label: "Domain posture",
    prompt:
      "Assess example.com: registration age, mail spoofing posture, certificate transparency subdomains and lookalike domains.",
  },
  {
    label: "Address triage",
    prompt:
      "What is 8.8.8.8 — network owner, geolocation, passive scan noise and reverse DNS?",
  },
  {
    label: "India PIN",
    prompt: "411001 — which state, district and delivery offices does this PIN cover?",
  },
  {
    label: "Plate decode",
    prompt:
      "MH12AB1234 — decode the state, RTO zone and explain what is and is not legally obtainable.",
  },
  {
    label: "Handle footprint",
    prompt:
      "Find what public platforms the handle @torvalds has profiles on, and what those profiles expose.",
  },
  {
    label: "Link dissection",
    prompt:
      "Dissect this link before anything touches it: http://sbi-online-kyc.verify-login.top/account/update",
  },
];

function TurnViewFromSaved(turn: CaseTurn): TurnView {
  return {
    id: turn.id,
    question: turn.question,
    createdAt: turn.createdAt,
    finishedAt: turn.createdAt + turn.durationMs,
    phase: "done",
    targets: [],
    steps: turn.steps.map((step) => ({
      stepId: step.id,
      skillId: step.skillId,
      label: step.label,
      targetKind: step.targetKind,
      target: step.target,
      reason: step.reason,
      status: step.status,
      evidence: turn.evidence.filter((item) => item.skillId === step.skillId),
      logs: [],
    })),
    evidence: turn.evidence,
    entities: turn.entities.map((item) => ({
      id: item.id,
      type: item.type,
      value: item.value,
      label: item.label,
      confidence: item.confidence,
      attributes: item.attributes,
    })),
    sources: turn.sources,
    risk: turn.risk,
    answer: turn.answer,
    answerMode: turn.mode,
    model: turn.model,
    notices: [],
    stats: {
      steps: turn.steps.length,
      evidence: turn.evidence.length,
      entities: turn.entities.length,
      sources: turn.sources.length,
    },
  };
}

export function Console() {
  const {
    cases,
    active,
    activeId,
    createCase,
    updateCase,
    deleteCase,
    selectCase,
    importCase,
    hydrated,
  } = useCases();
  const { theme, toggle } = useTheme();
  const [turns, setTurns] = useState<TurnView[]>([]);
  const [busy, setBusy] = useState(false);
  const [egress, setEgress] = useState<boolean | null>(null);
  const [modelLabel, setModelLabel] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [mobileNav, setMobileNav] = useState(false);
  const [mobileIntel, setMobileIntel] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const hydratedCaseRef = useRef<string | null>(null);
  const startedRef = useRef<number>(0);

  const skills = useMemo(() => manifest(), []);

  // Hydrate the saved turns when a *different* case is opened. Keyed on the id so
  // that saving mid-run (which replaces the case object) never clears the live view.
  useEffect(() => {
    if (!active) {
      if (hydratedCaseRef.current !== null) {
        hydratedCaseRef.current = null;
        setTurns([]);
      }
      return;
    }
    if (hydratedCaseRef.current === active.id) {
      return;
    }
    hydratedCaseRef.current = active.id;
    setTurns(active.turns.map(TurnViewFromSaved));
  }, [active]);

  useEffect(() => {
    fetch("/api/capabilities")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { egress?: boolean } | null) => {
        if (data) {
          setEgress(Boolean(data.egress));
        }
      })
      .catch(() => setEgress(null));
  }, []);

  useEffect(() => {
    if (!busy) {
      return;
    }
    const timer = setInterval(() => setElapsed(Date.now() - startedRef.current), 200);
    return () => clearInterval(timer);
  }, [busy]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) {
      node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
    }
  }, []);

  const patchTurn = useCallback((turnId: string, event: AgentEvent) => {
    setTurns((current) =>
      current.map((turn) => (turn.id === turnId ? applyEvent(turn, event) : turn)),
    );
  }, []);

  const persistTurn = useCallback(
    (caseId: string, turn: TurnView) => {
      updateCase(caseId, (caseFile) => ({
        ...caseFile,
        targets: [
          ...caseFile.targets,
          ...turn.targets
            .filter(
              (target) =>
                !caseFile.targets.some((existing) => existing.value === target.value),
            )
            .map((target) => ({
              kind: target.kind as CaseFile["targets"][number]["kind"],
              value: target.value,
              raw: target.value,
              confidence: target.confidence as CaseFile["targets"][number]["confidence"],
            })),
        ].slice(0, 30),
        turns: [
          ...caseFile.turns.filter((item) => item.id !== turn.id),
          toCaseTurn(turn),
        ].slice(-40),
      }));
    },
    [updateCase],
  );

  const run = useCallback(
    async (submission: ComposerSubmission) => {
      const caseFile =
        active ?? createCase(submission.message.split(/\s+/).slice(0, 6).join(" "));
      if (!active) {
        toast.success("New case file opened");
      }

      const question = submission.message;
      const turn: TurnView = {
        id: `turn_${Date.now().toString(36)}`,
        question,
        createdAt: Date.now(),
        phase: "planning",
        targets: [],
        steps: [],
        evidence: [],
        entities: [],
        sources: [],
        notices: [],
      };

      setTurns((current) => [...current, turn]);
      setBusy(true);
      startedRef.current = Date.now();
      setElapsed(0);

      // The title follows the first real question so the sidebar stays meaningful.
      if (caseFile.title === "Untitled case" || caseFile.turns.length === 0) {
        updateCase(caseFile.id, (current) => ({
          ...current,
          title:
            question.split(/\s+/).slice(0, 7).join(" ").slice(0, 70) || "Untitled case",
        }));
      }

      const request: AgentRequest = {
        message: question,
        skillIds: submission.skillIds,
        attachments: submission.attachments?.map(
          ({ previewUrl: _previewUrl, ...rest }) => rest,
        ),
        history: turns
          .slice(-4)
          .flatMap((item) => [
            { role: "user" as const, content: item.question },
            ...(item.answer
              ? [{ role: "assistant" as const, content: item.answer.slice(0, 1200) }]
              : []),
          ]),
      };

      const controller = new AbortController();
      abortRef.current = controller;
      let serverOk = false;

      try {
        const response = await fetch("/api/agent", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
          signal: controller.signal,
        });

        const headerModel = response.headers.get("x-indus-model");
        if (headerModel && headerModel !== "none") {
          setModelLabel(headerModel);
        }

        if (!response.ok || !response.body) {
          throw new Error(`Agent route returned ${response.status}`);
        }

        serverOk = true;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) {
              continue;
            }
            try {
              patchTurn(turn.id, JSON.parse(line) as AgentEvent);
            } catch {
              /* partial line — the next chunk completes it */
            }
          }
        }
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          patchTurn(turn.id, {
            type: "notice",
            level: "error",
            message: `Server collection failed (${
              error instanceof Error ? error.message : "unknown"
            }). Falling back to browser-side collection for the skills that support it.`,
          });
        }
      }

      // Browser pass: covers both "server has no egress" and "server route down".
      const snapshot = await new Promise<TurnView | null>((resolve) => {
        setTurns((current) => {
          resolve(current.find((item) => item.id === turn.id) ?? null);
          return current;
        });
      });

      const fallbackSkillIds = serverOk
        ? (snapshot?.steps ?? [])
            .filter(
              (step) =>
                ["unreachable", "error"].includes(step.status) &&
                getSkill(step.skillId)?.clientFallback,
            )
            .map((step) => step.skillId)
        : snapshot?.steps.length
          ? (snapshot?.steps ?? [])
              .filter((step) => getSkill(step.skillId)?.clientFallback)
              .map((step) => step.skillId)
          : (request.skillIds ??
            skills
              .filter((skill) => getSkill(skill.id)?.clientFallback)
              .map((skill) => skill.id));

      let browserRan = false;

      if (fallbackSkillIds.length > 0 && !controller.signal.aborted) {
        const stepIds: Record<string, string> = {};
        for (const step of snapshot?.steps ?? []) {
          stepIds[`${step.skillId}::${step.target}`] = step.stepId;
          stepIds[step.skillId] = step.stepId;
        }
        patchTurn(turn.id, {
          type: "notice",
          level: "info",
          message: `Browser-side pass running for ${fallbackSkillIds.length} skill(s): ${fallbackSkillIds.join(", ")}.`,
        });

        await runClientPass(request, {
          onEvent: (event) => {
            // The client pass cannot plan, score or write up: those belong to the
            // server pass, and the merged result is reconciled below.
            if (
              event.type === "plan" ||
              event.type === "risk" ||
              event.type === "turn:done"
            ) {
              return;
            }
            // The runner resolved the step id through the plan mapping already.
            patchTurn(turn.id, event);
          },
          signal: controller.signal,
          onlySkillIds: fallbackSkillIds,
          stepIds,
        }).catch(() => undefined);
        browserRan = true;

        setTurns((current) =>
          current.map((item) =>
            item.id === turn.id ? { ...item, clientPassRan: true } : item,
          ),
        );
      }

      // Single reconciliation point for the two passes: the risk read and the
      // write-up must describe everything that was collected — and nothing more.
      // A run that collected nothing says so instead of trailing off.
      const settled = await new Promise<TurnView | null>((resolve) => {
        setTurns((current) => {
          resolve(current.find((item) => item.id === turn.id) ?? null);
          return current;
        });
      });

      if (settled) {
        const evidenceBeforePass = snapshot?.evidence.length ?? 0;
        const gained = settled.evidence.length - evidenceBeforePass;

        if (gained > 0 || browserRan || !settled.answer) {
          const bundle = bundleFromTurn(settled);
          const mergedRisk = assessRisk(bundle);

          if (gained > 0) {
            patchTurn(turn.id, {
              type: "notice",
              level: "info",
              message: `Browser pass added ${gained} finding(s) — risk re-scored over ${settled.evidence.length} merged observation(s).`,
            });
          }

          setTurns((current) =>
            current.map((item) =>
              item.id === turn.id
                ? {
                    ...item,
                    phase: "done",
                    finishedAt: item.finishedAt ?? Date.now(),
                    risk: mergedRisk,
                    answer: mergedAnswer(settled, bundle, mergedRisk, evidenceBeforePass),
                    answerMode: settled.answer
                      ? (item.answerMode ?? "analyst")
                      : "analyst",
                    stats: {
                      steps: settled.steps.length,
                      evidence: settled.evidence.length,
                      entities: settled.entities.length,
                      sources: settled.sources.length,
                    },
                  }
                : item,
            ),
          );
        }
      }

      setBusy(false);
      abortRef.current = null;

      const finished = await new Promise<TurnView | null>((resolve) => {
        setTurns((current) => {
          resolve(current.find((item) => item.id === turn.id) ?? null);
          return current;
        });
      });

      if (finished) {
        persistTurn(caseFile.id, finished);
      }
    },
    [active, createCase, patchTurn, persistTurn, skills, turns, updateCase],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    toast.info("Run stopped — everything collected so far is kept");
  }, []);

  const activeTurn = turns[turns.length - 1] ?? null;
  const notices = turns.flatMap((turn) => turn.notices);
  const lastNotice = notices[notices.length - 1];

  if (!hydrated) {
    return (
      <div className="flex h-dvh w-full overflow-hidden bg-background">
        <div className="hidden w-[304px] shrink-0 flex-col gap-3 border-r border-hairline bg-surface p-3.5 lg:flex">
          <div className="flex items-center gap-2.5">
            <Skeleton className="size-7 rounded-full" />
            <Skeleton className="h-3.5 w-24" />
          </div>
          <Skeleton className="h-9.5 w-full" />
          <Skeleton className="h-9 w-full" />
          <div className="mt-2 space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-7 w-24" />
          </div>
          <div className="mx-auto w-full max-w-[760px] flex-1 space-y-3 px-4 py-5">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-3/4" />
          </div>
          <div className="mx-auto w-full max-w-[760px] px-4 pb-4">
            <Skeleton className="h-24 w-full" />
          </div>
        </div>
        <div className="hidden w-[368px] shrink-0 space-y-3 border-l border-hairline p-3 lg:block">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background">
      <div className="hidden w-[304px] shrink-0 lg:block">
        <CaseSidebar
          cases={cases}
          activeId={activeId}
          onSelect={selectCase}
          onCreate={() => {
            createCase();
            setTurns([]);
          }}
          onDelete={deleteCase}
          onTogglePin={(caseFile) =>
            updateCase(caseFile.id, (item) => ({ ...item, pinned: !item.pinned }))
          }
          onImport={importCase}
          onOpenSettings={() => setSettingsOpen(true)}
          egress={egress}
          skillCount={skills.length}
        />
      </div>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="safe-t flex items-center justify-between gap-2 border-b border-hairline bg-surface/80 px-3 py-2.5 backdrop-blur lg:px-5">
          <div className="flex min-w-0 items-center gap-2">
            <Dialog open={mobileNav} onOpenChange={setMobileNav}>
              <DialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="lg:hidden"
                  aria-label="Cases"
                >
                  <Menu />
                </Button>
              </DialogTrigger>
              <DialogContent title="Case files" side="left">
                <div className="-mx-4 -my-3.5 h-[70dvh]">
                  <CaseSidebar
                    cases={cases}
                    activeId={activeId}
                    onSelect={(id) => {
                      selectCase(id);
                      setMobileNav(false);
                    }}
                    onCreate={() => {
                      createCase();
                      setMobileNav(false);
                    }}
                    onDelete={deleteCase}
                    onTogglePin={(caseFile) =>
                      updateCase(caseFile.id, (item) => ({
                        ...item,
                        pinned: !item.pinned,
                      }))
                    }
                    onImport={importCase}
                    onOpenSettings={() => {
                      setMobileNav(false);
                      // Let the nav sheet finish closing before the dialog opens.
                      window.setTimeout(() => setSettingsOpen(true), 120);
                    }}
                    egress={egress}
                    skillCount={skills.length}
                  />
                </div>
              </DialogContent>
            </Dialog>

            <div className="min-w-0">
              {titleDraft === null ? (
                <button
                  type="button"
                  onClick={() => setTitleDraft(active?.title ?? "")}
                  className="group flex items-center gap-1.5 truncate text-left"
                >
                  <span className="truncate text-[13.5px] font-semibold tracking-tight text-foreground">
                    {active?.title ?? "No case open"}
                  </span>
                  <Pencil className="size-3 shrink-0 text-faint-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </button>
              ) : (
                <Input
                  autoFocus
                  value={titleDraft}
                  onChange={(event) => setTitleDraft(event.target.value)}
                  onBlur={() => {
                    if (active && titleDraft.trim()) {
                      updateCase(active.id, (caseFile) => ({
                        ...caseFile,
                        title: titleDraft.trim(),
                      }));
                    }
                    setTitleDraft(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.currentTarget.blur();
                    }
                  }}
                  className="h-8 text-[13px]"
                />
              )}
              <div className="mt-0.5 flex items-center gap-2 text-[11px] text-faint-foreground">
                <span className="tabular">
                  {active
                    ? `${active.turns.length} saved run(s)`
                    : "open a case to begin"}
                </span>
                {busy ? (
                  <span className="live-dot tabular text-primary">
                    collecting · {formatDuration(elapsed)}
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <Tip
              label={
                egress === false
                  ? "This server cannot reach the internet — the browser will run collection instead"
                  : "Server egress"
              }
            >
              <span className="hidden items-center gap-1.5 rounded-full border border-hairline bg-surface-2 px-2 py-1 text-[11px] text-muted-foreground sm:flex">
                {egress === false ? (
                  <WifiOff className="size-3 text-warning" />
                ) : (
                  <Wifi className="size-3 text-success" />
                )}
                {egress === null ? "checking" : egress ? "live sources" : "browser mode"}
              </span>
            </Tip>

            {modelLabel ? (
              <Badge tone="primary" mono className="hidden sm:inline-flex">
                {modelLabel.split(" · ").pop()}
              </Badge>
            ) : (
              <Tip label="No briefing model configured — deterministic analyst write-ups are used">
                <Badge tone="neutral" mono className="hidden sm:inline-flex">
                  deterministic
                </Badge>
              </Tip>
            )}

            <SettingsDialog
              open={settingsOpen}
              onOpenChange={setSettingsOpen}
              onCapabilities={(capabilities) => setEgress(capabilities.egress)}
            >
              <Button variant="ghost" size="icon" aria-label="Settings">
                <Wrench />
              </Button>
            </SettingsDialog>

            <Tip label={theme === "dark" ? "Switch to light" : "Switch to dark"}>
              <Button
                variant="ghost"
                size="icon"
                onClick={toggle}
                aria-label="Toggle theme"
              >
                {theme === "dark" ? <Sun /> : <Moon />}
              </Button>
            </Tip>

            <Dialog open={mobileIntel} onOpenChange={setMobileIntel}>
              <DialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="lg:hidden"
                  aria-label="Intelligence panel"
                >
                  <PanelRight />
                </Button>
              </DialogTrigger>
              <DialogContent title="Intelligence" side="right">
                <div className="h-[70dvh]">
                  <IntelPanel turn={activeTurn} />
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </header>

        <div ref={scrollRef} className="thin-scroll min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[760px] px-3.5 pt-4 pb-6 lg:px-6">
            {turns.length === 0 ? (
              <div className="py-6">
                <div className="grain rounded-2xl border border-hairline bg-surface p-5">
                  <h1 className="text-[19px] font-semibold tracking-tight text-foreground">
                    Real collection, honest coverage
                  </h1>
                  <p className="mt-2 max-w-[54ch] text-[13px] leading-relaxed text-muted-foreground">
                    This console runs {skills.length} skills against public sources — DNS
                    and RDAP registries, certificate transparency logs, passive scan
                    datasets, archive indexes, platform profile APIs, postal and transport
                    reference data, and offline validators for document formats.
                  </p>
                  <p className="mt-2 max-w-[54ch] text-[13px] leading-relaxed text-muted-foreground">
                    Every finding carries its source and confidence. Anything that needs
                    an API key reports itself as unavailable rather than inventing an
                    answer, and unreachable sources count against the risk score instead
                    of disappearing.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {[
                      "India-first",
                      "mobile-ready",
                      "cases saved locally",
                      "browser fallback",
                      "no data leaves the machine",
                    ].map((chip) => (
                      <Badge key={chip} tone="neutral">
                        {chip}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div className="mt-5">
                  <p className="mb-2 text-[11px] font-medium tracking-wide text-faint-foreground uppercase">
                    Try one of these
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {STARTERS.map((starter) => (
                      <button
                        key={starter.label}
                        type="button"
                        onClick={() => void run({ message: starter.prompt })}
                        className="rounded-xl border border-hairline bg-surface px-3.5 py-3 text-left transition-colors hover:border-primary/40 hover:bg-surface-2"
                      >
                        <span className="text-[12.5px] font-medium text-foreground">
                          {starter.label}
                        </span>
                        <span className="mt-1 block text-[12px] leading-relaxed text-muted-foreground">
                          {starter.prompt}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}

            <div className="space-y-4">
              {turns.map((turn) => (
                <div key={turn.id} className="space-y-3">
                  <div className="flex justify-end">
                    <div className="max-w-[86%] rounded-2xl rounded-br-md border border-hairline bg-surface-2 px-3.5 py-2.5">
                      <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap text-foreground">
                        {turn.question}
                      </p>
                      {turn.targets.length > 0 ? (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {detectTargets(turn.question, 4).map((target) => (
                            <Badge
                              key={`${target.kind}-${target.value}`}
                              tone="primary"
                              mono
                            >
                              {target.kind}
                            </Badge>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <PlanCard turn={turn} />

                  {turn.steps.length > 0 ? (
                    <div className="space-y-2">
                      {turn.steps.map((step, index) => (
                        <StepCard key={step.stepId} step={step} index={index} />
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 rounded-xl border border-hairline bg-surface px-3.5 py-3 text-[12.5px] text-muted-foreground">
                      <Info className="size-3.5 text-primary" />
                      Planning the collection chain…
                    </div>
                  )}

                  {turn.notices.length > 0 ? (
                    <div className="rounded-xl border border-hairline bg-surface-2/50">
                      <button
                        type="button"
                        onClick={() => setNoticeOpen((value) => !value)}
                        className="flex w-full items-center justify-between px-3.5 py-2.5"
                      >
                        <span className="flex items-center gap-2 text-[11.5px] font-medium tracking-wide text-muted-foreground uppercase">
                          <ShieldQuestion className="size-3.5" />
                          Runner notes ({turn.notices.length})
                        </span>
                        <ChevronDown
                          className={cn(
                            "size-3.5 text-faint-foreground transition-transform",
                            noticeOpen && "rotate-180",
                          )}
                        />
                      </button>
                      {noticeOpen ? (
                        <ul className="space-y-1 border-t border-hairline px-3.5 py-2.5">
                          {turn.notices.map((notice) => (
                            <li
                              key={`${notice.level}-${notice.message}`}
                              className={cn(
                                "text-[12px] leading-relaxed",
                                notice.level === "error"
                                  ? "text-danger"
                                  : notice.level === "warn"
                                    ? "text-warning"
                                    : "text-muted-foreground",
                              )}
                            >
                              · {notice.message}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}

                  {turn.answer ? (
                    <Briefing turn={turn} caseTitle={active?.title ?? "case"} />
                  ) : turn.phase === "done" ? (
                    <div className="rounded-xl border border-hairline bg-surface px-3.5 py-3 text-[12.5px] text-muted-foreground">
                      The run finished without a written briefing — check the runner notes
                      above for the reason.
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="border-t border-hairline bg-background/80 px-3.5 pt-3 backdrop-blur lg:px-6">
          <div className="mx-auto w-full max-w-[760px]">
            <Composer
              onSubmit={(submission) => void run(submission)}
              onStop={stop}
              busy={busy}
              manifest={skills}
            />
            {lastNotice ? (
              <p className="pb-2 text-[11px] text-faint-foreground">
                · {lastNotice.message.slice(0, 160)}
              </p>
            ) : null}
          </div>
        </div>
      </main>

      <div className="hidden w-[368px] shrink-0 border-l border-hairline bg-surface-2/30 p-3 lg:block">
        <IntelPanel turn={activeTurn} />
      </div>
    </div>
  );
}
