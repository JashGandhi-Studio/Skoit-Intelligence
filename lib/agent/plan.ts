import { detectCountryStatement } from "@/lib/news-editions";
import { detectPlaceInText } from "@/lib/news-places";
import { getSkill, skillsMatchingText } from "@/lib/skills";
import { parseCurrencyAsk, parseDefineAsk } from "@/lib/skills/everyday";
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
import { truncate } from "@/lib/utils";

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
  /** A structured web task the open-web skill should perform. */
  webTask?: "papers" | "study" | "sites" | "offers" | "summarize";
  /** True when the ask is a forward to trace. */
  forwardCheck?: boolean;
  /** True when a bill photo is attached for scanning. */
  receiptScan?: boolean;
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
  /\b(please|pls|kindly|okay|can you|could you|would you|i want|i need|i would like|give me|gimme|show me|find me|get me|fetch me|search for|search|look for|look up|pull up|tell me about|tell me|download|free|reusable|royalty[\s-]?free|licen[cs]e[\s-]?free|licen[cs]ed|unlimited|no copyright|copyright free|creative commons|cc0|public domain|full|complete|file|files|song|songs|music|audio|mp3|track|tracks|tune|tunes|play|playback|listen|streaming|b[\s-]?roll|broll|stock|clips?|footage|videos?|images?|photos?|pictures?|pics?|wallpapers?|posters?|illustrations?|graphics?|articles?|blogs?|news|latest|headlines?|breaking|exhaustive|sweep|everything|about|regarding|related to|for|of|on|some|any|the|a|an|chahiye|chaiye|dikhao|dikha|do|de|dedo|la|bhej|mujhe|mujhko|batao|bata|dekhna|dekhni|chahta|chahti|kuch|koi|bare|baare|mein|ki|ka|ke|hai|hain|kya|liye|wala|wali|aap|aapko|sakte|sakta|sakti|ho|hun|hu|kar|karke|karo|suno|sunao|sunna|gaana|gana|geet|sangeet|dhun|bajao|na|ek|this|these|those|is|was|are|were|it|its|that|shown|above|below|attached|who is|who was|who are|what is|what was|what are|where is|when was|meaning of|definition of|history of|information on|about|me|my|mine|us|our|link|links|and|or|if|but|to|use|usable|reuse|reusable|commercial|attribution|permission)\b/gi;

/**
 * Devanagari request words. JS \b does not treat Devanagari as word characters,
 * so these are stripped without word boundaries, longest first.
 */
const DEVANAGARI_NOISE =
  /(?<![\u0900-\u097F])(?:के बारे में|बारे में|दिखाओ|दिखाइए|दिखा दो|चाहिए|चाहिये|कीजिए|मुझे|तस्वीरें|तस्वीर|फ़ोटो|फोटो|चित्रों|चित्र|वीडियो|वीडिओ|बी-रोल|बीरोल|फुटेज|क्लिप|खबरें|खबर|समाचार|ताज़ा|लेख|रिपोर्ट|गाना|गाने|संगीत|धुन|सुनाओ|सुनो|ऑडियो|बजाओ|अच्छा|अच्छी|कोई|कुछ|की|का|के|पर|में|और|है|हैं)(?![\u0900-\u097F])/g;

/**
 * Structured web asks: these route to the open-web skill in a specific mode —
 * exam papers (PDF-first), study material, website discovery, price hunting —
 * rather than the generic retrieval chain.
 */
const PAPERS_PATTERN =
  /\b(?:specimen|sample|model|question|previous(?:\s+year)?|board|practice|guess)\s+papers?\b|\bpyqs?\b|\bpaper of\b/i;
const STUDY_PATTERN =
  /\bstudy material\b|\b(?:chapter|exam|class|subject)\s+notes\b|\bnotes\s+(?:for|of|on)\b|\brevision notes\b|\bworksheets?\b|\bsyllabus\b/i;
const SITES_PATTERN =
  /\b(?:websites?|web ?sites?|web ?apps?|sites?|portals?)\b|\bfind\s+(?:me\s+)?(?:good|best|free|new|top)?\s*(?:websites?|sites?)/i;
const OFFERS_PATTERN =
  /\b(?:price|prices|cheaper|cheapest|lowest(?:\s+price)?|compare|comparison|deals?|offers?|discount|buy)\b/i;
