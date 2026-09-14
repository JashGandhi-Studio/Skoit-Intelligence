import { getSkill, skillsMatchingText } from "@/lib/skills";
import {
  detectTargets,
  looksLikeDomain,
  normalizeDomain,
  targetLabel,
} from "@/lib/skills/identify";
import type {
  AgentRequest,
  AnswerPreferences,
  DetectedTarget,
  PlannedStep,
  SkillDefinition,
  TargetKind,
} from "@/lib/types";
import { DEFAULT_ANSWER_PREFERENCES } from "@/lib/types";

export type RetrievalKind = "image" | "video" | "news" | "article";

export interface AnswerIntent {
  /** What the analyst actually asked to be found. */
  kinds: RetrievalKind[];
  /** The cleaned subject, with the request phrasing stripped out. */
  topic: string;
  /** True when the request asked for a specific medium rather than only a topic. */
  explicit: boolean;
  /** True when the analyst explicitly asked for a video (used for stock footage). */
  wantsVideo: boolean;
}

const RETRIEVAL_PATTERNS: Array<{ kind: RetrievalKind; pattern: RegExp }> = [
  {
    kind: "video",
    pattern:
      /\b(videos?|clips?|footage|b[\s-]?roll|broll|reels?|timelapse|drone shots?|animation|stock video|video chahiye|video dikhao)\b/i,
  },
  {
    kind: "image",
    pattern:
      /\b(images?|photos?|pictures?|pics?|wallpapers?|posters?|illustrations?|graphics?|thumbnails?|banners?|logos?|visuals?|stock photos?|stock images?|image chahiye|photo chahiye|dikhao|dikha do|screenshot)\b/i,
  },
  {
    kind: "news",
    pattern:
      /\b(news|latest|headlines?|breaking|khabar|samachar|current affairs|what happened|aaj ka)\b/i,
  },
  {
    kind: "article",
    pattern:
      /\b(articles?|blogs?|posts?|essays?|papers?|stud(y|ies)|research|reports?|tutorials?|guides?|documentation|whitepapers?|read (about|up on)|explained)\b/i,
  },
];

/** Words that carry no subject once the request phrasing is removed. */
const REQUEST_NOISE =
  /\b(please|pls|kindly|hey|hi|hello|ok|okay|so|now|then|can you|could you|would you|i want|i need|i would like|give me|gimme|show me|find me|get me|fetch me|search for|search|look for|look up|pull up|download|free|royalty[\s-]?free|licen[cs]e[\s-]?free|unlimited|no copyright|copyright free|b[\s-]?roll|broll|stock|clips?|footage|videos?|images?|photos?|pictures?|pics?|wallpapers?|posters?|illustrations?|graphics?|articles?|blogs?|news|latest|headlines?|breaking|about|regarding|related to|for|of|on|some|any|the|a|an|chahiye|dikhao|dikha|do|de|dedo|la|bhej)\b/gi;

