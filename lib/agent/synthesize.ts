import type {
  Entity,
  Evidence,
  PlannedStep,
  RiskAssessment,
  SkillOutcome,
  SourceRef,
} from "@/lib/types";
import { titleCase } from "@/lib/utils";

export interface AnalysisBundle {
  question: string;
  steps: PlannedStep[];
  outcomes: Array<{ step: PlannedStep; outcome: SkillOutcome; durationMs: number }>;
  evidence: Evidence[];
  entities: Entity[];
  sources: SourceRef[];
  rationale: string;
}

export function assessRisk(bundle: AnalysisBundle): RiskAssessment {
  const factors: RiskAssessment["factors"] = [];
  let score = 0;

  const add = (label: string, weight: number, detail: string) => {
    score += weight;
    factors.push({ label, weight, detail });
  };

  const unreachable = bundle.outcomes.filter(
    (item) => item.outcome.status === "unreachable",
  );
  const blocked = bundle.outcomes.filter((item) => item.outcome.status === "blocked");

  const bySeverity = (severity: string) =>
    bundle.evidence.filter((item) => item.severity === severity);

  if (bySeverity("critical").length > 0) {
    add(
      "Critical indicator present",
      26,
      bySeverity("critical")
        .map((item) => item.label)
        .slice(0, 3)
        .join(", "),
    );
  }
  const high = bySeverity("high");
  if (high.length > 0) {
    add(
      "High-severity findings",
      Math.min(high.length * 12, 30),
      high
        .map((item) => item.label)
        .slice(0, 4)
        .join(", "),
    );
  }
  const medium = bySeverity("medium");
  if (medium.length > 0) {
    add(
      "Medium-severity findings",
      Math.min(medium.length * 5, 20),
      `${medium.length} signal(s) worth review`,
    );
  }

  if (unreachable.length > 0) {
    add(
      "Blind spots in coverage",
      Math.min(unreachable.length * 10, 30),
      `${unreachable.length} source(s) could not be reached, so the picture is incomplete: ${unreachable
        .map((item) => item.step.skillId)
        .slice(0, 4)
        .join(", ")}`,
    );
  }
  if (blocked.length > 0) {
    add(
      "Keyed sources not consulted",
      Math.min(blocked.length * 6, 18),
      `${blocked.length} skill(s) need an API key and did not run`,
    );
  }

  if (bundle.evidence.length === 0) {
    add(
      "No evidence collected",
      20,
      "Nothing was verified, so nothing should be asserted.",
    );
  }

  const normalised = Math.min(100, Math.round(score));
  const band: RiskAssessment["band"] =
    normalised >= 75
      ? "severe"
      : normalised >= 55
        ? "high"
        : normalised >= 30
          ? "elevated"
          : normalised >= 12
            ? "guarded"
            : "minimal";

  const summary = factors.length
    ? `${band.toUpperCase()} — ${Math.round(normalised)}/100. Driven by: ${factors
        .map((factor) => factor.label.toLowerCase())
        .join("; ")}.`
    : "MINIMAL — no adverse signals were verified in this pass.";

  return { score: normalised, band, factors, summary };
}

function citationIndex(bundle: AnalysisBundle): Map<string, number> {
  const map = new Map<string, number>();
  bundle.sources.forEach((sourceRef, index) => {
    map.set(sourceRef.id, index + 1);
  });
  return map;
}