export const SUMMARIZE_PATTERN =
  /\b(?:summarise|summarize|summing up|tl;?dr|key points of)\b|\bread\s+(?:this|the)?\s*(?:article|link|page|url)\b/i;
export const FORWARD_PATTERN =
  /\b(?:before\s+you\s+forward|check\s+this\s+forward|fact\s?-?check(?:\s+this)?|is\s+this\s+(?:true|real|fake|correct)|fake\s+news|whatsapp\s+forward|forwarded\s+as\s+received|is\s+forward)\b/i;
export const RECEIPT_PATTERN =
  /\b(?:receipt|shop\s+bill|scan\s+(?:the\s+)?bill|scan\s+(?:the\s+)?receipt|check\s+(?:the\s+)?(?:bill|receipt|gst)|gstin)\b/i;

export function detectWebTask(message: string): AnswerIntent["webTask"] | undefined {
  if (PAPERS_PATTERN.test(message)) {
    return "papers";
  }
  if (OFFERS_PATTERN.test(message)) {
    return "offers";
  }
  if (STUDY_PATTERN.test(message)) {
    return "study";
  }
  if (SITES_PATTERN.test(message)) {
    return "sites";
  }
  return undefined;
}

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
    .replace(/[—–]/g, " ")
    .replace(/\s-\s/g, " ")
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

  return {
    kinds,
    topic,
    explicit,
    wantsVideo,
    webTask: detectWebTask(message),
    forwardCheck: FORWARD_PATTERN.test(message),
    receiptScan: RECEIPT_PATTERN.test(message),
  };
}

const TYPO_KEYWORDS =
  /(typo|lookalike|look-alike|phish|spoof|fake|impersonat|clone|squat|brand)/i;
const SEARCH_KEYWORDS =
  /(news|search|google|find|mention|press|article|reported|coverage)/i;
const FULL_SWEEP =
  /\b(?:full\s+sweep|deep\s+sweep|sweep\s+everything|all\s+skills|run\s+everything|everything\s+you\s+(?:have|got)|exhaustive\s+(?:check|sweep|search|scan))\b/i;

const RETRIEVAL_SKILL_IDS = new Set([
  "image-search",
  "video-search",
  "video-youtube",
  "audio-search",
  "music-saavn",
  "news-search",
  "news-google",
  "open-web",
  "article-reader",
  "image-provenance",
]);

/** A retrieval ask can legitimately run more than one skill — a video ask
 * plays from YouTube *and* still searches licence-clear footage libraries. */
const RETRIEVAL_SKILLS_FOR: Record<RetrievalKind, string[]> = {
  image: ["image-search"],
  video: ["video-youtube", "video-search"],
  audio: ["music-saavn", "audio-search"],
  news: ["news-google"],
  article: ["open-web", "news-google"],
};

export type SmallTalkMood = "greet" | "thanks" | "capability";

/* --------------------------------------------------------------- context -- */

/**
 * Follow-up asks — "what about 2027?", "the latest one", "hindi mein" — only
 * make sense against what was asked before. The planner therefore resolves a
 * short continuation against the previous question in this case, so the same
 * retrieval chain runs over the *merged* subject instead of searching for the
 * bare word "2027".
 */
const CONTINUATION_CUES =
  /^(?:\s*(?:and|also|plus|or)\s+|\s*what\s+about\s+|\s*how\s+about\s+|\s*what\s+of\s+|\s*ab\s+)/i;
const FRAGMENT_ONLY =
  /^(?:what\s+about|how\s+about|what\s+of|and|also|the|a|an|latest|newest|recent|new|old|older|previous|previous one|next|same|again|more|some more|another|hindi|english|marathi|tamil|telugu|bengali|kannada|malayalam|gujarati|punjabi|urdu|solutions?|with\s+solutions?|answer\s+key|pdf|in\s+pdf|hindi\s+mein|in\s+hindi)\b[\s\S]{0,40}$/i;
const YEAR_FRAGMENT =
  /^(?:what\s+about\s+|how\s+about\s+|for\s+)?(?:the\s+)?(?:latest\s+|newest\s+|new\s+|fresh\s+)?(?:19|20)\d{2}\s*(?:s\b|board)?\b.{0,30}$/i;
