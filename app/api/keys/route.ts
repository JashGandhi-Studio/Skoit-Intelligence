import { NextResponse } from "next/server";
import { keyReport, setKeys } from "@/lib/server/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_KEYS = [
  "SARVAM_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "COMPATIBLE_API_KEY",
  "HIBP_API_KEY",
  "SEARCH_API_KEY",
  "OPENSANCTIONS_API_KEY",
  "VIRUSTOTAL_API_KEY",
  "JAMENDO_CLIENT_ID",
  "PEXELS_API_KEY",
  "PIXABAY_API_KEY",
  "UNSPLASH_ACCESS_KEY",
];

export async function GET(): Promise<Response> {
  const rows = await keyReport(ALLOWED_KEYS);
  return NextResponse.json({
    keys: rows,
    note: "Keys are stored with owner-only file permissions and are never returned to the browser — only presence is reported.",
  });
}

export async function POST(request: Request): Promise<Response> {
  let body: { keys?: Record<string, string | null> };
  try {
    body = (await request.json()) as { keys?: Record<string, string | null> };
  } catch {
    return NextResponse.json({ error: "Malformed body." }, { status: 400 });
  }

  const incoming = body.keys ?? {};
  const filtered: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(incoming)) {
    if (!ALLOWED_KEYS.includes(key)) {
      continue;
    }
    filtered[key] = value === null ? null : String(value).trim().slice(0, 300);
  }

  if (Object.keys(filtered).length === 0) {
    return NextResponse.json(
      { error: "No recognised key names supplied." },
      { status: 400 },
    );
  }

  await setKeys(filtered);
  const rows = await keyReport(ALLOWED_KEYS);
  return NextResponse.json({ ok: true, keys: rows });
}
