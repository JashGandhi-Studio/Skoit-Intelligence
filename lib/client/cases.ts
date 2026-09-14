"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AnalysisBundle } from "@/lib/agent/synthesize";
import { deterministicBriefing } from "@/lib/agent/synthesize";
import type {
  AgentEvent,
  CaseFile,
  CaseTurn,
  Evidence,
  PlannedStep,
  RiskAssessment,
  SkillOutcome,
} from "@/lib/types";
import { download, newId, slugify } from "@/lib/utils";

export type StepView = {
  stepId: string;
  skillId: string;
  label: string;
  targetKind: string;
  target: string;
  reason: string;
  status:
    | "queued"
    | "running"
    | "ok"
    | "partial"
    | "unreachable"
    | "blocked"
    | "error"
    | "skipped";
  summary?: string;
  durationMs?: number;
  evidence: Evidence[];
  logs: Array<{ id: string; message: string }>;
  error?: { code: string; message: string };
};

export type TurnView = {
  id: string;
  question: string;
  createdAt: number;
  finishedAt?: number;
  phase: "planning" | "collecting" | "synthesizing" | "done" | "failed";
  rationale?: string;
  targets: Array<{ kind: string; value: string; confidence: string }>;
  steps: StepView[];
  evidence: Evidence[];
  entities: Array<{
    id: string;
    type: string;
    value: string;
    label: string;
    confidence: string;
    attributes: Array<{ key: string; value: string }>;
  }>;
  sources: Array<{
    id: string;
    label: string;
    url?: string;
    kind: string;
    accessedAt: number;
  }>;
  risk?: {
    score: number;
    band: string;
    factors: Array<{ label: string; weight: number; detail: string }>;
    summary: string;
  };
  answer?: string;
  answerMode?: "model" | "analyst";
  model?: string;
  notices: Array<{ level: string; message: string }>;
  stats?: { steps: number; evidence: number; entities: number; sources: number };
  clientPassRan?: boolean;
};

const STORAGE_KEY = "indus.cases.v1";
const ACTIVE_KEY = "indus.active-case";

/** Applies a streamed agent event to the turn, without ever merging in data that was not sent. */
export function applyEvent(turn: TurnView, event: AgentEvent): TurnView {
  switch (event.type) {
    case "plan": {
      // Dedupe on the skill *and* its target: the same skill legitimately runs
      // against several targets in one pass.
      const existing = new Set(
        turn.steps.map((step) => `${step.skillId}::${step.target}`),
      );
      const filtered = event.steps.filter(
        (step) => !existing.has(`${step.skillId}::${step.target}`),
      );
      return {
        ...turn,
        phase: "collecting",
        rationale: event.rationale ?? turn.rationale,
        targets: event.targets,
        steps: [
          ...turn.steps,
          ...filtered.map((step) => ({
            stepId: step.id,
            skillId: step.skillId,
            label: step.label,
            targetKind: step.targetKind,
            target: step.target,
            reason: step.reason,
            status: "queued" as const,
            evidence: [],
            logs: [],
          })),
        ],
      };
    }
    case "step:start":
      return {
        ...turn,
        steps: upsertStep(turn.steps, event.stepId, (step) => ({
          ...step,
          status: "running",
          label: event.label,
        })),
      };
    case "step:log":
      return {
        ...turn,
        steps: upsertStep(turn.steps, event.stepId, (step) => ({
          ...step,
          logs: [...step.logs.slice(-24), { id: newId("log"), message: event.message }],
        })),
      };
    case "step:done": {
      const steps = upsertStep(turn.steps, event.stepId, (step) => ({
        ...step,
        skillId: event.skillId,
        status: event.status,
        summary: event.summary,
        durationMs: event.durationMs,
        evidence: event.evidence ?? [],
        error: event.error
          ? { code: event.error.code, message: event.error.message }
          : step.error,
      }));
      const known = new Set(turn.evidence.map((item) => item.id));
      const additions = (event.evidence ?? []).filter((item) => !known.has(item.id));
      const knownEntities = new Set(
        turn.entities.map((item) => `${item.type}:${item.value}`),
      );
      const entityAdditions = (event.entities ?? []).filter(
        (item) => !knownEntities.has(`${item.type}:${item.value}`),
      );
      const knownSources = new Set(turn.sources.map((item) => item.id));
      const sourceAdditions = (event.sources ?? []).filter(
        (item) => !knownSources.has(item.id),
      );
      return {
        ...turn,
        steps,
        evidence: [...turn.evidence, ...additions],
        entities: [...turn.entities, ...entityAdditions],
        sources: [...turn.sources, ...sourceAdditions],
      };
    }
    case "risk":
      return { ...turn, risk: event.risk };
    case "synthesis:start":
      return {
        ...turn,
        phase: "synthesizing",
        answerMode: event.mode,
        model: event.model ?? turn.model,
      };
    case "synthesis:delta":
      return { ...turn, answer: event.text, phase: "synthesizing" };
    case "synthesis:done":
      return {
        ...turn,
        answer: event.text,
        phase: "done",
        finishedAt: Date.now(),
        answerMode: turn.answerMode ?? "analyst",
      };
    case "notice":
      return {
        ...turn,
        notices: [
          ...turn.notices.slice(-16),
          { level: event.level, message: event.message },
        ],
      };
    case "turn:done":
      return {
        ...turn,
        phase: turn.phase === "synthesizing" ? "synthesizing" : "done",
        stats: event.stats,
        finishedAt: event.finishedAt,
      };
    default:
      return turn;
  }
}