const SHORT_QUALIFIER = /^(?:19|20)\d{2}\b/i;

/** The most recent user ask in the conversation, if any. */
function previousUserAsk(
  history: AgentRequest["history"],
): { question: string; topic: string } | undefined {
  const turns = history ?? [];
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const entry = turns[index];
    if (entry.role === "user" && entry.content.trim().length >= 6) {
      const question = entry.content.trim().slice(0, 300);
      return { question, topic: cleanTopic(question) };
    }
  }
  return undefined;
}

/**
 * Detects a follow-up fragment and merges it with the previous question.
 * Guarded carefully: a self-contained short ask ("latest news", "411001") must
 * never be swallowed by the previous topic.
 */
export function resolveContinuation(
  message: string,
  history: AgentRequest["history"],
): { message: string; continuedFrom?: string } {
  const trimmed = message.trim();
  if (trimmed.length === 0 || trimmed.length > 80) {
    return { message };
  }
  const previous = previousUserAsk(history);
  if (!previous || previous.topic.length < 4) {
    return { message };
  }

  const stripped = trimmed
    .replace(CONTINUATION_CUES, "")
    .replace(/[\s?.!]+$/, "")
    .trim();
  if (stripped.length === 0 || stripped.length > 60) {
    return { message };
  }

  const bareWords = stripped.split(/\s+/);
  const selfContained =
    /\b(news|song|gaana|video|image|photo|tasveer|headlines?|samachar|khabar|domain|ip|email|phone|plate|pin|hash)\b/i.test(
      stripped,
    ) || detectTargets(stripped).some((target) => target.kind !== "text");
  // A short ask naming its own medium or a hard target stands on its own.
  if (selfContained && !YEAR_FRAGMENT.test(stripped) && !FRAGMENT_ONLY.test(stripped)) {
    return { message };
  }

  const isFragment =
    YEAR_FRAGMENT.test(stripped) ||
    FRAGMENT_ONLY.test(stripped) ||
    SHORT_QUALIFIER.test(stripped) ||
    (bareWords.length <= 4 && CONTINUATION_CUES.test(trimmed));
  if (!isFragment) {
    return { message };
  }

  const merged = `${previous.topic} ${stripped}`.replace(/\s+/g, " ").trim();
  return { message: merged, continuedFrom: previous.question };
}

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
  /** Set when a news ask needs the country question answered first. */
  countryAsk?: boolean;
}

export function buildPlan(request: AgentRequest): Plan {
  const rawMessage = request.message ?? "";
  const resolved = resolveContinuation(rawMessage, request.history);
  const plan = planFromMessage(request, resolved);
  if (resolved.continuedFrom) {
    // Say plainly that this run continued the previous ask, so the analyst
    // can see why the results cover the wider subject.
    plan.rationale = `Follow-up on “${truncate(resolved.continuedFrom, 70)}” — your short ask was merged with that subject and searched together. ${plan.rationale}`;
  }
  return plan;
}

