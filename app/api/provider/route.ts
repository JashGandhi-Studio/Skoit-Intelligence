import { NextResponse } from "next/server";
import { runtimeEnv, setPreferences } from "@/lib/server/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_ENDPOINTS: Record<string, string[]> = {
  compatible: [
    "http://localhost:11434/v1",
    "http://127.0.0.1:11434/v1",
    "http://localhost:1234/v1",
    "http://localhost:8000/v1",
  ],
};

export async function POST(request: Request): Promise<Response> {
  let body: { providerId?: string; endpoint?: string };
  try {
    body = (await request.json()) as { providerId?: string; endpoint?: string };
  } catch {
    return NextResponse.json({ error: "Malformed body." }, { status: 400 });
  }

  const providerId = body.providerId?.trim() ?? "";
  if (!providerId) {
    return NextResponse.json({ error: "providerId is required." }, { status: 400 });
  }

  if (providerId === "compatible") {
    const endpoint = body.endpoint?.trim() ?? "";
    const allowed = ALLOWED_ENDPOINTS.compatible;
    if (!allowed.some((prefix) => endpoint.startsWith(prefix))) {
      return NextResponse.json(
        {
          error:
            "Only loopback model endpoints are accepted here, to prevent using the console as a proxy into arbitrary internal networks.",
          allowed,
        },
        { status: 400 },
      );
    }
    process.env.COMPATIBLE_BASE_URL = endpoint;
    await setPreferences({ provider: providerId, endpoint });
  } else {
    await setPreferences({ provider: providerId });
  }
  const keyEnv: Record<string, string> = {
    sarvam: "SARVAM_API_KEY",
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    google: "GOOGLE_GENERATIVE_AI_API_KEY",
    compatible: "COMPATIBLE_API_KEY",
  };
  const envVar = keyEnv[providerId];
  const configured = envVar ? Boolean(await runtimeEnv(envVar)) : false;

  return NextResponse.json({
    providerId,
    configured,
    envVar,
    note: configured
      ? "Provider selected. Model-written briefings are enabled."
      : `Provider selected, but ${envVar} is not set — briefings will stay deterministic until a key is added.`,
  });
}