function upsertStep(
  steps: StepView[],
  stepId: string,
  update: (step: StepView) => StepView,
): StepView[] {
  const index = steps.findIndex((step) => step.stepId === stepId);
  if (index === -1) {
    const created = update({
      stepId,
      skillId: stepId,
      label: "Skill",
      targetKind: "text",
      target: "",
      reason: "",
      status: "queued",
      evidence: [],
      logs: [],
    });
    return [...steps, created];
  }
  const next = [...steps];
  next[index] = update(next[index]);
  return next;
}

export function toCaseTurn(turn: TurnView): CaseTurn {
  return {
    id: turn.id,
    question: turn.question,
    createdAt: turn.createdAt,
    mode: turn.answerMode ?? "analyst",
    model: turn.model,
    steps: turn.steps.map((step) => ({
      id: step.stepId,
      skillId: step.skillId,
      label: step.label,
      targetKind: step.targetKind as CaseTurn["steps"][number]["targetKind"],
      target: step.target,
      reason: step.reason,
      status: step.status,
    })),
    evidence: turn.evidence,
    entities: turn.entities.map((item) => ({
      id: item.id,
      type: item.type as CaseTurn["entities"][number]["type"],
      value: item.value,
      label: item.label,
      skillId: "",
      confidence: item.confidence as CaseTurn["entities"][number]["confidence"],
      attributes: item.attributes,
    })),
    sources: turn.sources.map((item) => ({
      id: item.id,
      label: item.label,
      url: item.url,
      kind: item.kind as CaseTurn["sources"][number]["kind"],
      accessedAt: item.accessedAt,
    })),
    risk: turn.risk
      ? {
          score: turn.risk.score,
          band: turn.risk.band as NonNullable<CaseTurn["risk"]>["band"],
          factors: turn.risk.factors,
          summary: turn.risk.summary,
        }
      : undefined,
    answer: turn.answer ?? "",
    durationMs: (turn.finishedAt ?? Date.now()) - turn.createdAt,
  };
}

