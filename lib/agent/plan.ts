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

export type RetrievalKind = "image" | "video" | "audio" | "news" | "article";

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
      /\b(videos?|clips?|footage|b[\s-]?roll|broll|reels?|timelapse|drone shots?|animation|stock video|video chahiye|video dikhao)\b|वीडियो|वीडिओ|क्लिप|फुटेज/i,
  },
  {
    kind: "image",
    pattern:
      /\b(images?|photos?|pictures?|pics?|wallpapers?|posters?|illustrations?|graphics?|thumbnails?|banners?|logos?|visuals?|stock photos?|stock images?|image chahiye|photo chahiye|dikhao|dikha do|screenshot|tasveer|tasvir|tasweer|chitra|chitr)\b|तस्वीर|फोटो|चित्र|तस्वीरें|चित्रों/i,
  },
  {
    kind: "audio",
    pattern:
      /\b(songs?|music|audio|mp3|tracks?|tunes?|soundtrack|bgm|background music|instrumental|playlist|lofi|lo-fi|play|playback|bajao|baja do|bhajan|ghazal|qawwali|ringtone|jingle|gana|gaana|sangeet|geet|dhun|sunna|sunao|suno)\b|गाना|गाने|संगीत|धुन|ऑडियो|सुनाओ|सुनो/i,
  },
  {
    kind: "news",
    pattern:
      /\b(news|latest|headlines?|breaking|khabar|khabrein|samachar|current affairs|what happened|aaj ka)\b|खबर|समाचार|ताज़ा/i,
  },
  {
    kind: "article",
    pattern:
      /\b(articles?|blogs?|posts?|essays?|papers?|stud(y|ies)|research|reports?|tutorials?|guides?|documentation|whitepapers?|read (about|up on)|explained|lekh|article)\b|लेख|रिपोर्ट/i,
  },
];

/** Words that carry no subject once the request phrasing is removed. */
const LEADING_NOISE =
  /^\s*(?:please|pls|kindly|hey|hi+|hello+|ok|okay|so|now|then|can you|could you|would you|i want|i need|i would like|give me|gimme|show me|find me|get me|fetch me|search for|search|look for|look up|pull up|tell me|explain)\b[\s,]*/i;

const REQUEST_NOISE =
  /\b(please|pls|kindly|okay|can you|could you|would you|i want|i need|i would like|give me|gimme|show me|find me|get me|fetch me|search for|search|look for|look up|pull up|tell me about|tell me|download|free|reusable|royalty[\s-]?free|licen[cs]e[\s-]?free|licen[cs]ed|unlimited|no copyright|copyright free|creative commons|cc0|public domain|full|complete|file|files|song|songs|music|audio|mp3|track|tracks|tune|tunes|play|playback|listen|streaming|b[\s-]?roll|broll|stock|clips?|footage|videos?|images?|photos?|pictures?|pics?|wallpapers?|posters?|illustrations?|graphics?|articles?|blogs?|news|latest|headlines?|breaking|exhaustive|sweep|everything|about|regarding|related to|for|of|on|some|any|the|a|an|chahiye|chaiye|dikhao|dikha|do|de|dedo|la|bhej|mujhe|mujhko|batao|bata|dekhna|dekhni|chahta|chahti|kuch|koi|bare|baare|mein|ki|ka|ke|hai|hain|kya|liye|wala|wali|aap|aapko|sakte|sakta|sakti|ho|hun|hu|kar|karke|karo|suno|sunao|sunna|gaana|gana|geet|sangeet|dhun|bajao|na|ek|this|these|those|is|was|are|were|it|its|that|shown|above|below|attached|who is|who was|who are|what is|what was|what are|where is|when was|meaning of|definition of|history of|information on|about|me|my|mine|us|our)\b/gi;

/**
 * Devanagari request words. JS \b does not treat Devanagari as word characters,
 * so these are stripped without word boundaries, longest first.
 */
const DEVANAGARI_NOISE =
  /(?<![\u0900-\u097F])(?:के बारे में|बारे में|दिखाओ|दिखाइए|दिखा दो|चाहिए|चाहिये|कीजिए|मुझे|तस्वीरें|तस्वीर|फ़ोटो|फोटो|चित्रों|चित्र|वीडियो|वीडिओ|बी-रोल|बीरोल|फुटेज|क्लिप|खबरें|खबर|समाचार|ताज़ा|लेख|रिपोर्ट|गाना|गाने|संगीत|धुन|सुनाओ|सुनो|ऑडियो|बजाओ|अच्छा|अच्छी|कोई|कुछ|की|का|के|पर|में|और|है|हैं)(?![\u0900-\u097F])/g;

