/**
 * Core domain model for the SkOiT analyst console.
 * Everything the agent discovers is expressed as Evidence — never as prose
 * invented by the model. Prose is only ever a rendering of this data.
 */

export type TargetKind =
  | "domain"
  | "ip"
  | "email"
  | "phone"
  | "username"
  | "url"
  | "hash"
  | "crypto-address"
  | "iban"
  | "coordinate"
  | "person"
  | "organisation"
  | "address"
  | "text";

export type SkillCategory =
  | "network"
  | "infrastructure"
  | "identity"
  | "comms"
  | "media"
  | "retrieval"
  | "knowledge"
  | "tradecraft"
  | "assist";

export type SkillRuntime = "local" | "live";

export type StepStatus =
  | "queued"
  | "running"
  | "ok"
  | "partial"
  | "unreachable"
  | "blocked"
  | "error"
  | "skipped";

export type Confidence = "confirmed" | "probable" | "possible" | "unknown";

export type Severity = "info" | "low" | "medium" | "high" | "critical";

export interface SourceRef {
  id: string;
  label: string;
  url?: string;
  kind: "api" | "dns" | "registry" | "dataset" | "archive" | "local" | "document";
  accessedAt: number;
}

export interface Evidence {
  id: string;
  skillId: string;
  kind: "record" | "fact" | "metric" | "artifact" | "reference" | "warning";
  label: string;
  value: string;
  detail?: string;
  sourceId?: string;
  confidence: Confidence;
  severity?: Severity;
  raw?: unknown;
  observedAt: number;
}

export interface EntityAttribute {
  key: string;
  value: string;
}

export interface Entity {
  id: string;
  type:
    | TargetKind
    | "subdomain"
    | "certificate"
    | "asn"
    | "pincode"
    | "date"
    | "document"
    | "aircraft"
    | "company"
    | "place"
    | "technology";
  value: string;
  label: string;
  skillId: string;
  confidence: Confidence;
  attributes: EntityAttribute[];
}

export interface SkillError {
  code:
    | "timeout"
    | "egress_blocked"
    | "http_error"
    | "rate_limited"
    | "parse"
    | "requires_key"
    | "unsupported"
    | "unknown";
  message: string;
  status?: number;
}

/** A licence-clear image or video returned by a retrieval skill. */
export interface MediaItem {
  id: string;
  kind: "image" | "video" | "audio";
  title: string;
  /**
   * Direct asset URL — safe to play in the matching media element. For
   * `access: "preview"` this is a licensed short clip, not the full work.
   */
  url: string;
  /** Embeddable player URL (YouTube nocookie embeds play inside the console). */
  embedUrl?: string;
  /** True when the item precisely matched what was asked for by name. */
  exact?: boolean;
  /** Landing page that documents the asset, its author and its licence. */
  pageUrl?: string;
  thumbnailUrl?: string;
  source: string;
  sourceId?: string;
  licence?: string;
  licenceUrl?: string;
  author?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  bytes?: number;
  mime?: string;
  publishedAt?: number;
  query?: string;
  /** preview = a licensed excerpt (30s catalog clips); download = the full file. */
  access?: "download" | "preview";
  /** Album or collection the track belongs to, when the source states one. */
  collection?: string;
  /** Performer, when the source states one. */
  artist?: string;
  /** True when the playable URL is an official excerpt rather than the work. */
  previewOnly?: boolean;
  /** Where the full commercial release can be bought or streamed. */
  storeName?: string;
  storeUrl?: string;
}

/**
 * A findable article or news item. `corroborations` counts how many *distinct*
 * domains carried the same story — one domain means single-source, and that is
 * stated rather than smoothed over.
 */
export interface ArticleItem {
  id: string;
  title: string;
  url: string;
  domain: string;
  source: string;
  sourceId?: string;
  snippet?: string;
  publishedAt?: number;
  language?: string;
  country?: string;
  imageUrl?: string;
  corroborations?: number;
  corroborating?: string[];
  syndicated?: boolean;
  query?: string;
  /** Structured rendering hint: papers shelf, offers table, forward verdict. */
  shelf?: "papers" | "study" | "sites" | "offers" | "forward";
}

export interface AnswerPreferences {
  /** focused = answer exactly what was asked; deep = collect everything relevant. */
  focus: "focused" | "standard" | "deep";
  media: {
    images: boolean;
    videos: boolean;
    audio: boolean;
    articles: boolean;
    news: boolean;
  };
  /** reusable = commercial-use / public-domain style licences only. */
  licence: "any" | "reusable";
  /** Results requested per source, per pass. */
  perSource: number;
  language?: string;
  region?: string;
  /** Remembered news country — the console asks once, then keeps using it. */
  country?: string;
  /** The analyst's name, so greetings and briefings can address them. */
  userName?: string;
  /**
   * Where written briefings come from: your own keys when they exist, otherwise
   * the SkOiT Model (SkOiT Intelligence, in-browser, no key) — off keeps
   * everything deterministic.
   */
  ai?: "auto" | "off";
  /**
   * Plain answers a general reader can act on; analyst keeps the structured
   * OSINT briefing with its risk read and coverage table.
   */
  answerStyle?: "plain" | "analyst";
}

export const DEFAULT_ANSWER_PREFERENCES: AnswerPreferences = {
  focus: "focused",
  media: { images: true, videos: true, audio: true, articles: true, news: true },
  licence: "reusable",
  perSource: 8,
  ai: "auto",
  answerStyle: "plain",
};

