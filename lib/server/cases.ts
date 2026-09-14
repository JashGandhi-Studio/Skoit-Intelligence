import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CaseFile } from "@/lib/types";
import { dataDir } from "./config";

/**
 * Case files are written to disk so a conversation survives a refresh, a
 * browser wipe and a server restart. The browser keeps a working copy for
 * instant reads; this is the durable one.
 */

const CASES_PATH = path.join(dataDir, "cases.json");

interface CaseStoreShape {
  version: 1;
  cases: CaseFile[];
}

const EMPTY: CaseStoreShape = { version: 1, cases: [] };

async function read(): Promise<CaseStoreShape> {
  try {
    const raw = await readFile(CASES_PATH, "utf8");
    const parsed = JSON.parse(raw) as CaseStoreShape;
    return { version: 1, cases: Array.isArray(parsed.cases) ? parsed.cases : [] };
  } catch {
    return { ...EMPTY };
  }
}

async function write(store: CaseStoreShape): Promise<void> {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const temp = `${CASES_PATH}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(store), { mode: 0o600 });
  await rename(temp, CASES_PATH);
}

export async function listCases(): Promise<CaseFile[]> {
  const store = await read();
  return store.cases.sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt,
  );
}

export async function upsertCase(caseFile: CaseFile): Promise<CaseFile> {
  const store = await read();
  const index = store.cases.findIndex((item) => item.id === caseFile.id);
  if (index >= 0) {
    store.cases[index] = caseFile;
  } else {
    store.cases.unshift(caseFile);
  }
  store.cases = store.cases.slice(0, 200);
  await write(store);
  return caseFile;
}

export async function deleteCase(id: string): Promise<boolean> {
  const store = await read();
  const before = store.cases.length;
  store.cases = store.cases.filter((item) => item.id !== id);
  if (store.cases.length !== before) {
    await write(store);
    return true;
  }
  return false;
}

export async function replaceAll(cases: CaseFile[]): Promise<CaseFile[]> {
  const trimmed = cases.slice(0, 200);
  await write({ version: 1, cases: trimmed });
  return trimmed;
}
