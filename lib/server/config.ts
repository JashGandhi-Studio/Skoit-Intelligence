import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sanitizePreferences } from "@/lib/preferences";
import type { AnswerPreferences } from "@/lib/types";
import { DEFAULT_ANSWER_PREFERENCES } from "@/lib/types";

/**
 * Runtime configuration store. Keys entered in the UI are persisted here with
 * owner-only permissions and are never returned to the browser — the API only
 * reports whether a key is present.
 */

const LEGACY_DIR = path.join(os.homedir(), ".indus");
const DATA_DIR =
  process.env.SKOIT_DATA_DIR ??
  process.env.INDUS_DATA_DIR ??
  path.join(os.homedir(), ".skoit");
const CONFIG_PATH = path.join(DATA_DIR, "config.json");

export interface StoredConfig {
  version: 1;
  keys: Record<string, string>;
  preferences: {
    provider?: string;
    model?: string;
    endpoint?: string;
    /** How much the console answers, and which media it may look for. */
    answer?: AnswerPreferences;
  };
  updatedAt: number;
}

const EMPTY: StoredConfig = { version: 1, keys: {}, preferences: {}, updatedAt: 0 };

let cache: StoredConfig | null = null;
let prepared = false;

/**
 * Carries a pre-rename data directory across the first time this version runs,
 * so keys and cases stored under ~/.indus are not silently orphaned.
 */
async function prepareDataDir(): Promise<void> {
  if (prepared) {
    return;
  }
  prepared = true;
  if (DATA_DIR === LEGACY_DIR) {
    return;
  }
  try {
    await stat(CONFIG_PATH);
    return;
  } catch {
    /* new location not written yet */
  }
  try {
    await stat(path.join(LEGACY_DIR, "config.json"));
    await rename(LEGACY_DIR, DATA_DIR);
    return;
  } catch {
    /* nothing to migrate */
  }
  try {
    await mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  } catch {
    /* created lazily on write */
  }
}

export async function readConfig(): Promise<StoredConfig> {
  if (cache) {
    return cache;
  }
  await prepareDataDir();
  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as StoredConfig;
    cache = { ...EMPTY, ...parsed, keys: parsed.keys ?? {} };
  } catch {
    cache = { ...EMPTY };
  }
  return cache;
}

export async function writeConfig(next: StoredConfig): Promise<void> {
  await prepareDataDir();
  await mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  const payload: StoredConfig = { ...next, updatedAt: Date.now() };
  const temp = `${CONFIG_PATH}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(payload, null, 2), { mode: 0o600 });
  await rename(temp, CONFIG_PATH);
  try {
    await chmod(CONFIG_PATH, 0o600);
  } catch {
    /* best effort on platforms without POSIX modes */
  }
  cache = payload;
}

export async function setKeys(
  entries: Record<string, string | null>,
): Promise<StoredConfig> {
  const config = { ...(await readConfig()) };
  const keys = { ...config.keys };
  for (const [key, value] of Object.entries(entries)) {
    if (value === null || value === "") {
      delete keys[key];
    } else {
      keys[key] = value;
    }
  }
  const next: StoredConfig = { ...config, keys };
  await writeConfig(next);
  return next;
}

export async function setPreferences(
  preferences: StoredConfig["preferences"],
): Promise<StoredConfig> {
  const config = { ...(await readConfig()) };
  const next: StoredConfig = {
    ...config,
    preferences: { ...config.preferences, ...preferences },
  };
  await writeConfig(next);
  return next;
}

/** Server-side lookup used by every skill: real env var first, stored key second. */
export async function runtimeEnv(key: string): Promise<string | undefined> {
  const fromEnv = process.env[key];
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv;
  }
  const config = await readConfig();
  const stored = config.keys[key];
  return stored && stored.trim().length > 0 ? stored : undefined;
}

export function maskKey(value: string): string {
  if (value.length <= 8) {
    return "•".repeat(value.length);
  }
  return `${value.slice(0, 4)}${"•".repeat(10)}${value.slice(-4)}`;
}

export async function keyReport(knownKeys: string[]): Promise<
  Array<{
    key: string;
    configured: boolean;
    origin: "environment" | "stored" | "none";
    masked?: string;
  }>
> {
  const config = await readConfig();
  return knownKeys.map((key) => {
    const envValue = process.env[key];
    if (envValue?.trim()) {
      return {
        key,
        configured: true,
        origin: "environment" as const,
        masked: maskKey(envValue),
      };
    }
    const stored = config.keys[key];
    if (stored?.trim()) {
      return {
        key,
        configured: true,
        origin: "stored" as const,
        masked: maskKey(stored),
      };
    }
    return { key, configured: false, origin: "none" as const };
  });
}

/** Effective answer settings: defaults folded together with whatever was stored. */
export async function readAnswerPreferences(): Promise<AnswerPreferences> {
  const config = await readConfig();
  return sanitizePreferences({
    ...DEFAULT_ANSWER_PREFERENCES,
    ...(config.preferences.answer ?? {}),
    media: {
      ...DEFAULT_ANSWER_PREFERENCES.media,
      ...(config.preferences.answer?.media ?? {}),
    },
  });
}

export const dataDir = DATA_DIR;
export { LEGACY_DIR };
