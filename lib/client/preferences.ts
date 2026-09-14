"use client";

import { mergePreferences, sanitizePreferences } from "@/lib/preferences";
import type { AnswerPreferences } from "@/lib/types";
import { DEFAULT_ANSWER_PREFERENCES } from "@/lib/types";

const STORAGE_KEY = "skoit.preferences.v1";

/**
 * The browser keeps its own copy of the answer settings so a page reload plans
 * from the same rules the console showed, even before the server answers.
 */
export function loadLocalPreferences(): AnswerPreferences {
  if (typeof window === "undefined") {
    return DEFAULT_ANSWER_PREFERENCES;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return DEFAULT_ANSWER_PREFERENCES;
    }
    return sanitizePreferences(JSON.parse(raw));
  } catch {
    return DEFAULT_ANSWER_PREFERENCES;
  }
}

export function storeLocalPreferences(preferences: AnswerPreferences): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    /* storage full or blocked — the server copy still applies */
  }
}

export function patchLocalPreferences(
  patch: Partial<AnswerPreferences>,
): AnswerPreferences {
  const next = mergePreferences(loadLocalPreferences(), patch);
  storeLocalPreferences(next);
  return next;
}

/** Server copy wins when it is newer; the local copy covers the browser pass. */
export async function fetchStoredPreferences(): Promise<AnswerPreferences | null> {
  try {
    const response = await fetch("/api/preferences");
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as { preferences?: unknown };
    if (!data.preferences) {
      return null;
    }
    const parsed = sanitizePreferences(data.preferences);
    storeLocalPreferences(parsed);
    return parsed;
  } catch {
    return null;
  }
}

export async function persistPreferences(
  preferences: AnswerPreferences,
): Promise<AnswerPreferences> {
  storeLocalPreferences(preferences);
  try {
    const response = await fetch("/api/preferences", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ preferences }),
    });
    if (response.ok) {
      const data = (await response.json()) as { preferences?: unknown };
      if (data.preferences) {
        const parsed = sanitizePreferences(data.preferences);
        storeLocalPreferences(parsed);
        return parsed;
      }
    }
  } catch {
    /* offline: the local copy stays authoritative for the browser pass */
  }
  return preferences;
}
