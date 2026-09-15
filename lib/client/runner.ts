"use client";

import { buildPlan } from "@/lib/agent/plan";
import type { AnalysisBundle } from "@/lib/agent/synthesize";
import {
  assessRisk,
  capabilityAnswer,
  countryAskAnswer,
  deterministicBriefing,
} from "@/lib/agent/synthesize";
import { getSkill } from "@/lib/skills";
import type {
  AgentEvent,
  AgentRequest,
  Evidence,
  NetContext,
  PlannedStep,
  SkillOutcome,
} from "@/lib/types";
import { newId } from "@/lib/utils";

export interface ClientRunResult {
  bundle: AnalysisBundle;
  risk: ReturnType<typeof assessRisk>;
  answer: string;
}

export function browserContext(onLog?: (message: string) => void): NetContext {
  return {
    fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
    signal: new AbortController().signal,
    egress: typeof navigator === "undefined" ? false : navigator.onLine,
    log: (message) => onLog?.(message),
    // The browser has no access to server-side keys, so keyed skills honestly
    // report themselves as unconfigured rather than pretending otherwise.
    env: () => undefined,
  };
}

/**
 * Browser-side execution pass. Used when the server has no egress (typical for
 * a sandboxed deployment) — the analyst's own browser becomes the collection
 * path, restricted to skills that talk to CORS-enabled public endpoints.
 */
/** Runs async jobs with a concurrency ceiling, preserving input order. */
async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  job: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        await job(items[index]);
      }
    },
  );
  await Promise.all(workers);
}

export async function runClientPass(
  request: AgentRequest,
  options: {
    onEvent: (event: AgentEvent) => void;
    signal: AbortSignal;
    onlySkillIds?: string[];
    stepIds?: Record<string, string>;
  },
): Promise<ClientRunResult> {
  const { onEvent, signal, onlySkillIds, stepIds } = options;
  const turnId = newId("turn");
  const startedAt = Date.now();

  onEvent({
    type: "turn:start",
    turnId,
    mode: "analyst",
    startedAt,
  });

  const plan = buildPlan(request);
  const steps = plan.steps.filter((step) => {
    if (onlySkillIds && !onlySkillIds.includes(step.skillId)) {
      return false;
    }
    const skill = getSkill(step.skillId);
    return Boolean(skill?.clientFallback);
  });

  onEvent({
    type: "plan",
    steps,
    rationale: `Browser-side collection pass for ${steps.length} skill(s). ${plan.rationale}`,
    targets: plan.targets,
  });

  const ctx = { ...browserContext(), signal };
  const evidence: Evidence[] = [];
  const entities: AnalysisBundle["entities"] = [];
  const sources: AnalysisBundle["sources"] = [];
  const outcomes: AnalysisBundle["outcomes"] = [];
  const media: NonNullable<AnalysisBundle["media"]> = [];
  const articles: NonNullable<AnalysisBundle["articles"]> = [];

  // The browser pass collects with the same bounded concurrency as the server
  // pass — sequential execution here was multiplying every relay timeout.
  /** Same per-skill wall-clock budget as the server pass. */
  const CLIENT_STEP_TIMEOUT_MS = 18_000;

  const runClientStep = async (step: (typeof steps)[number]) => {
    if (signal.aborted) {
      return;
    }
    const skill = getSkill(step.skillId);
    if (!skill) {
      return;
    }
    // Bound each browser skill: its internal fetches already time out, but a
    // slow chain of them must not hold the whole pass open.
    const stepAbort = new AbortController();
    const stepTimer = setTimeout(() => stepAbort.abort(), CLIENT_STEP_TIMEOUT_MS);
    const outerAbort = () => stepAbort.abort();
    signal.addEventListener("abort", outerAbort, { once: true });
    const localStep: PlannedStep = {
      ...step,
      id:
        stepIds?.[`${step.skillId}::${step.target}`] ??
        stepIds?.[step.skillId] ??
        step.id,
    };
    localStep.status = "running";
    const stepStart = Date.now();
    onEvent({
      type: "step:start",
      stepId: localStep.id,
      skillId: skill.id,
      label: `${step.label} · browser`,
      startedAt: stepStart,
    });

    let outcome: SkillOutcome;
    try {
      outcome = await skill.run(
        {
          kind: step.targetKind,
          value: step.target,
          raw: step.target,
          confidence: "confirmed",
          meta: (() => {
            const meta: Record<string, string> = { ...(step.meta ?? {}) };
            if (
              request.attachments?.length &&
              (skill.id === "attachment-review" || skill.id === "image-provenance")
            ) {
              meta.attachments = JSON.stringify(request.attachments);
            }
            return Object.keys(meta).length > 0 ? meta : undefined;
          })(),
        },
        { ...ctx, signal: stepAbort.signal },
      );
    } catch (error) {
      outcome = stepAbort.signal.aborted
        ? {
            status: "unreachable",
            summary: `The skill exceeded the ${CLIENT_STEP_TIMEOUT_MS / 1000}s browser budget.`,
            evidence: [],
            entities: [],
            sources: [],
            error: { code: "timeout", message: "browser pass budget exceeded" },
          }
        : {
            status: "error",
            summary: "Browser-side skill failed.",
            evidence: [],
            entities: [],
            sources: [],
            error: {
              code: "unknown",
              message: error instanceof Error ? error.message : String(error),
            },
          };
    } finally {
      clearTimeout(stepTimer);
      signal.removeEventListener("abort", outerAbort);
    }

    localStep.status = outcome.status;
    evidence.push(...outcome.evidence);
    entities.push(...outcome.entities);
    for (const item of outcome.media ?? []) {
      if (!media.some((existing) => existing.url === item.url)) {
        media.push(item);
      }
    }
    for (const item of outcome.articles ?? []) {
      if (!articles.some((existing) => existing.url === item.url)) {
        articles.push(item);
      }
    }
    for (const item of outcome.sources) {
      if (!sources.some((existing) => existing.id === item.id)) {
        sources.push(item);
      }
    }
    outcomes.push({ step: localStep, outcome, durationMs: Date.now() - stepStart });

    onEvent({
      type: "step:done",
      stepId: localStep.id,
      skillId: skill.id,
      status: outcome.status,
      summary: outcome.summary,
      durationMs: Date.now() - stepStart,
      evidence: outcome.evidence,
      entities: outcome.entities,
      sources: outcome.sources,
      error: outcome.error,
      media: outcome.media,
      articles: outcome.articles,
    });
  };

  await mapWithConcurrency(steps, 3, runClientStep);

  const bundle: AnalysisBundle = {
    question: request.message,
    steps,
    outcomes,
    evidence,
    entities,
    sources,
    rationale: plan.rationale,
    media,
    articles,
  };
  const risk = assessRisk(bundle);
  onEvent({ type: "risk", risk });
  // A browser pass with no steps is the same conversation the server pass
  // would answer: greeting, or the news-country question — not a briefing.
  const answer =
    steps.length === 0
      ? plan.countryAsk
        ? countryAskAnswer()
        : capabilityAnswer(plan.smallTalk, { name: request.preferences?.userName })
      : deterministicBriefing(bundle, risk);
  onEvent({
    type: "synthesis:done",
    text: answer,
    sourceIds: sources.map((item) => item.id),
  });
  onEvent({
    type: "turn:done",
    turnId,
    finishedAt: Date.now(),
    stats: {
      steps: outcomes.length,
      evidence: evidence.length,
      entities: entities.length,
      sources: sources.length,
    },
  });

  return { bundle, risk, answer };
}
