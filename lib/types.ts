/**
 * Core domain model for the INDUS analyst console.
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
  | "knowledge"
  | "tradecraft";

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
  kind: "api" | "dns" | "registry" | "dataset" | "local" | "document";
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
    | "document";
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

export interface SkillOutcome {
  status: Exclude<StepStatus, "queued" | "running">;
  summary: string;
  evidence: Evidence[];
  entities: Entity[];
  sources: SourceRef[];
  error?: SkillError;
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
  coordinates?: { lat: number; lon: number };
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
}