export function deterministicBriefing(
  bundle: AnalysisBundle,
  risk: RiskAssessment,
): string {
  const citations = citationIndex(bundle);
  const lines: string[] = [];
  const ok = bundle.outcomes.filter((item) => item.outcome.status === "ok");
  const partial = bundle.outcomes.filter((item) => item.outcome.status === "partial");
  const failed = bundle.outcomes.filter((item) =>
    ["unreachable", "blocked", "error"].includes(item.outcome.status),
  );

  const cite = (sourceId?: string) => {
    if (!sourceId) {
      return "";
    }
    const index = citations.get(sourceId);
    return index ? ` [${index}]` : "";
  };

  lines.push("### Bottom line");
  if (bundle.evidence.length === 0) {
    lines.push(
      `No evidence was collected for this request (${failed.length} source(s) unavailable). Nothing about the target can be asserted yet — treat the question as open. The risk read (**${risk.band}**, ${risk.score}/100) reflects how much could not be verified, not any finding against the target.`,
    );
  } else {
    lines.push(
      `${bundle.evidence.length} verified observation(s) across ${ok.length} completed skill(s)${
        partial.length ? `, ${partial.length} partial` : ""
      }${failed.length ? `, ${failed.length} unavailable` : ""}. Risk read: **${risk.band}** (${risk.score}/100).`,
    );
  }

  const facts = bundle.evidence
    .filter((item) => item.confidence === "confirmed" || item.confidence === "probable")
    .slice(0, 14);
  if (facts.length > 0) {
    lines.push("", "### What the sources actually returned");
    for (const item of facts) {
      lines.push(
        `- **${item.label}** — ${item.value}${cite(item.sourceId)}${item.detail ? `\n  - ${item.detail}` : ""}`,
      );
    }
  }

  const signals = bundle.evidence.filter(
    (item) => item.severity && ["medium", "high", "critical"].includes(item.severity),
  );
  if (signals.length > 0) {
    lines.push("", "### Signals that change the assessment");
    for (const item of signals) {
      lines.push(
        `- \`${(item.severity ?? "info").toUpperCase()}\` **${item.label}** — ${item.value}${cite(item.sourceId)}${
          item.detail ? `\n  - ${item.detail}` : ""
        }`,
      );
    }
  }

  if (bundle.entities.length > 0) {
    const grouped = new Map<string, string[]>();
    for (const entity of bundle.entities) {
      const list = grouped.get(entity.type) ?? [];
      list.push(entity.value);
      grouped.set(entity.type, list);
    }
    lines.push("", "### Identifiers worth pivoting on");
    for (const [type, values] of grouped) {
      lines.push(
        `- **${titleCase(type)}** — ${Array.from(new Set(values)).slice(0, 12).join(", ")}`,
      );
    }
  }

  lines.push("", "### Source coverage (honest accounting)");
  for (const item of bundle.outcomes) {
    const status = item.outcome.status;
    const marker =
      status === "ok"
        ? "✓"
        : status === "partial"
          ? "◐"
          : status === "blocked"
            ? "🔑"
            : status === "unreachable"
              ? "✕"
              : "!";
    lines.push(
      `- ${marker} **${item.step.skillId}** (${item.durationMs} ms) — ${item.outcome.summary}${
        item.outcome.error ? ` _(${item.outcome.error.message})_` : ""
      }`,
    );
  }

  lines.push("", "### Gaps and what to do next");
  const gaps: string[] = [];
  if (failed.some((item) => item.outcome.error?.code === "requires_key")) {
    gaps.push(
      "Configure the missing API keys listed above to close the keyed-source gaps — the skills are wired and will run as soon as a key is present.",
    );
  }
  if (failed.some((item) => item.outcome.status === "unreachable")) {
    gaps.push(
      "Some sources were unreachable from this runtime. Re-run from a host with egress to those services before drawing conclusions.",
    );
  }
  if (bundle.entities.some((entity) => entity.type === "coordinate")) {
    gaps.push(
      "Coordinates were recovered. Confirm them against independent imagery before treating the location as established.",
    );
  }
  if (bundle.evidence.some((item) => item.label.toLowerCase().includes("subdomain"))) {
    gaps.push(
      "Run the host resolution sweep on the discovered subdomains to separate live assets from historical ones.",
    );
  }
  gaps.push(
    "Every claim in this briefing is tied to a source reference above. Re-verify anything you intend to publish.",
  );
  for (const gap of gaps) {
    lines.push(`- ${gap}`);
  }

  return lines.join("\n");
}

export function buildModelPrompt(bundle: AnalysisBundle, risk: RiskAssessment): string {
  const citations = citationIndex(bundle);
  const sourceList = bundle.sources
    .map(
      (sourceRef) =>
        `[${citations.get(sourceRef.id)}] ${sourceRef.label}${sourceRef.url ? ` — ${sourceRef.url}` : ""}`,
    )
    .join("\n");

  const evidenceList = bundle.evidence
    .slice(0, 90)
    .map(
      (item) =>
        `- (${item.skillId}) [${item.confidence}${item.severity ? `/${item.severity}` : ""}] ${item.label}: ${item.value}${
          item.detail ? ` — ${item.detail}` : ""
        }${item.sourceId && citations.get(item.sourceId) ? ` [${citations.get(item.sourceId)}]` : ""}`,
    )
    .join("\n");

  const entityList = bundle.entities
    .slice(0, 60)
    .map(
      (entity) =>
        `- ${entity.type}: ${entity.value}${entity.attributes.length ? ` (${entity.attributes.map((attribute) => `${attribute.key}=${attribute.value}`).join(", ")})` : ""}`,
    )
    .join("\n");

  const coverage = bundle.outcomes
    .map(
      (item) =>
        `- ${item.step.skillId}: ${item.outcome.status} — ${item.outcome.summary}`,
    )
    .join("\n");

  return `QUESTION
${bundle.question}

DETECTION RATIONALE
${bundle.rationale}

DETERMINISTIC RISK READ (already computed — do not recompute or contradict)
band=${risk.band} score=${risk.score}/100
factors: ${risk.factors.map((factor) => `${factor.label} (${factor.weight})`).join("; ") || "none"}

EVIDENCE COLLECTED (this is everything you know — there is no other data)
${evidenceList || "- none"}

ENTITIES
${entityList || "- none"}

SOURCE COVERAGE
${coverage || "- none"}

CITABLE SOURCES
${sourceList || "- none"}`;
}

export const SYNTHESIS_INSTRUCTIONS = `You are the analyst-writing layer of an OSINT console. You do not have tools,
you cannot browse, and you cannot obtain new information. Write the analyst briefing using ONLY the evidence
block below.

Hard rules:
1. Never state a fact that is not in the evidence. No inferred owners, no assumed registrants, no guessed locations.
2. Attribute facts to source numbers inline, like [1] or [2][4].
3. Any source marked unreachable, blocked, error or partial must be named in a coverage section as a gap —
   never silently dropped, and never replaced by an assumption.
4. Distinguish confirmed observations from "possible"/"probable" reads. Say which is which.
5. Never claim a person's identity, caste, religion or community. Never claim who owns a phone number or a vehicle.
6. If the evidence does not answer the question, say so plainly and list what would answer it.
7. No filler, no marketing voice, no emoji, no "as an AI". Short declarative sentences.

Output markdown with these sections, in this order:
### Bottom line            (2-4 sentences, answers the question or states plainly that it cannot be answered)
### Verified observations  (bulleted, each with source numbers)
### Signals & risk         (only medium/high/critical evidence; keep the computed risk band)
### Coverage & gaps        (what ran, what did not, what it means for confidence)
### Recommended next steps (concrete, lawful, each tied to a gap)

Length: 200-420 words. Precision over completeness.`;
