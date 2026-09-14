import { runAnalysis } from "@/lib/agent/run";
import {
  type AnalysisBundle,
  assessRisk,
  buildModelPrompt,
  isRetrievalAsk,
  PLAIN_INSTRUCTIONS,
  RETRIEVAL_INSTRUCTIONS,
  SYNTHESIS_INSTRUCTIONS,
} from "@/lib/agent/synthesize";
import { sanitizePreferences } from "@/lib/preferences";
import { readAnswerPreferences } from "@/lib/server/config";
import { generateBriefing, resolveModel } from "@/lib/server/provider";
import type { AgentEvent, AgentRequest, AttachmentPayload, Evidence } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const EGRESS_PROBE_URL = "https://api.github.com/rate_limit";

async function probeEgress(signal: AbortSignal): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  signal.addEventListener("abort", () => controller.abort(), { once: true });
  try {
    const response = await fetch(EGRESS_PROBE_URL, {
      signal: controller.signal,
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function parseAttachments(value: unknown): AttachmentPayload[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.slice(0, 6).map((raw) => {
    const item = (raw ?? {}) as Partial<AttachmentPayload>;
    const lat = item.coordinates?.lat;
    const lon = item.coordinates?.lon;
    return {
      name: String(item.name ?? "file").slice(0, 200),
      type: item.type ? String(item.type).slice(0, 120) : undefined,
      sizeBytes: typeof item.sizeBytes === "number" ? item.sizeBytes : undefined,
      sha256: item.sha256 ? String(item.sha256).slice(0, 128) : undefined,
      md5: item.md5 ? String(item.md5).slice(0, 64) : undefined,
      entropyBits: typeof item.entropyBits === "number" ? item.entropyBits : undefined,
      hasExif: Boolean(item.hasExif),
      exif: item.exif && typeof item.exif === "object" ? item.exif : undefined,
      exifErrors: Array.isArray(item.exifErrors)
        ? item.exifErrors.slice(0, 6).map(String)
        : undefined,
      textPreview: item.textPreview ? String(item.textPreview).slice(0, 4000) : undefined,
      perceptual:
        item.perceptual &&
        typeof item.perceptual.ahash === "string" &&
        typeof item.perceptual.dhash === "string"
          ? {
              ahash: String(item.perceptual.ahash).slice(0, 64),
              dhash: String(item.perceptual.dhash).slice(0, 64),
              width: Number(item.perceptual.width) || 0,
              height: Number(item.perceptual.height) || 0,
            }
          : undefined,
      coordinates:
        typeof lat === "number" && typeof lon === "number" ? { lat, lon } : undefined,
      document: item.document
        ? {
            format: String(item.document.format ?? "unknown").slice(0, 80),
            pages:
              typeof item.document.pages === "number" ? item.document.pages : undefined,
            producer: item.document.producer
              ? String(item.document.producer).slice(0, 200)
              : undefined,
            creator: item.document.creator
              ? String(item.document.creator).slice(0, 200)
              : undefined,
            title: item.document.title
              ? String(item.document.title).slice(0, 200)
              : undefined,
            author: item.document.author
              ? String(item.document.author).slice(0, 200)
              : undefined,
            createdAt: item.document.createdAt
              ? String(item.document.createdAt).slice(0, 40)
              : undefined,
            modifiedAt: item.document.modifiedAt
              ? String(item.document.modifiedAt).slice(0, 40)
              : undefined,
            encrypted: Boolean(item.document.encrypted),
            signed: Boolean(item.document.signed),
            scripting: Boolean(item.document.scripting),
            embeddedFiles:
              typeof item.document.embeddedFiles === "number"
                ? item.document.embeddedFiles
                : undefined,
            incrementalUpdates:
              typeof item.document.incrementalUpdates === "number"
                ? item.document.incrementalUpdates
                : undefined,
            notes: Array.isArray(item.document.notes)
              ? item.document.notes.slice(0, 8).map((note) => String(note).slice(0, 400))
              : undefined,
          }
        : undefined,
      summary: String(item.summary ?? "").slice(0, 2000),
      evidence: Array.isArray(item.evidence)
        ? (item.evidence as Evidence[]).slice(0, 60)
        : [],
    };
  });
}

function parseBody(raw: unknown): AgentRequest {
  const body = (raw ?? {}) as Partial<AgentRequest>;
  return {
    message: typeof body.message === "string" ? body.message.slice(0, 4000) : "",
    history: Array.isArray(body.history) ? body.history.slice(-6) : [],
    skillIds: Array.isArray(body.skillIds)
      ? body.skillIds.filter((id) => typeof id === "string").slice(0, 40)
      : undefined,
    language: typeof body.language === "string" ? body.language.slice(0, 12) : undefined,
    attachments: parseAttachments(body.attachments),
    preferences: body.preferences ? sanitizePreferences(body.preferences) : undefined,
  };
}

export async function POST(request: Request): Promise<Response> {
  let parsed: AgentRequest;
  try {
    parsed = parseBody(await request.json());
  } catch {
    return Response.json({ error: "Malformed request body." }, { status: 400 });
  }

  if (!parsed.message.trim()) {
    return Response.json({ error: "A question or target is required." }, { status: 400 });
  }

  // The browser pass and the server pass must plan from the same settings: a
  // request without explicit preferences inherits what Settings stored.
  parsed.preferences = parsed.preferences ?? (await readAnswerPreferences());

  const encoder = new TextEncoder();
  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort(), { once: true });

  const egress = await probeEgress(abort.signal);
  // "Built-in writer only" means exactly that: no model call, no evidence sent
  // anywhere, the deterministic write-up renders the collected evidence.
  const resolved = parsed.preferences?.ai === "off" ? null : await resolveModel();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AgentEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          /* client went away */
        }
      };

      try {
        if (!egress) {
          send({
            type: "notice",
            level: "warn",
            message:
              "This runtime has no general internet egress, so server-side sources cannot be reached. The browser-side collection path will still run where the browser itself has a network route.",
          });
        }

        await runAnalysis({
          request: parsed,
          ctx: {
            fetch,
            signal: abort.signal,
            egress,
            log: (message) => send({ type: "notice", level: "info", message }),
            env: (key) => process.env[key],
          },
          onEvent: send,
          synthesize: resolved
            ? async (bundle: AnalysisBundle) => {
                const text = await generateBriefing(
                  resolved,
                  isRetrievalAsk(bundle)
                    ? RETRIEVAL_INSTRUCTIONS
                    : parsed.preferences?.answerStyle === "analyst"
                      ? SYNTHESIS_INSTRUCTIONS
                      : PLAIN_INSTRUCTIONS,
                  buildModelPrompt(bundle, assessRisk(bundle)),
                  abort.signal,
                );
                return { text, mode: "model" as const, model: resolved.label };
              }
            : undefined,
        });
      } catch (error) {
        send({
          type: "notice",
          level: "error",
          message: error instanceof Error ? error.message : "Unknown runner failure.",
        });
        send({
          type: "turn:done",
          turnId: "failed",
          finishedAt: Date.now(),
          stats: { steps: 0, evidence: 0, entities: 0, sources: 0 },
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-skoit-egress": String(egress),
      "x-skoit-model": resolved?.label ?? "none",
    },
  });
}
