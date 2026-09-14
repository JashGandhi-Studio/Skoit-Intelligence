import { NextResponse } from "next/server";
import { mergePreferences } from "@/lib/preferences";
import { readAnswerPreferences, setPreferences } from "@/lib/server/config";
import { DEFAULT_ANSWER_PREFERENCES } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Answer settings: how much the console collects, which media it searches, which
 * licences it accepts, and how many results per source. Stored next to the keys
 * so both passes (server and browser) plan from the same rules.
 */
export async function GET(): Promise<Response> {
  const preferences = await readAnswerPreferences();
  return NextResponse.json({
    preferences,
    defaults: DEFAULT_ANSWER_PREFERENCES,
    note: "Focused answers exactly what was asked; standard adds background; deep collects everything relevant. Explicit asks always override the media toggles.",
  });
}

export async function POST(request: Request): Promise<Response> {
  let body: { preferences?: unknown };
  try {
    body = (await request.json()) as { preferences?: unknown };
  } catch {
    return NextResponse.json({ error: "Malformed body." }, { status: 400 });
  }

  const current = await readAnswerPreferences();
  // The client always sends a complete object; mergePreferences still treats it
  // as a patch so a partial update can never reset fields it did not mention.
  const merged = mergePreferences(
    current,
    (body.preferences ?? {}) as Partial<typeof current>,
  );

  await setPreferences({ answer: merged });
  return NextResponse.json({ preferences: merged });
}
