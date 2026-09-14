import { runAnalysis } from "@/lib/agent/run";
import {
  type AnalysisBundle,
  assessRisk,
  buildModelPrompt,
  SYNTHESIS_INSTRUCTIONS,
} from "@/lib/agent/synthesize";
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
      coordinates:
        typeof lat === "number" && typeof lon === "number" ? { lat, lon } : undefined,
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

  const encoder = new TextEncoder();
  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort(), { once: true });

  const egress = await probeEgress(abort.signal);
  const resolved = await resolveModel();

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
                  SYNTHESIS_INSTRUCTIONS,
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
      "x-indus-egress": String(egress),
      "x-indus-model": resolved?.label ?? "none",
    },
  });
}