export function cleanTopic(message: string): string {
  let stripped = message;
  // Polite openers are dropped only where they open the sentence, so a title
  // like "Tum Hi Ho" keeps its own words.
  for (let pass = 0; pass < 3; pass += 1) {
    stripped = stripped.replace(LEADING_NOISE, " ");
  }
  stripped = stripped
    .replace(DEVANAGARI_NOISE, " ")
    // The composer's sweep switch appends a marker to the prompt; it is a mode
    // instruction, not part of the subject being searched.
    .replace(/\((?:full|deep)\s+sweep\)/gi, " ")
    .replace(REQUEST_NOISE, " ")
    .replace(/[?!.]+$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const cleaned = stripped.replace(/^[\s,;:-]+|[\s,;:-]+$/g, "");
  // If stripping removed the subject entirely, search the words as they were
  // typed rather than a meaningless fragment of them.
  return cleaned.replace(/\s+/g, "").length >= 3
    ? cleaned.slice(0, 180)
    : message.trim().slice(0, 180);
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
          : kind === "audio"
            ? preferences.media.audio
            : kind === "news"
              ? preferences.media.news
              : preferences.media.articles;
    // An explicit ask always wins over a toggle — capability is never silently removed.
    if (
      enabled ||
      /\b(news|images?|photos?|videos?|articles?|songs?|music|audio|mp3)\b/i.test(message)
    ) {
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
  "audio-search",
  "news-search",
  "image-provenance",
]);

const RETRIEVAL_SKILL_FOR: Record<RetrievalKind, string> = {
  image: "image-search",
  video: "video-search",
  audio: "audio-search",
  news: "news-search",
  article: "news-search",
};

export type SmallTalkMood = "greet" | "thanks" | "capability";

/** Messages that are just a greeting or a thank-you — not a request yet. */
const SMALL_TALK =
  /^\s*(hi+|hey+|hello+|yo|namaste|namaskar|pranam|salaam|sat sri akal|vanakkam|nomoshkar|good (morning|evening|afternoon|night)|thanks?|thank you|shukriya|dhanyavaad|ok|okay|k|cool|nice|great)\s*[!.,?]*\s*$/i;

const SMALL_TALK_PHRASES =
  /^\s*(good (morning|evening|afternoon|night)|thank you( so much)?|thanks a lot|shukriya|dhanyavaad|how are you( doing)?|kaise ho|kaisa hai|kya haal( hai)?|what can you do|what do you do|what are you|who are you|help me out|help|kya kar sakte ho|kya kar sakti ho|tum kaun ho|aap kaun ho)\s*[!.,?]*\s*$/i;

/** Exact words a greeting can be misspelled into, including the classic "high". */
const SMALL_TALK_WORDS = [
  "hi",
  "hey",
  "hello",
  "helo",
  "hlo",
  "yo",
  "sup",
  "namaste",
  "namaskar",
  "pranam",
  "salaam",
  "vanakkam",
  "nomoshkar",
  "thanks",
  "thank",
  "thankyou",
  "thnx",
  "thanx",
  "ty",
  "ok",
  "okay",
  "cool",
  "nice",
  "great",
  "good",
  "morning",
  "evening",
  "afternoon",
  "night",
  "high",
  "help",
];

/** Bounded Levenshtein distance — enough for typos, cheap enough for a regex-free check. */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) {
    return true;
  }
  if (Math.abs(a.length - b.length) > 1) {
    return false;
  }
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) {
      return false;
    }
    if (a.length > b.length) {
      i += 1;
    } else if (b.length > a.length) {
      j += 1;
    } else {
      i += 1;
      j += 1;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

export function classifySmallTalk(message: string): {
  smallTalk: boolean;
  mood: SmallTalkMood;
} {
  const trimmed = message.trim();
  if (!trimmed) {
    return { smallTalk: false, mood: "greet" };
  }
  if (SMALL_TALK_PHRASES.test(trimmed) || SMALL_TALK.test(trimmed)) {
    return { smallTalk: true, mood: moodOf(trimmed) };
  }

  // "helllo", "heyy", "hii", "high" — one typo, up to three short words.
  const tokens = trimmed
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0 || tokens.length > 3) {
    return { smallTalk: false, mood: "greet" };
  }
  const everyTokenIsGreeting = tokens.every((token) =>
    SMALL_TALK_WORDS.some((word) => withinOneEdit(token, word)),
  );
  return { smallTalk: everyTokenIsGreeting, mood: moodOf(trimmed) };
}

function moodOf(message: string): SmallTalkMood {
  if (/thank|shukriya|dhanyavaad|thnx|thanx/i.test(message)) {
    return "thanks";
  }
  if (
    /what can you do|what do you do|who are you|what are you|help|kya kar sakt|tum kaun|aap kaun/i.test(
      message,
    )
  ) {
    return "capability";
  }
  return "greet";
}