export function useCases() {
  const [cases, setCases] = useState<CaseFile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const stored = raw ? (JSON.parse(raw) as CaseFile[]) : [];
      setCases(stored);
      const active = window.localStorage.getItem(ACTIVE_KEY);
      setActiveId(
        active && stored.some((item) => item.id === active)
          ? active
          : (stored[0]?.id ?? null),
      );
    } catch {
      setCases([]);
    }
    setHydrated(true);

    fetch("/api/cases")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { cases?: CaseFile[] } | null) => {
        if (!data?.cases) {
          return;
        }
        setCases((current) =>
          current.length >= data.cases!.length ? current : data.cases!,
        );
      })
      .catch(() => undefined);
  }, []);

  const persist = useCallback((next: CaseFile[]) => {
    setCases(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next.slice(0, 60)));
    } catch {
      /* quota — the server copy still holds it */
    }
    if (syncTimer.current) {
      clearTimeout(syncTimer.current);
    }
    syncTimer.current = setTimeout(() => {
      fetch("/api/cases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ case: next[0] }),
      }).catch(() => undefined);
    }, 500);
  }, []);

  const createCase = useCallback(
    (title?: string): CaseFile => {
      const caseFile: CaseFile = {
        id: newId("case"),
        title: title?.trim() || "Untitled case",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        pinned: false,
        tags: [],
        targets: [],
        turns: [],
        notes: "",
      };
      persist([caseFile, ...cases]);
      setActiveId(caseFile.id);
      window.localStorage.setItem(ACTIVE_KEY, caseFile.id);
      return caseFile;
    },
    [cases, persist],
  );

  const updateCase = useCallback(
    (id: string, update: (caseFile: CaseFile) => CaseFile) => {
      const next = cases.map((item) =>
        item.id === id ? { ...update(item), updatedAt: Date.now() } : item,
      );
      persist(next);
    },
    [cases, persist],
  );

  const deleteCase = useCallback(
    (id: string) => {
      const next = cases.filter((item) => item.id !== id);
      persist(next);
      fetch(`/api/cases?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(
        () => undefined,
      );
      if (activeId === id) {
        const fallback = next[0]?.id ?? null;
        setActiveId(fallback);
        if (fallback) {
          window.localStorage.setItem(ACTIVE_KEY, fallback);
        } else {
          window.localStorage.removeItem(ACTIVE_KEY);
        }
      }
    },
    [activeId, cases, persist],
  );

  const selectCase = useCallback((id: string) => {
    setActiveId(id);
    window.localStorage.setItem(ACTIVE_KEY, id);
  }, []);

  const importCase = useCallback(
    (caseFile: CaseFile) => {
      persist([
        { ...caseFile, id: caseFile.id || newId("case") },
        ...cases.filter((item) => item.id !== caseFile.id),
      ]);
      setActiveId(caseFile.id);
    },
    [cases, persist],
  );

  const active = cases.find((item) => item.id === activeId) ?? null;

  return {
    cases,
    active,
    activeId,
    hydrated,
    createCase,
    updateCase,
    deleteCase,
    selectCase,
    importCase,
    persist,
  };
}

/** Rebuilds an analysis bundle from a rendered turn so risk and briefing can be recomputed. */
/**
 * Never lets a merged pass silently contradict the write-up: the model briefing
 * is kept and gains a labelled addendum, while an analyst briefing is rebuilt
 * over the merged bundle.
 */
export function mergedAnswer(
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

export function bundleFromTurn(turn: TurnView): AnalysisBundle {
  return {
    question: turn.question,
    rationale: turn.rationale ?? "",
    steps: turn.steps.map((step) => ({
      id: step.stepId,
      skillId: step.skillId,
      label: step.label,
      targetKind: step.targetKind as PlannedStep["targetKind"],
      target: step.target,
      reason: step.reason,
      status: step.status,
    })),
    outcomes: turn.steps.map((step) => ({
      step: {
        id: step.stepId,
        skillId: step.skillId,
        label: step.label,
        targetKind: step.targetKind as PlannedStep["targetKind"],
        target: step.target,
        reason: step.reason,
        status: step.status,
      },
      durationMs: step.durationMs ?? 0,
      outcome: {
        status:
          step.status === "queued" || step.status === "running" ? "skipped" : step.status,
        summary: step.summary ?? "No summary returned.",
        evidence: step.evidence,
        entities: [],
        sources: [],
        error: step.error
          ? {
              code: step.error.code as NonNullable<SkillOutcome["error"]>["code"],
              message: step.error.message,
            }
          : undefined,
      },
    })),
    evidence: turn.evidence,
    entities: turn.entities.map((item) => ({
      id: item.id,
      type: item.type as CaseTurn["entities"][number]["type"],
      value: item.value,
      label: item.label,
      skillId: "",
      confidence: item.confidence as CaseTurn["entities"][number]["confidence"],
      attributes: item.attributes,
    })),
    sources: turn.sources.map((item) => ({
      id: item.id,
      label: item.label,
      url: item.url,
      kind: item.kind as CaseTurn["sources"][number]["kind"],
      accessedAt: item.accessedAt,
    })),
  };
}

export function exportCase(caseFile: CaseFile) {
  const filename = `${slugify(caseFile.title)}-${new Date().toISOString().slice(0, 10)}.json`;
  download(filename, JSON.stringify(caseFile, null, 2), "application/json");
}

export function caseToMarkdown(caseFile: CaseFile): string {
  const lines = [
    `# ${caseFile.title}`,
    "",
    `Opened ${new Date(caseFile.createdAt).toISOString()} · updated ${new Date(caseFile.updatedAt).toISOString()}`,
    `Targets: ${caseFile.targets.map((target) => `${target.kind} ${target.value}`).join(", ") || "none recorded"}`,
    "",
  ];
  for (const turn of caseFile.turns) {
    lines.push(
      `## ${turn.question}`,
      "",
      `_${new Date(turn.createdAt).toISOString()} · ${turn.mode} mode · ${turn.steps.length} skills_`,
      "",
    );
    lines.push(turn.answer, "");
    const noteworthy = turn.evidence.filter(
      (item) => item.severity && item.severity !== "info",
    );
    if (noteworthy.length > 0) {
      lines.push("### Flagged evidence", "");
      for (const item of noteworthy) {
        lines.push(`- \`${item.severity}\` **${item.label}** — ${item.value}`);
      }
      lines.push("");
    }
  }
  lines.push(
    "---",
    "",
    "Collected with INDUS. Every line above traces to a cited public source; re-verify before publication.",
  );
  return lines.join("\n");
}
