import { describeError } from "@/lib/net/http";
import { getSkill } from "@/lib/skills";
import type {
  AgentEvent,
  AgentRequest,
  ArticleItem,
  Entity,
  Evidence,
  MediaItem,
  NetContext,
  PlannedStep,
  SkillOutcome,
  SourceRef,
} from "@/lib/types";
import { newId } from "@/lib/utils";
import { buildPlan } from "./plan";
import {
  type AnalysisBundle,
  assessRisk,
  capabilityAnswer,
  countryAskAnswer,
  deterministicBriefing,
  isRetrievalAsk,
  plainBriefing,
  retrievalAnswer,
} from "./synthesize";

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

/**
 * Per-step budget. The run executes steps concurrently, so this is a *wall
 * clock* ceiling per skill, not a sum: a six-skill run still finishes inside
 * roughly one budget, which is what keeps answers under the ~30s the console
 * promises. Retrieval sources answer in 3–8s when healthy; anything slower is
 * reported as unreachable instead of stalling the whole turn.
 */
const STEP_TIMEOUT_MS = 18_000;
/** How many skills collect at the same time. Kept modest to stay polite. */
const STEP_CONCURRENCY = 4;

function emptyOutcome(summary: string): SkillOutcome {
  return { status: "skipped", summary, evidence: [], entities: [], sources: [] };
}

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

  const media: MediaItem[] = [];
  const articles: ArticleItem[] = [];

  if (plan.steps.length === 0) {
    // Greeting, a country question, or an empty ask: nothing is searched, and
    // nothing is invented.
    const bundle: AnalysisBundle = {
      question: request.message,
      steps: [],
      outcomes: [],
      evidence: [],
      entities: [],
      sources: [],
      rationale: plan.rationale,
      media: [],
      articles: [],
    };
    const answer = plan.countryAsk
      ? countryAskAnswer()
      : capabilityAnswer(plan.smallTalk, { name: request.preferences?.userName });
    onEvent({ type: "synthesis:done", text: answer, sourceIds: [] });
    onEvent({
      type: "turn:done",
      turnId,
      finishedAt: Date.now(),
      stats: { steps: 0, evidence: 0, entities: 0, sources: 0 },
    });
    return { bundle, risk: assessRisk(bundle), answer, mode: "analyst" as const };
  }

  const collect = (outcome: SkillOutcome) => {
    for (const item of outcome.evidence) {
      evidence.push(item);
    }
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
    for (const item of outcome.entities) {
      entities.push(item);
    }
    for (const item of outcome.sources) {
      if (!sources.some((existing) => existing.id === item.id)) {
        sources.push(item);
      }
    }
  };

  const runStep = async (step: PlannedStep) => {
    if (ctx.signal.aborted) {
      step.status = "skipped";
      return;
    }

    const skill = getSkill(step.skillId);
    if (!skill) {
      step.status = "skipped";
      return;
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
      media: outcome.media,
      articles: outcome.articles,
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
  };

  // Skills in a plan are independent by construction, so they collect at the
  // same time (bounded): a four-skill retrieval finishes in roughly the time of
  // its slowest source instead of the sum of all of them.
  await mapWithConcurrency(plan.steps, STEP_CONCURRENCY, runStep);

  const bundle: AnalysisBundle = {
    question: request.message,
    steps: plan.steps,
    outcomes,
    evidence,
    entities,
    sources,
    media,
    articles,
    rationale: plan.rationale,
  };

  const risk = assessRisk(bundle);
  onEvent({ type: "risk", risk });

  const analyst = request.preferences?.answerStyle === "analyst";
  let answer = isRetrievalAsk(bundle)
    ? retrievalAnswer(bundle)
    : analyst
      ? deterministicBriefing(bundle, risk)
      : plainBriefing(bundle, risk);
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