export function cleanTopic(message: string): string {
  const stripped = message
    .replace(REQUEST_NOISE, " ")
    .replace(/[?!.]+$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const cleaned = stripped.replace(/^[\s,;:-]+|[\s,;:-]+$/g, "");
  // If stripping removed the subject entirely, fall back to the raw ask.
  return cleaned.length >= 2 ? cleaned.slice(0, 180) : message.trim().slice(0, 180);
}

export function detectIntent(
  message: string,
  preferences: AnswerPreferences,
  hasAttachments: boolean,
): AnswerIntent {
  const kinds: RetrievalKind[] = [];
  let explicit = false;

  for (const { kind, pattern } of RETRIEVAL_PATTERNS) {
    if (!pattern.test(message)) {
      continue;
    }
    const enabled =
      kind === "image"
        ? preferences.media.images
        : kind === "video"
          ? preferences.media.videos
          : kind === "news"
            ? preferences.media.news
            : preferences.media.articles;
    // An explicit ask always wins over a toggle — capability is never silently removed.
    if (enabled || /\b(news|images?|photos?|videos?|articles?)\b/i.test(message)) {
      kinds.push(kind);
      explicit = true;
    }
  }

  // Nudging the depth: "latest news" implies recency, an article ask implies reading.
  const topic = cleanTopic(message);
  const wantsVideo = kinds.includes("video");
  if (hasAttachments && !kinds.includes("image")) {
    kinds.push("image");
  }

  return { kinds, topic, explicit, wantsVideo };
}

const TYPO_KEYWORDS =
  /(typo|lookalike|look-alike|phish|spoof|fake|impersonat|clone|squat|brand)/i;
const SEARCH_KEYWORDS =
  /(news|search|google|find|mention|press|article|reported|coverage)/i;
const FULL_SWEEP =
  /(full|deep|everything|all skills|complete|exhaustive|sweep everything)/i;

const RETRIEVAL_SKILL_IDS = new Set([
  "image-search",
  "video-search",
  "news-search",
  "image-provenance",
]);

const RETRIEVAL_SKILL_FOR: Record<RetrievalKind, string> = {
  image: "image-search",
  video: "video-search",
  news: "news-search",
  article: "news-search",
};

const PROVENANCE_KEYWORDS =
  /(provenance|reverse image|where is this|find this image|source of (this|the) (image|photo|picture)|original (image|photo|picture)|image origin|kahan se|kaun si photo|phota kahan)/i;

const BASE_PLAN: Partial<Record<TargetKind, string[]>> = {
  domain: ["dns-intel", "domain-registration", "certificate-transparency", "dns-posture"],
  url: ["url-structure", "archive-history"],
  ip: ["ip-geolocation", "ip-services", "reverse-dns", "ip-registry"],
  email: ["email-intelligence", "breach-exposure"],
  phone: ["phone-intelligence"],
  username: ["username-footprint"],
  hash: ["hash-intel", "reference-lab"],
  "crypto-address": ["crypto-address"],
  coordinate: ["coordinate-intelligence"],
  person: ["name-conventions", "sanctions-screening"],
  text: ["text-intelligence"],
};

const REASONS: Record<string, string> = {
  "dns-intel":
    "Establish what the name actually resolves to before trusting anything else.",
  "domain-registration": "Registry record gives ownership, age and lifecycle signals.",
  "certificate-transparency":
    "CT logs are the cheapest real subdomain enumeration available.",
  "dns-posture": "Mail and CAA posture shows how easily the domain can be spoofed.",
  "typosquat-watch": "Brand-abuse indicators were requested or implied by the phrasing.",
  "url-structure": "Dissect the link before any request goes near the destination.",
  "archive-history": "Archived captures date the page and reveal content changes.",
  "ip-geolocation": "Geolocation, ISP and hosting flags for the address.",
  "ip-services": "Passive scan noise shows what is actually exposed to the internet.",
  "reverse-dns": "PTR naming conventions expose the provider and naming scheme.",
  "ip-registry": "Authoritative RIR record for the containing block.",
  "email-intelligence": "Confirm the mailbox is real and classify its operator.",
  "breach-exposure": "Credential exposure changes the whole risk picture for an address.",
  "username-footprint": "Public profiles tie a handle to names, places and dates.",
  "hash-intel": "Identify algorithm and strength, then check corpus coverage.",
  "reference-lab": "Decode any identifier embedded in the string.",
  "crypto-address": "Validate the address checksum before any attribution attempt.",
  "phone-intelligence": "Offline numbering-plan analysis: country, line type, validity.",
  "pincode-intelligence": "Postal prefix and delivery data for the PIN code.",
  "vehicle-registration": "Decode the plate's state, RTO zone and series structure.",
  "identity-documents": "Validate Indian document formats with real checksums.",
  "coordinate-intelligence":
    "Normalise the position and place it against reference cities.",
  "name-conventions": "Plan transliteration variants for searching a name.",
  "sanctions-screening":
    "Screening is mandatory before any adverse statement about a person.",
  "attachment-review":
    "Extract and interpret file metadata before reporting on the file.",
  "host-resolution-sweep": "Triage the host list down to what is actually live.",
  "web-search": "Broaden beyond link-level sources with indexed search.",
};

function stepFor(
  skill: SkillDefinition,
  target: DetectedTarget,
  index: number,
): PlannedStep {
  return {
    id: `step_${index}_${skill.id}`,
    skillId: skill.id,
    label: `${skill.short} · ${targetLabel(target)}`,
    targetKind: target.kind,
    target: target.value,
    reason: REASONS[skill.id] ?? skill.description,
    status: "queued",
    meta: target.meta,
  };
}

function textDerivedTargets(message: string): DetectedTarget[] {
  const extra: DetectedTarget[] = [];
  const pin = message.match(/\b([1-9]\d{5})\b/);
  if (pin) {
    extra.push({
      kind: "text",
      value: pin[1],
      raw: pin[1],
      confidence: "probable",
      meta: { hint: "pincode" },
    });
  }
  const plate = message
    .toUpperCase()
    .match(/\b([A-Z]{2}[\s-]?\d{1,2}[\s-]?[A-Z]{0,3}[\s-]?\d{1,4})\b/);
  if (plate && /(vehicle|car|bike|plate|registration|rto)/i.test(message)) {
    extra.push({
      kind: "text",
      value: plate[1].replace(/\s/g, ""),
      raw: plate[1],
      confidence: "probable",
      meta: { hint: "vehicle" },
    });
  }
  const person = message.match(
    /\b(?:mr|mrs|ms|dr|shri|smt)\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/,
  );
  if (person) {
    extra.push({
      kind: "person",
      value: person[1],
      raw: person[1],
      confidence: "probable",
    });
  }
  return extra;
}

export interface Plan {
  targets: DetectedTarget[];
  steps: PlannedStep[];
  rationale: string;
  mode: "deep" | "standard" | "focused";
  /** What the analyst asked to be found, for the plan card. */
  intent: AnswerIntent;
}

export function buildPlan(request: AgentRequest): Plan {
  const message = request.message ?? "";
  const attachments = request.attachments ?? [];
  const detected = detectTargets(message);
  const extras = textDerivedTargets(message);
  const targets = [...detected, ...extras];

  const preferences = request.preferences ?? DEFAULT_ANSWER_PREFERENCES;
  const intent = detectIntent(message, preferences, attachments.length > 0);
  const focus = preferences.focus;
  const wantsDeep = FULL_SWEEP.test(message) || focus === "deep";
  const wantsTyposquat = TYPO_KEYWORDS.test(message);
  const wantsSearch = SEARCH_KEYWORDS.test(message);
  const hardTargets = targets.filter((target) => target.kind !== "text");

  const requested = new Set(request.skillIds ?? []);
  const steps: PlannedStep[] = [];
  let counter = 0;

  const addStep = (skill: SkillDefinition, target: DetectedTarget) => {
    const key = `${skill.id}::${target.value}`;
    if (steps.some((step) => `${step.skillId}::${step.target}` === key)) {
      return;
    }
    steps.push(stepFor(skill, target, counter));
    counter += 1;
  };

  const addSkillChain = (kind: TargetKind, target: DetectedTarget) => {
    for (const skillId of BASE_PLAN[kind] ?? []) {
      const skill = getSkill(skillId);
      if (skill) {
        addStep(skill, target);
      }
    }
  };

  const retrievalTarget = (
    topic: string,
    extra: Record<string, string> = {},
  ): DetectedTarget => ({
    kind: "text",
    value: topic,
    raw: message.slice(0, 500),
    confidence: "confirmed",
    meta: {
      query: topic,
      perSource: String(preferences.perSource ?? 8),
      licence: preferences.licence ?? "reusable",
      timespan: focus === "deep" ? "2w" : "3d",
      ...(preferences.language ? { language: preferences.language } : {}),
      ...(preferences.region ? { region: preferences.region } : {}),
      ...extra,
    },
  });

  const addRetrieval = (kind: RetrievalKind, topic = intent.topic) => {
    const skill = getSkill(RETRIEVAL_SKILL_FOR[kind]);
    if (skill) {
      addStep(skill, retrievalTarget(topic));
    }
  };

  const retrievalOnly = intent.kinds.length > 0 && hardTargets.length === 0;

  if (retrievalOnly) {
    // The analyst asked for a thing to be found, not for a dossier. Answer that.
    for (const kind of intent.kinds) {
      addRetrieval(kind);
    }
    if (attachments.length > 0) {
      const review = getSkill("attachment-review");
      if (review) {
        addStep(review, {
          kind: "text",
          value: attachments.map((item) => item.name).join(", "),
          raw: message || "attachment",
          confidence: "confirmed",
        });
      }
      const provenance = getSkill("image-provenance");
      if (provenance) {
        addStep(provenance, retrievalTarget(intent.topic));
      }
    }
    if (focus !== "focused") {
      const context = getSkill("text-intelligence");
      if (context) {
        addStep(context, targetLike(message));
      }
    }
    const mode: Plan["mode"] = wantsDeep
      ? "deep"
      : focus === "standard"
        ? "standard"
        : "focused";
    return {
      targets,
      steps,
      rationale: `Asked for ${intent.kinds.join(" + ")} on “${intent.topic}” — running ${steps.length} retrieval skill(s) and nothing else. ${
        focus === "focused"
          ? "Focused mode keeps the answer to exactly this."
          : "Wider modes add background, never noise."
      }`,
      mode,
      intent,
    };
  }

  for (const target of targets) {
    addSkillChain(target.kind, target);

    if (target.kind === "url" || target.kind === "domain" || target.kind === "email") {
      const host = normalizeDomain(
        target.kind === "email" ? (target.value.split("@")[1] ?? "") : target.value,
      );
      if (looksLikeDomain(host)) {
        const domainTarget: DetectedTarget = {
          kind: "domain",
          value: host,
          raw: host,
          confidence: "confirmed",
        };
        if (target.kind === "url") {
          addSkillChain("domain", domainTarget);
        }
        if (target.kind === "email") {
          const dnsPosture = getSkill("dns-posture");
          if (dnsPosture) {
            addStep(dnsPosture, domainTarget);
          }
        }
      }
    }

    if (target.kind === "text") {
      if (target.meta?.hint === "pincode") {
        const skill = getSkill("pincode-intelligence");
        if (skill) {
          addStep(skill, target);
        }
      }
      if (target.meta?.hint === "vehicle") {
        const skill = getSkill("vehicle-registration");
        if (skill) {
          addStep(skill, target);
        }
      }
    }
  }

  // Keyword-driven additions: the analyst asked for something specific.
  for (const skill of skillsMatchingText(message)) {
    if (RETRIEVAL_SKILL_IDS.has(skill.id)) {
      // Retrieval skills are planned from detected intent, with a cleaned query.
      continue;
    }
    if (skill.id === "typosquat-watch" && !wantsTyposquat) {
      continue;
    }
    if (skill.id === "web-search" && !wantsSearch) {
      continue;
    }
    const target = targets.find((candidate) =>
      skill.accepts.includes(candidate.kind),
    ) ?? {
      kind: "text" as TargetKind,
      value: message.slice(0, 200),
      raw: message.slice(0, 200),
      confidence: "possible" as const,
    };
    addStep(skill, target);
  }

  if (wantsTyposquat) {
    for (const target of targets.filter(
      (item) => item.kind === "domain" || item.kind === "url",
    )) {
      const skill = getSkill("typosquat-watch");
      const host = normalizeDomain(target.value);
      if (skill && looksLikeDomain(host)) {
        addStep(skill, {
          kind: "domain",
          value: host,
          raw: host,
          confidence: "confirmed",
        });
      }
    }
  }

  // Media and news asks alongside a hard target: the analyst wants both.
  for (const kind of intent.kinds) {
    addRetrieval(kind, hardTargets[0]?.value ?? intent.topic);
  }
  if (
    attachments.length > 0 &&
    (PROVENANCE_KEYWORDS.test(message) || intent.kinds.includes("image"))
  ) {
    const provenance = getSkill("image-provenance");
    if (provenance) {
      addStep(provenance, retrievalTarget(intent.topic));
    }
  }

  if (wantsSearch && !request.skillIds?.length) {
    const search = getSkill("web-search");
    if (search) {
      addStep(search, targetLike(message));
    }
  }

  if (attachments.length > 0) {
    const skill = getSkill("attachment-review");
    if (skill) {
      addStep(skill, {
        kind: "text",
        value: attachments.map((item) => item.name).join(", "),
        raw: message || attachments.map((item) => item.name).join(", "),
        confidence: "confirmed",
        meta: { attachments: JSON.stringify(attachments) },
      });
    }
  }

  if (wantsDeep && hardTargets.length > 0) {
    const reporting = getSkill("news-search");
    if (reporting) {
      addStep(reporting, retrievalTarget(hardTargets[0].value));
    }
  }

  if (wantsDeep) {
    const multiHostSkill = getSkill("host-resolution-sweep");
    if (multiHostSkill) {
      addStep(multiHostSkill, targetLike(message));
    }
    const documents = getSkill("identity-documents");
    if (documents) {
      addStep(documents, targetLike(message));
    }
  }

  if (steps.length === 0) {
    const fallback = getSkill("text-intelligence");
    if (fallback) {
      addStep(fallback, targetLike(message));
    }
    const reference = getSkill("reference-lab");
    if (reference) {
      addStep(reference, targetLike(message));
    }
  }

  if (request.skillIds?.length) {
    const filtered = steps.filter((step) => requested.has(step.skillId));
    if (filtered.length > 0) {
      return {
        targets,
        steps: filtered,
        rationale: buildRationale(targets, filtered, "focused"),
        mode: "focused",
        intent,
      };
    }
  }

  const mode: Plan["mode"] = wantsDeep
    ? "deep"
    : focus === "standard"
      ? "standard"
      : "focused";
  return {
    targets,
    steps,
    rationale: buildRationale(targets, steps, mode),
    mode,
    intent,
  };
}

function targetLike(value: string): DetectedTarget {
  return {
    kind: "text",
    value: value.slice(0, 200),
    raw: value.slice(0, 1000),
    confidence: "possible",
  };
}

function buildRationale(
  targets: DetectedTarget[],
  steps: PlannedStep[],
  mode: Plan["mode"],
): string {
  if (targets.length === 0) {
    return `No identifiers found in the request, so the plan runs ${steps.length} text-level skill(s) to extract any that are hidden in prose.`;
  }
  const kinds = Array.from(new Set(targets.map((target) => targetLabel(target)))).join(
    ", ",
  );
  const width =
    mode === "deep"
      ? "full sweep including batch, reporting and document checks"
      : mode === "standard"
        ? "the identifier chain plus background reporting"
        : "a focused pass on just what was asked";
  return `Detected ${targets.length} identifier(s): ${kinds}. Selected ${steps.length} skill(s) — ${width}. Sources that need a key are still listed; they report themselves as unavailable instead of guessing.`;
}
