import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Runtime configuration store. Keys entered in the UI are persisted here with
 * owner-only permissions and are never returned to the browser — the API only
 * reports whether a key is present.
 */

const DATA_DIR = process.env.INDUS_DATA_DIR ?? path.join(os.homedir(), ".indus");
const CONFIG_PATH = path.join(DATA_DIR, "config.json");

export interface StoredConfig {
  version: 1;
  keys: Record<string, string>;
  preferences: {
    provider?: string;
    model?: string;
    endpoint?: string;
  };
  updatedAt: number;
}

const EMPTY: StoredConfig = { version: 1, keys: {}, preferences: {}, updatedAt: 0 };

let cache: StoredConfig | null = null;

export async function readConfig(): Promise<StoredConfig> {
  if (cache) {
    return cache;
  }
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

export const dataDir = DATA_DIR;