export interface SkillOutcome {
  status: Exclude<StepStatus, "queued" | "running">;
  summary: string;
  evidence: Evidence[];
  entities: Entity[];
  sources: SourceRef[];
  error?: SkillError;
  /** Retrieval results, when the skill's job was to find something. */
  media?: MediaItem[];
  articles?: ArticleItem[];
}

export interface NetContext {
  fetch: typeof fetch;
  signal: AbortSignal;
  log: (message: string) => void;
  /** Whether the executing runtime has general internet egress. */
  egress: boolean;
  /** Read-only env lookup; empty in the browser. */
  env: (key: string) => string | undefined;
}

export interface SkillDefinition {
  id: string;
  name: string;
  short: string;
  description: string;
  category: SkillCategory;
  runtime: SkillRuntime;
  accepts: TargetKind[];
  produces: string[];
  keywords: string[];
  /** Live skills that can also execute from the browser when server egress is blocked. */
  clientFallback: boolean;
  requiresKey?: string[];
  run: (target: DetectedTarget, ctx: NetContext) => Promise<SkillOutcome>;
}

export interface DetectedTarget {
  kind: TargetKind;
  value: string;
  raw: string;
  confidence: Confidence;
  meta?: Record<string, string>;
}

export interface PlannedStep {
  id: string;
  skillId: string;
  label: string;
  targetKind: TargetKind;
  target: string;
  reason: string;
  status: StepStatus;
  /** Planner-supplied context (search query, result budget, attachments). */
  meta?: Record<string, string>;
}

export interface RiskFactor {
  label: string;
  weight: number;
  detail: string;
}

export interface RiskAssessment {
  score: number;
  band: "minimal" | "guarded" | "elevated" | "high" | "severe";
  factors: RiskFactor[];
  summary: string;
}

export type AgentEvent =
  | {
      type: "turn:start";
      turnId: string;
      mode: "model" | "analyst";
      model?: string;
      startedAt: number;
    }
  | { type: "plan"; steps: PlannedStep[]; rationale: string; targets: DetectedTarget[] }
  | {
      type: "step:start";
      stepId: string;
      skillId: string;
      label: string;
      startedAt: number;
    }
  | { type: "step:log"; stepId: string; message: string }
  | {
      type: "step:done";
      stepId: string;
      skillId: string;
      status: StepStatus;
      summary: string;
      durationMs: number;
      evidence: Evidence[];
      entities: Entity[];
      sources: SourceRef[];
      error?: SkillError;
      media?: MediaItem[];
      articles?: ArticleItem[];
    }
  | { type: "entity:found"; entities: Entity[] }
  | { type: "risk"; risk: RiskAssessment }
  | { type: "synthesis:start"; mode: "model" | "analyst"; model?: string }
  | { type: "synthesis:delta"; text: string }
  | { type: "synthesis:done"; text: string; sourceIds: string[] }
  | { type: "notice"; level: "info" | "warn" | "error"; message: string }
  | {
      type: "turn:done";
      turnId: string;
      finishedAt: number;
      stats: { steps: number; evidence: number; entities: number; sources: number };
    };

/** Container-level metadata recovered in the browser from documents (PDF, OOXML). */
export interface DocumentInfo {
  format: string;
  pages?: number;
  producer?: string;
  creator?: string;
  title?: string;
  author?: string;
  createdAt?: string;
  modifiedAt?: string;
  encrypted?: boolean;
  signed?: boolean;
  scripting?: boolean;
  embeddedFiles?: number;
  incrementalUpdates?: number;
  notes?: string[];
}

/** A file the analyst attached, already parsed in the browser (EXIF, hashes, entropy). */
export interface AttachmentInput {
  name: string;
  type?: string;
  sizeBytes?: number;
  sha256?: string;
  md5?: string;
  entropyBits?: number;
  hasExif: boolean;
  exif?: Record<string, string | number | boolean | undefined>;
  exifErrors?: string[];
  textPreview?: string;
  ocrText?: string;
  coordinates?: { lat: number; lon: number };
  document?: DocumentInfo;
  perceptual?: { ahash: string; dhash: string; width: number; height: number };
}

export interface AttachmentPayload extends AttachmentInput {
  summary: string;
  evidence: Evidence[];
}

export interface AgentRequest {
  message: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  /** Restrict execution to these skill ids; empty/undefined = planner decides. */
  skillIds?: string[];
  language?: string;
  /** Extra attachment context already parsed in the browser (EXIF, hashes). */
  attachments?: AttachmentPayload[];
  /** Effective answer settings for this run, so both passes plan identically. */
  preferences?: AnswerPreferences;
}

export interface CapabilityReport {
  runtime: string;
  egress: boolean;
  egressChecked: boolean;
  providers: Array<{ id: string; label: string; configured: boolean; envVar: string }>;
  missingKeys: string[];
  notes: string[];
  checkedAt: number;
}

export interface CaseFile {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  tags: string[];
  targets: DetectedTarget[];
  turns: CaseTurn[];
  notes: string;
}

export interface CaseTurn {
  id: string;
  question: string;
  createdAt: number;
  mode: "model" | "analyst";
  model?: string;
  steps: PlannedStep[];
  evidence: Evidence[];
  entities: Entity[];
  sources: SourceRef[];
  risk?: RiskAssessment;
  answer: string;
  durationMs: number;
  media?: MediaItem[];
  articles?: ArticleItem[];
}