/** Questions that want an encyclopaedia entry rather than an investigation. */
const KNOWLEDGE_ASK =
  /\b(who is|who was|what is|what was|what are|meaning of|definition of|history of|biography|tell me about|explain|kya hai|kaun hai|kaun tha|jankari|ke bare mein|bare mein)\b|कौन है|क्या है|इतिहास|के बारे में/i;

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
  /** Set when the message was conversation rather than a request. */
  smallTalk?: SmallTalkMood;
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

  const talk =
    targets.length === 0 && intent.kinds.length === 0
      ? classifySmallTalk(message)
      : { smallTalk: false, mood: "greet" as SmallTalkMood };

  if (talk.smallTalk) {
    return {
      targets,
      steps: [],
      smallTalk: talk.mood,
      rationale:
        talk.mood === "greet"
          ? "That is a greeting, not a request yet — no skills were run and nothing was looked up. Ask for a picture, a track, footage, a news story, a question to look up, or name a domain, IP, phone, plate, PIN or hash to investigate."
          : talk.mood === "thanks"
            ? "That was thanks, not a request — no skills were run. Say what you need next and it will be collected the same way."
            : "That was a question about me, not about a target — no skills were run. Here is what this console can actually collect.",
      mode: "focused",
      intent,
    };
  }

  const retrievalOnly = intent.kinds.length > 0 && hardTargets.length === 0;

  const provenanceAsk = PROVENANCE_KEYWORDS.test(message);

  if (retrievalOnly) {
    // The analyst asked for a thing to be found, not for a dossier. Answer that.
    for (const kind of intent.kinds) {
      // "Is this photo original?" is a question about the attached image, not a
      // request for fresh stock photos — the provenance skill answers it.
      if (kind === "image" && attachments.length > 0 && provenanceAsk) {
        continue;
      }
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
    if (steps.length === 0) {
      // Nothing to search for (e.g. only a provenance question) — fall back to
      // reading the request itself rather than returning an empty plan.
      const context = getSkill("text-intelligence");
      if (context) {
        addStep(context, targetLike(message));
      }
    }
    if (focus !== "focused" && !PROVENANCE_KEYWORDS.test(message)) {
      const context = getSkill("text-intelligence");
      if (context) {
        addStep(context, targetLike(message));
      }
    }

    // Depth, in the only sense that means anything for a search: how much
    // ground around the request gets covered. Standard adds the reporting around
    // it; deep adds the other visual medium as well. Never the whole toolbox.
    if (focus !== "focused") {
      if (!intent.kinds.includes("news") && preferences.media.news) {
        addRetrieval("news");
      }
      if (wantsDeep) {
        if (intent.kinds.includes("image") && preferences.media.videos) {
          addRetrieval("video");
        }
        if (intent.kinds.includes("video") && preferences.media.images) {
          addRetrieval("image");
        }
        if (intent.kinds.includes("audio") && preferences.media.images) {
          addRetrieval("image");
        }
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
      rationale:
        attachments.length > 0 &&
        provenanceAsk &&
        intent.kinds.every((kind) => kind === "image")
          ? `A provenance question about the attached file — running ${steps.length} skill(s) over its own metadata and content hashes instead of a stock search.`
          : `Asked for ${intent.kinds.join(" + ")} on “${intent.topic}” — running ${steps.length} retrieval skill(s) and nothing else. ${
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

  // A plain question about the world is answered from the encyclopaedia rather
  // than being forced through an identifier sweep that has nothing to sweep.
  const knowledgeAsk =
    KNOWLEDGE_ASK.test(message) && hardTargets.length === 0 && intent.kinds.length === 0;
  if (knowledgeAsk) {
    const entry = getSkill("encyclopedia");
    if (entry) {
      addStep(entry, retrievalTarget(intent.topic || message));
    }
  }

  // Keyword-driven additions: the analyst asked for something specific.
  for (const skill of knowledgeAsk ? [] : skillsMatchingText(message)) {
    if (RETRIEVAL_SKILL_IDS.has(skill.id)) {
      // Retrieval skills are planned from detected intent, with a cleaned query.
      continue;
    }
    if (
      skill.id === "encyclopedia" &&
      steps.some((step) => step.skillId === "encyclopedia")
    ) {
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

  // Background reporting: standard mode adds it around a target, deep always does.
  // The news toggle applies here because the analyst did not explicitly ask for it.
  if ((wantsDeep || focus === "standard") && hardTargets.length > 0) {
    const reporting = getSkill("news-search");
    if (reporting && (wantsDeep || preferences.media.news)) {
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
    const entry = getSkill("encyclopedia");
    if (entry && !/^\s*$/.test(message)) {
      addStep(entry, retrievalTarget(intent.topic || message));
    }
    const fallback = getSkill("text-intelligence");
    if (fallback) {
      addStep(fallback, targetLike(message));
    }
    if (/[A-Za-z0-9_+/=-]{16,}/.test(message)) {
      const reference = getSkill("reference-lab");
      if (reference) {
        addStep(reference, targetLike(message));
      }
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
