import { NextResponse } from "next/server";
import { deleteCase, listCases, replaceAll, upsertCase } from "@/lib/server/cases";
import type { CaseFile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function valid(value: unknown): value is CaseFile {
  const candidate = value as Partial<CaseFile>;
  return Boolean(
    candidate &&
      typeof candidate.id === "string" &&
      candidate.id.length > 0 &&
      typeof candidate.title === "string" &&
      Array.isArray(candidate.turns),
  );
}

export async function GET(): Promise<Response> {
  const cases = await listCases();
  return NextResponse.json({
    cases,
    storage: "json-file",
    note: "Cases are stored on this server's own disk under the account running the console. Nothing is uploaded anywhere.",
  });
}

export async function POST(request: Request): Promise<Response> {
  let body: { case?: unknown; cases?: unknown[] };
  try {
    body = (await request.json()) as { case?: unknown; cases?: unknown[] };
  } catch {
    return NextResponse.json({ error: "Malformed body." }, { status: 400 });
  }

  if (Array.isArray(body.cases)) {
    const cases = body.cases.filter(valid);
    const saved = await replaceAll(cases);
    return NextResponse.json({ ok: true, count: saved.length });
  }

  if (!valid(body.case)) {
    return NextResponse.json(
      { error: "Case payload failed validation." },
      { status: 400 },
    );
  }

  const saved = await upsertCase(body.case);
  return NextResponse.json({ ok: true, case: saved });
}

export async function DELETE(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json(
      { error: "id query parameter is required." },
      { status: 400 },
    );
  }
  const deleted = await deleteCase(id);
  return NextResponse.json({ ok: deleted });
}
