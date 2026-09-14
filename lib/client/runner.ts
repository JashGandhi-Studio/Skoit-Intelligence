"use client";

import { buildPlan } from "@/lib/agent/plan";
import type { AnalysisBundle } from "@/lib/agent/synthesize";
import { assessRisk, deterministicBriefing } from "@/lib/agent/synthesize";
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

  for (const step of steps) {
    if (signal.aborted) {
      break;
    }
    const skill = getSkill(step.skillId);
    if (!skill) {
      continue;
    }
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
          meta:
            request.attachments?.length && skill.id === "attachment-review"
              ? { attachments: JSON.stringify(request.attachments) }
              : undefined,
        },
        ctx,
      );
    } catch (error) {
      outcome = {
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
    }

    localStep.status = outcome.status;
    evidence.push(...outcome.evidence);
    entities.push(...outcome.entities);
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
    });
  }

  const bundle: AnalysisBundle = {
    question: request.message,
    steps,
    outcomes,
    evidence,
    entities,
    sources,
    rationale: plan.rationale,
  };
  const risk = assessRisk(bundle);
  onEvent({ type: "risk", risk });
  const answer = deterministicBriefing(bundle, risk);
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