function planFromMessage(
  request: AgentRequest,
  resolved: { message: string; continuedFrom?: string },
): Plan {
  const message = resolved.message;
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

  const addRetrieval = (
    kind: RetrievalKind,
    topic = intent.topic,
    extra: Record<string, string> = {},
  ) => {
    for (const skillId of RETRIEVAL_SKILLS_FOR[kind]) {
      const skill = getSkill(skillId);
      if (skill) {
        addStep(skill, retrievalTarget(topic, extra));
      }
    }
  };

  // News is remembered per country: the console asks once, stores the answer,
  // and every later news ask uses it. "News from Japan" states a country and
  // updates the stored one at the same time.
  const placeMention = detectPlaceInText(message);
  const countryStatement = detectCountryStatement(message);
  const countryMention = placeMention
    ? { code: placeMention.place.country }
    : countryStatement;
  const storedCountry =
    preferences.country ?? preferences.region?.toLowerCase() ?? undefined;
  // No country stored yet? The console starts from the India edition (this
  // console is India-first) instead of blocking the ask behind a question —
  // the scope row in the answer says how to switch.
  const newsCountry = countryMention?.code ?? storedCountry ?? "in";

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

  // (A news ask never blocks on a country question anymore: with nothing
  // stored the India edition is used and the answer says how to switch.)

  // A forward pasted for checking is the whole job: trace it, nothing else.
  const forwardAsk = intent.forwardCheck && message.trim().length >= 40;
  if (forwardAsk) {
    const checker = getSkill("forward-check");
    if (checker) {
      addStep(checker, targetLike(message));
      return {
        targets,
        steps,
        rationale:
          "A forward to trace: the chain noise is stripped, the claim is searched across the open web, fact-checkers are consulted, and the verdict — forward, hold, or don't — is shown with the receipts.",
        mode: "focused",
        intent,
      };
    }
  }

  // Everyday asks — EMI/SIP/GST math, currency, meanings, holidays — are
  // single-skill jobs: the moment the phrasing matches, run exactly that and
  // return, so no web sweep ever buries a simple arithmetic answer.
  if (hardTargets.length === 0 && intent.webTask === undefined) {
    const everyday = everydaySkillFor(message);
    if (everyday) {
      const skill = getSkill(everyday);
      if (skill) {
        addStep(skill, targetLike(message));
        return {
          targets,
          steps,
          rationale:
            "An everyday calculation or lookup: one focused skill answers it on the spot — no web sweep needed.",
          mode: "focused",
          intent,
        };
      }
    }
  }

  const retrievalOnly = intent.kinds.length > 0 && hardTargets.length === 0;

  // A company-filings ask goes straight to the regulator's own index. Checked
  // before the retrieval branch so wording like "10-K", "8-K" or "annual
  // report" is never captured by a generic article/news search instead.
  const filingsAsk =
    /\b(?:sec|edgar|filings?)\b|\b1[03]-?[kq]\b|\b[68]-?k\b|\b20-?f\b|\bdef\s*14a\b|\bproxy statement\b|\b(?:annual|quarterly)\s+report\b/i.test(
      message,
    ) && hardTargets.length === 0;
  if (filingsAsk) {
    const skill = getSkill("public-filings");
    if (skill) {
      const company =
        (intent.topic || message)
          .replace(
            /\b(?:sec|edgar|filings?|10-?k|10-?q|8-?k|20-?f|6-?k|13-?[fd]|def\s*14a|annual|report|quarterly|proxy|statement|show|me|of|for|the|latest)\b/gi,
            " ",
          )
          .replace(/\s+/g, " ")
          .trim() || intent.topic || message;
      addStep(skill, {
        ...targetLike(message),
        meta: { query: company.slice(0, 120) },
      });
      return {
        targets,
        steps,
        rationale: `A company-filings question: the U.S. SEC's own EDGAR full-text index is searched for “${company.slice(0, 60)}” — form type, filing date and a direct link to each document. Only companies registered with the SEC appear; private and non-U.S. companies will not.`,
        mode: "focused",
        intent,
      };
    }
  }


  const provenanceAsk = PROVENANCE_KEYWORDS.test(message);

  if (retrievalOnly) {
    // A price ask with no link: hunt the product across stores by name.
    if (intent.webTask === "offers") {
      const openWeb = getSkill("open-web");
      if (openWeb) {
        addStep(openWeb, retrievalTarget(intent.topic || message, { webTask: "offers" }));
      }
      return {
        targets,
        steps,
        rationale:
          "A price question — the open web is searched for this product on the stores that carry it, so the prices can be compared side by side.",
        mode: "focused",
        intent,
      };
    }

    // Structured web tasks replace the generic chain: the ask is a *search
    // job* with a known shape, so the open-web skill runs in that mode.
    const structuredTask =
      intent.webTask === "papers" ||
      intent.webTask === "study" ||
      intent.webTask === "sites"
        ? intent.webTask
        : undefined;
    if (structuredTask) {
      const openWeb = getSkill("open-web");
      if (openWeb) {
        addStep(
          openWeb,
          retrievalTarget(intent.topic || message, { webTask: structuredTask }),
        );
      }
      if (structuredTask === "papers" || structuredTask === "study") {
        const wiki = getSkill("encyclopedia");
        if (wiki && focus !== "focused") {
          addStep(wiki, retrievalTarget(intent.topic || message));
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
        rationale: `A ${structuredTask === "papers" ? "exam-paper" : structuredTask === "study" ? "study-material" : "website-discovery"} search on “${intent.topic || message}” — the open web is searched directly${structuredTask === "papers" ? ", direct PDF links first" : ""}, and every result opens or downloads in-app.`,
        mode,
        intent,
      };
    }

    // The analyst asked for a thing to be found, not for a dossier. Answer that.
    for (const kind of intent.kinds) {
      // "Is this photo original?" is a question about the attached image, not a
      // request for fresh stock photos — the provenance skill answers it.
      if (kind === "image" && attachments.length > 0 && provenanceAsk) {
        continue;
      }
      addRetrieval(
        kind,
        intent.topic,
        kind === "news" || kind === "article"
          ? {
              country: newsCountry ?? "",
              ...(placeMention ? { place: placeMention.matched } : {}),
            }
          : {},
      );
    }

    // A link was handed over with a summarise ask: read it, don't search it.
    const urlForReading = targets.find((target) => target.kind === "url");
    if (urlForReading && SUMMARIZE_PATTERN.test(message)) {
      const reader = getSkill("article-reader");
      if (reader) {
        addStep(reader, urlForReading);
      }
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

  // A product link (or product ask) with price intent: hunt offers across
  // stores instead of treating the link as a security target to dissect.
  const offersAsk =
    intent.webTask === "offers" ||
    (OFFERS_PATTERN.test(message) && targets.some((target) => target.kind === "url"));
  if (offersAsk) {
    const openWeb = getSkill("open-web");
    const productTarget =
      targets.find((target) => target.kind === "url") ??
      targetLike(intent.topic || message);
    if (openWeb) {
      addStep(openWeb, {
        ...productTarget,
        meta: {
          ...(productTarget.meta ?? {}),
          webTask: "offers",
          query: intent.topic || productTarget.value,
        },
      });
      const mode: Plan["mode"] = "focused";
      return {
        targets,
        steps,
        rationale:
          "A price question about a product — the product is identified (its page is read when a link was given), then the open web is searched for the same product on other stores so prices can be compared side by side.",
        mode,
        intent,
      };
    }
  }

  // A summarise ask over a pasted link: read it, then answer from its text.
  const summarizeTarget = targets.find((target) => target.kind === "url");
  // A link handed over with a summarise/read ask is *the* subject — reading it
  // beats searching around it, whatever else the phrasing mentions.
  if (summarizeTarget && SUMMARIZE_PATTERN.test(message)) {
    const reader = getSkill("article-reader");
    if (reader) {
      addStep(reader, summarizeTarget);
      return {
        targets,
        steps,
        rationale:
          "The link was handed over to be read — the article text is pulled out of the page, key points extracted, and nothing else is run.",
        mode: "focused",
        intent,
      };
    }
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
    addRetrieval(
      kind,
      hardTargets[0]?.value ?? intent.topic,
      kind === "news" || kind === "article"
        ? {
            country: newsCountry ?? "",
            ...(placeMention ? { place: placeMention.matched } : {}),
          }
        : {},
    );
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
    if (intent.receiptScan) {
      const scanner = getSkill("receipt-scan");
      if (scanner) {
        addStep(scanner, {
          kind: "text",
          value: attachments.map((item) => item.name).join(", "),
          raw: message || "receipt",
          confidence: "confirmed",
          meta: { attachments: JSON.stringify(attachments) },
        });
      }
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

/**
 * Everyday single-skill routing. Patterns are deliberately tight so they
 * never hijack a news/search/retrieval ask.
 */
export function everydaySkillFor(message: string): string | null {
  const text = message.toLowerCase();
  const hasFigure = /\d/.test(text);
  if (/\bemi\b|instal?lments?\b|\bloan\b/.test(text) && hasFigure) {
    return "calc-emi";
  }
  if (/\bsip\b|monthly invest|mutual fund/.test(text) && hasFigure) {
    return "calc-sip";
  }
  if (/\bgst\b/.test(text) && hasFigure && !/[0-9a-z]{15}/i.test(message)) {
    // 15+ alphanumerics present → a GSTIN verify, not GST arithmetic.
    return "calc-gst";
  }
  if (parseCurrencyAsk(message)) {
    return "currency-convert";
  }
  if (parseDefineAsk(message)) {
    return "word-define";
  }
  if (/\bholidays?\b|bank holiday|public holiday/.test(text)) {
    return "holiday-list";
  }
  return null;
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
