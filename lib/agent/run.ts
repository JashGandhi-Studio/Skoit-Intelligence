import { describeError } from "@/lib/net/http";
import { getSkill } from "@/lib/skills";
import type {
  AgentEvent,
  AgentRequest,
  Entity,
  Evidence,
  NetContext,
  PlannedStep,
  SkillOutcome,
  SourceRef,
} from "@/lib/types";
import { newId } from "@/lib/utils";
import { buildPlan } from "./plan";
import { type AnalysisBundle, assessRisk, deterministicBriefing } from "./synthesize";

export interface RunOptions {
  request: AgentRequest;
  ctx: NetContext;
  onEvent: (event: AgentEvent) => void;
  /** Optional model-backed synthesis; when absent the deterministic briefing is used. */
  synthesize?: (
    bundle: AnalysisBundle,
    risk: ReturnType<typeof assessRisk>,
  ) => Promise<{ text: string; mode: "model" | "analyst"; model?: string }>;
}

const STEP_TIMEOUT_MS = 22_000;

function emptyOutcome(summary: string): SkillOutcome {
  return { status: "skipped", summary, evidence: [], entities: [], sources: [] };
}

export async function runAnalysis(options: RunOptions): Promise<{
  bundle: AnalysisBundle;
  risk: ReturnType<typeof assessRisk>;
  answer: string;
  mode: "model" | "analyst";
  model?: string;
}> {
  const { request, ctx, onEvent, synthesize } = options;
  const startedAt = Date.now();
  const turnId = newId("turn");

  onEvent({
    type: "turn:start",
    turnId,
    mode: synthesize ? "model" : "analyst",
    startedAt,
  });

  const plan = buildPlan(request);
  onEvent({
    type: "plan",
    steps: plan.steps,
    rationale: plan.rationale,
    targets: plan.targets,
  });

  const outcomes: AnalysisBundle["outcomes"] = [];
  const evidence: Evidence[] = [];
  const entities: Entity[] = [];
  const sources: SourceRef[] = [];

  const collect = (outcome: SkillOutcome) => {
    for (const item of outcome.evidence) {
      evidence.push(item);
    }
    for (const item of outcome.entities) {
      entities.push(item);
    }
    for (const item of outcome.sources) {
      if (!sources.some((existing) => existing.id === item.id)) {
        sources.push(item);
      }
    }
  };

  for (const step of plan.steps) {
    if (ctx.signal.aborted) {
      step.status = "skipped";
      continue;
    }

    const skill = getSkill(step.skillId);
    if (!skill) {
      step.status = "skipped";
      continue;
    }

    step.status = "running";
    const stepStart = Date.now();
    onEvent({
      type: "step:start",
      stepId: step.id,
      skillId: skill.id,
      label: step.label,
      startedAt: stepStart,
    });

    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), STEP_TIMEOUT_MS);
    const linked = () => timeout.abort();
    ctx.signal.addEventListener("abort", linked, { once: true });

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
        {
          ...ctx,
          signal: timeout.signal,
          log: (message) => onEvent({ type: "step:log", stepId: step.id, message }),
        },
      );
    } catch (error) {
      outcome = {
        ...emptyOutcome("Skill threw an unexpected error."),
        status: "error",
        error: {
          code: "unknown",
          message: error instanceof Error ? error.message : String(error),
        },
      };
    } finally {
      clearTimeout(timer);
      ctx.signal.removeEventListener("abort", linked);
    }

    if (timeout.signal.aborted && outcome.status === "error") {
      outcome = {
        ...outcome,
        status: "unreachable",
        error: {
          code: "timeout",
          message: `Skill exceeded the ${STEP_TIMEOUT_MS / 1000}s budget.`,
        },
      };
    }

    step.status = outcome.status;
    collect(outcome);

    onEvent({
      type: "step:done",
      stepId: step.id,
      skillId: skill.id,
      status: outcome.status,
      summary: outcome.summary,
      durationMs: Date.now() - stepStart,
      evidence: outcome.evidence,
      entities: outcome.entities,
      sources: outcome.sources,
      error: outcome.error,
    });

    if (outcome.entities.length > 0) {
      onEvent({ type: "entity:found", entities: outcome.entities });
    }
    if (outcome.error) {
      onEvent({
        type: "notice",
        level: outcome.status === "unreachable" ? "warn" : "info",
        message: `${skill.name}: ${describeError(outcome.error)}`,
      });
    }

    outcomes.push({ step, outcome, durationMs: Date.now() - stepStart });
  }

  const bundle: AnalysisBundle = {
    question: request.message,
    steps: plan.steps,
    outcomes,
    evidence,
    entities,
    sources,
    rationale: plan.rationale,
  };

  const risk = assessRisk(bundle);
  onEvent({ type: "risk", risk });

  let answer = deterministicBriefing(bundle, risk);
  let mode: "model" | "analyst" = "analyst";
  let model: string | undefined;

  if (synthesize) {
    onEvent({ type: "synthesis:start", mode: "model" });
    try {
      const result = await synthesize(bundle, risk);
      if (result.text.trim().length > 40) {
        answer = result.text;
        mode = result.mode;
        model = result.model;
        onEvent({ type: "synthesis:delta", text: answer });
      } else {
        onEvent({
          type: "notice",
          level: "warn",
          message:
            "Model returned an empty briefing — deterministic analyst write-up used instead.",
        });
      }
    } catch (error) {
      onEvent({
        type: "notice",
        level: "warn",
        message: `Model synthesis failed (${
          error instanceof Error ? error.message : "unknown error"
        }) — deterministic write-up used instead.`,
      });
    }
  }

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

  return { bundle, risk, answer, mode, model };
}

export function summariseSteps(steps: PlannedStep[]): string {
  const done = steps.filter((step) => step.status === "ok").length;
  return `${done}/${steps.length} skills completed`;
}
