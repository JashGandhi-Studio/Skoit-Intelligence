import type { Confidence, Entity, Evidence, Severity, SourceRef } from "@/lib/types";
import { newId } from "@/lib/utils";

export function evidence(
  skillId: string,
  label: string,
  value: string,
  options: {
    detail?: string;
    source?: SourceRef;
    confidence?: Confidence;
    severity?: Severity;
    kind?: Evidence["kind"];
    raw?: unknown;
  } = {},
): Evidence {
  return {
    id: newId("ev"),
    skillId,
    kind: options.kind ?? "record",
    label,
    value,
    detail: options.detail,
    sourceId: options.source?.id,
    confidence: options.confidence ?? "confirmed",
    severity: options.severity,
    raw: options.raw,
    observedAt: Date.now(),
  };
}

export function entity(
  skillId: string,
  type: Entity["type"],
  value: string,
  label: string,
  attributes: Array<{ key: string; value: string }> = [],
  confidence: Confidence = "confirmed",
): Entity {
  return {
    id: newId("ent"),
    type,
    value,
    label,
    skillId,
    confidence,
    attributes: attributes.filter(
      (item) => item.value !== undefined && item.value !== "",
    ),
  };
}

export function attrs(
  input: Record<string, string | number | boolean | null | undefined>,
): Array<{ key: string; value: string }> {
  return Object.entries(input)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([key, value]) => ({ key, value: String(value) }));
}
