import type {
  ArticleItem,
  Entity,
  Evidence,
  MediaItem,
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
  /** Retrieval results: images, footage and articles the skills brought back. */
  media?: MediaItem[];
  articles?: ArticleItem[];
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

const RETRIEVAL_SKILLS = new Set([
  "image-search",
  "video-search",
  "audio-search",
  "news-search",
  "image-provenance",
]);

/** True when the run was purely a "find me this" request, not an investigation. */
export function isRetrievalAsk(bundle: AnalysisBundle): boolean {
  return (
    bundle.steps.length > 0 &&
    bundle.steps.every((step) => RETRIEVAL_SKILLS.has(step.skillId))
  );
}

/**
 * The answer for a greeting. Nothing was collected, so it says what it can do
 * instead of running a pointless sweep and dressing it up as analysis.
 */
export function capabilityAnswer(
  mood: "greet" | "thanks" | "capability" = "greet",
): string {
  const opener =
    mood === "thanks"
      ? "**Any time — say what you need next.**"
      : mood === "capability"
        ? "**I am SkOiT — a research console, not a chatbot.** Everything I tell you comes from a public source I can name, and I say plainly when a source could not be reached."
        : "**Hello — tell me what to look for and I will go and get it.**";
  return [
    opener,
    "",
    "- **Pictures** — “find me a photo of Charminar at sunrise”",
    "- **Songs & audio** — “play me the song Kesariya”: downloadable tracks from the free libraries, or a 30-second licensed preview with the store link",
    "- **Footage & B-roll** — “B-roll of Mumbai local trains”",
    "- **News & articles** — “latest news on the Chennai floods” — gathered from public indexes and cross-checked across domains",
    "- **Questions** — “who is the chief minister of Maharashtra”, “what is a UPI mandate”: answered from the encyclopaedia entry, with the article cited as crowd-edited reference material",
    "- **Investigation** — paste a domain, IP, email, phone number, plate, PIN code or file hash",
    "",
    "_Nothing is searched until you ask. How much I collect — focused, standard or deep — and how the answer is written are both set in Settings → Answers._",
  ].join("\n");
}

/**
 * The answer for a retrieval request: what came back, what each item is licensed
 * under, and what could not be reached. Short on purpose — a request for a song
 * is not a request for a dossier.
 */
export function retrievalAnswer(bundle: AnalysisBundle): string {
  const media = bundle.media ?? [];
  const images = media.filter((item) => item.kind === "image");
  const clips = media.filter((item) => item.kind === "video");
  const audio = media.filter((item) => item.kind === "audio");
  const articles = bundle.articles ?? [];
  const failures = bundle.outcomes.filter((item) =>
    ["unreachable", "blocked", "error"].includes(item.outcome.status),
  );
  const lines: string[] = [];

  const parts: string[] = [];
  if (images.length > 0) {
    parts.push(`**${images.length} image(s)**`);
  }
  if (clips.length > 0) {
    parts.push(`**${clips.length} clip(s)**`);
  }
  if (audio.length > 0) {
    const downloadable = audio.filter((item) => item.access !== "preview").length;
    parts.push(
      `**${audio.length} track(s)**${downloadable < audio.length ? ` (${downloadable} downloadable, ${audio.length - downloadable} preview)` : ""}`,
    );
  }
  if (articles.length > 0) {
    const domains = new Set(articles.map((item) => item.domain));
    const corroborated = articles.filter((item) => (item.corroborations ?? 0) > 0).length;
    parts.push(
      `**${articles.length} article(s)** from ${domains.size} domain(s)${corroborated ? `, ${corroborated} corroborated` : ""}`,
    );
  }

  if (parts.length === 0) {
    lines.push(
      `Nothing came back for that request${
        failures.length > 0
          ? ` — ${failures.length} source(s) could not be reached.`
          : "."
      }`,
    );
    if (failures.length > 0) {
      lines.push(
        "",
        `Unavailable: ${failures.map((item) => item.step.skillId).join(", ")}. Open the run details for the exact reason from each library.`,
      );
      lines.push(
        "",
        "_If you are running this on a machine without outbound access to those libraries, the search will not return results — that is reported here rather than guessed at._",
      );
    }
  } else {
    lines.push(`Found ${parts.join(" · ")}.`);
    if (audio.some((item) => item.access === "preview")) {
      lines.push(
        "",
        "Full tracks are offered as downloadable files only where the uploader published them under a free licence; released commercial recordings come back as official 30-second previews with a store link.",
      );
    }
    if (articles.length > 0) {
      lines.push(
        "",
        `Every article links to its own site, and where a story appears on more than one independent domain it is marked as corroborated; single-source items say so.`,
      );
    }
    if (failures.length > 0) {
      lines.push(
        "",
        `Not every library answered this time (${failures.map((item) => item.step.skillId).join(", ")}); the run details show which failed and why.`,
      );
    }
  }
  return lines.join("\n");
}

/** Plain words for the risk band — the number stays available in the panel. */
const RISK_SENTENCE: Record<RiskAssessment["band"], string> = {
  minimal: "Nothing here stands out as a concern.",
  guarded: "A few things here are worth a second look.",
  elevated: "This is worth a closer look before you act on it.",
  high: "There are serious points here that need attention.",
  severe: "This is serious — treat it as needing attention now.",
};

/**
 * The default answer: the same evidence as the analyst briefing, written so a
 * person who is not an investigator can read it once and know what to do.
 * Technical terms stay, because they are the correct terms — each one is
 * explained where it is first used rather than replaced with a vague word.
 */
export function plainBriefing(bundle: AnalysisBundle, risk: RiskAssessment): string {
  const citations = citationIndex(bundle);
  const failed = bundle.outcomes.filter((item) =>
    ["unreachable", "blocked", "error"].includes(item.outcome.status),
  );
  const usable = bundle.evidence.filter(
    (item) => item.confidence === "confirmed" || item.confidence === "probable",
  );
  const cite = (sourceId?: string) => {
    const index = sourceId ? citations.get(sourceId) : undefined;
    return index ? ` [${index}]` : "";
  };
  const lines: string[] = [];

  lines.push("### In short");
  if (usable.length === 0) {
    lines.push(
      failed.length > 0
        ? `Nothing could be checked this time — ${failed.length} source(s) did not answer, so there is no finding to report yet. Try again or run it from a machine with internet access; nothing is being guessed at here.`
        : "Nothing was found to report. The question is still open — that is different from a clean result.",
    );
  } else {
    const first = usable[0];
    lines.push(
      `Checked ${bundle.outcomes.length} source(s) for this: ${usable.length} usable finding(s) came back${
        failed.length ? `, and ${failed.length} source(s) could not be reached` : ""
      }. ${RISK_SENTENCE[risk.band]} Start with the first finding below.`,
    );
    if (first) {
      lines.push(
        "",
        `The main thing: **${first.label}** — ${first.value}${cite(first.sourceId)}.`,
      );
    }
  }

  if (usable.length > 0) {
    lines.push("", "### What we found");
    for (const item of usable.slice(0, 12)) {
      const mark = item.confidence === "confirmed" ? "Confirmed" : "Likely";
      lines.push(
        `- **${item.label}** (${mark}) — ${item.value}${cite(item.sourceId)}${
          item.detail ? ` — ${item.detail}` : ""
        }`,
      );
    }
  }

  const signals = bundle.evidence.filter(
    (item) => item.severity && ["medium", "high", "critical"].includes(item.severity),
  );
  if (signals.length > 0) {
    lines.push("", "### What it means");
    for (const item of signals) {
      const word =
        item.severity === "critical"
          ? "Needs urgent attention"
          : item.severity === "high"
            ? "Needs attention"
            : "Worth noting";
      lines.push(`- ${word}: **${item.label}** — ${item.value}${cite(item.sourceId)}`);
    }
  }

  const media = bundle.media ?? [];
  const audio = media.filter((item) => item.kind === "audio");
  if (audio.length > 0) {
    const downloadable = audio.filter((item) => item.access !== "preview").length;
    lines.push(
      "",
      "### Music & audio",
      `- ${audio.length} playable result(s) — ${downloadable} full downloadable file(s) from free libraries${
        audio.length - downloadable > 0
          ? `, ${audio.length - downloadable} official 30-second preview(s) with a store link for the full release`
          : ""
      }.`,
    );
    for (const item of audio.slice(0, 5)) {
      lines.push(
        `- [${item.title}](${item.pageUrl ?? item.url}) — ${item.source}${
          item.artist ? ` · ${item.artist}` : ""
        }${item.licence ? ` · ${item.licence}` : ""}`,
      );
    }
  }

  const articles = bundle.articles ?? [];
  if (articles.length > 0) {
    const corroborated = articles.filter((item) => (item.corroborations ?? 0) > 0).length;
    lines.push(
      "",
      "### Reporting found",
      `- ${articles.length} article(s) from ${new Set(articles.map((item) => item.domain)).size} site(s); ${corroborated} of them are backed up by a second, independent site.`,
    );
    for (const item of articles.slice(0, 5)) {
      lines.push(
        `- [${item.title}](${item.url}) — ${item.domain}${
          item.publishedAt
            ? ` · ${new Date(item.publishedAt).toISOString().slice(0, 10)}`
            : ""
        }${(item.corroborations ?? 0) > 0 ? ` · +${item.corroborations} independent site(s)` : " · single source"}`,
      );
    }
  }

  if (failed.length > 0) {
    lines.push("", "### What we could not check");
    for (const item of failed) {
      lines.push(
        `- **${item.step.skillId}** — ${item.outcome.error?.message ?? item.outcome.summary}`,
      );
    }
    lines.push(
      "",
      "_Those gaps are the limits of this answer. Nothing above is affected by them, but a clean result here does not mean those sources would also be clean._",
    );
  }

  if (bundle.sources.length > 0) {
    lines.push("", "### Where this came from");
    bundle.sources.slice(0, 14).forEach((sourceRef, index) => {
      const number = citations.get(sourceRef.id) ?? index + 1;
      lines.push(
        `- [${number}] ${sourceRef.label}${sourceRef.url ? ` — ${sourceRef.url}` : ""}`,
      );
    });
  }

  if (bundle.entities.length > 0) {
    const grouped = new Map<string, string[]>();
    for (const entity of bundle.entities) {
      const list = grouped.get(entity.type) ?? [];
      list.push(entity.value);
      grouped.set(entity.type, list);
    }
    lines.push("", "### Names, numbers and addresses involved");
    for (const [type, values] of grouped) {
      lines.push(
        `- **${titleCase(type)}** — ${Array.from(new Set(values)).slice(0, 10).join(", ")}`,
      );
    }
  }

  lines.push(
    "",
    `_Full technical detail — including the ${bundle.outcomes.length}-source coverage table and the risk factors behind “${risk.band}” — is in Run details below._`,
  );

  return lines.join("\n");
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

  const findings = bundle.evidence.filter(
    (item) => item.confidence === "confirmed" || item.confidence === "probable",
  );

  lines.push("### Bottom line");
  if (bundle.evidence.length === 0) {
    lines.push(
      `No evidence was collected for this request (${failed.length} source(s) unavailable). Nothing about the target can be asserted yet — treat the question as open. The risk read (**${risk.band}**, ${risk.score}/100) reflects how much could not be verified, not any finding against the target.`,
    );
  } else if (ok.length === 0) {
    lines.push(
      `No source completed this run (${failed.length} unavailable), so nothing is verified yet — the question is still open. The risk read (**${risk.band}**, ${risk.score}/100) reflects what could not be reached, not a finding against the target.`,
    );
  } else {
    lines.push(
      `${findings.length} finding(s) from ${ok.length} completed skill(s)${
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

  const media = bundle.media ?? [];
  const articles = bundle.articles ?? [];
  if (media.length > 0) {
    const images = media.filter((item) => item.kind === "image");
    const clips = media.filter((item) => item.kind === "video");
    lines.push("", "### Files found (direct links, licences stated)");
    if (images.length > 0) {
      lines.push(
        `- **${images.length} image(s)** — ${images
          .slice(0, 3)
          .map(
            (item) =>
              `${item.title} (${item.source}${item.licence ? `, ${item.licence}` : ""})`,
          )
          .join("; ")}`,
      );
    }
    if (clips.length > 0) {
      lines.push(
        `- **${clips.length} clip(s)** — ${clips
          .slice(0, 3)
          .map((item) => `${item.title} (${item.source})`)
          .join("; ")}`,
      );
    }
    const unlicensed = media.filter((item) => !item.licence).length;
    if (unlicensed > 0) {
      lines.push(
        `- ${unlicensed} item(s) carry no stated licence — check the source page before publishing.`,
      );
    }
  }
  if (articles.length > 0) {
    const domains = new Set(articles.map((item) => item.domain));
    const corroborated = articles.filter((item) => (item.corroborations ?? 0) > 0);
    lines.push("", "### Reporting found");
    lines.push(
      `- **${articles.length} article(s)** across ${domains.size} domain(s); ${corroborated.length} item(s) corroborated by a second independent domain.`,
    );
    for (const item of articles.slice(0, 6)) {
      lines.push(
        `- [${item.title}](${item.url}) — ${item.domain}${
          item.publishedAt
            ? ` · ${new Date(item.publishedAt).toISOString().slice(0, 10)}`
            : ""
        }${item.corroborations ? ` · +${item.corroborations} independent domain(s)` : " · single source"}`,
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

function retrievalBlock(bundle: AnalysisBundle): string {
  const media = bundle.media ?? [];
  const articles = bundle.articles ?? [];
  if (media.length === 0 && articles.length === 0) {
    return "RETRIEVAL: nothing was requested from the media or news sources.";
  }
  const lines: string[] = [];
  if (media.length > 0) {
    lines.push(`FILES (${media.length}):`);
    for (const item of media.slice(0, 12)) {
      lines.push(
        `- [${item.kind}] ${item.title} | ${item.source} | licence: ${item.licence ?? "not stated"} | author: ${item.author ?? "unknown"} | ${item.url}`,
      );
    }
  }
  if (articles.length > 0) {
    lines.push(`ARTICLES (${articles.length}):`);
    for (const item of articles.slice(0, 14)) {
      lines.push(
        `- ${item.title} | ${item.domain} | ${item.publishedAt ? new Date(item.publishedAt).toISOString().slice(0, 10) : "undated"} | corroborations: ${item.corroborations ?? 0}${item.syndicated ? " | syndicated copy" : ""} | ${item.url}`,
      );
    }
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
${sourceList || "- none"}

RETRIEVAL RESULTS (files and reporting actually returned by the sources)
${retrievalBlock(bundle)}`;
}

export const RETRIEVAL_INSTRUCTIONS = `You are the writing layer of a search console. The user asked for something to be
found — a picture, a song, footage or news. Answer with what was actually returned, in the same register the
question was asked in, and nothing else.

Hard rules:
1. Never name an item that is not in the RETRIEVAL RESULTS block.
2. Two to five short lines. No headings, no bullet lists longer than the results, no risk talk, no coverage table.
3. State the count found and, where it matters, the licence that applies. Say plainly when a result is only a
   30-second preview rather than a downloadable file.
4. If nothing was returned, say so in one line and name which library failed — never soften it into a maybe.
5. No filler, no marketing voice, no emoji.

Plain prose only.`;

export const PLAIN_INSTRUCTIONS = `You are the writing layer of an OSINT console, and you are writing for a
general reader — a journalist, a small-business owner, a worried parent — not for another analyst. You do not
have tools, you cannot browse, and you cannot obtain new information. Use ONLY the evidence block below.

Hard rules:
1. Never state a fact that is not in the evidence. No inferred owners, no assumed registrants, no guessed locations.
2. Keep the correct technical terms — DNS record, WHOIS registrant, ASN, TLS certificate, EXIF, breach
   corpus — but explain each one in a few plain words the first time it appears, then carry on using it.
3. Attribute facts to source numbers inline, like [1] or [2][4].
4. Any source marked unreachable, blocked, error or partial must be named in plain words under "What we could
   not check" — never silently dropped and never replaced by an assumption.
5. Separate what is confirmed from what is only likely. Say which is which in the sentence itself.
6. Never claim a person's identity, caste, religion or community. Never claim who owns a phone number or a vehicle.
7. If the evidence does not answer the question, say that in the first line and name what would answer it.
8. No filler, no marketing voice, no emoji, no "as an AI", no hedging padding. Short declarative sentences.

Output markdown with these sections, in this order, and omit any section with nothing in it:
### In short                 (2-3 sentences: what was checked, what came back, and what to do with it)
### What we found            (bulleted; each line starts with the thing found, then what it is, then [source])
### What it means            (only the points that change how the reader should act; plain consequences)
### What we could not check  (which sources did not answer, and what that does and does not imply)
### Where this came from     (numbered sources with URLs)

Match length to the question. A request for an image, a song or a news item is answered in a few lines —
name what was found, where it came from and its licence, and mark single-source reporting as unconfirmed.`;

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

Match the length of the answer to the question that was asked: when the analyst only wanted an image, a
clip or a news item, answer that in a few lines instead of restating the whole evidence table. When
retrieval results are present, name what was found, where it came from and its licence, and mark
single-source reporting as unconfirmed.`;
