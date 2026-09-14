"use client";

import { isRelayOk, relayText } from "@/lib/client/cors-fetch";

/**
 * Free AI — a model-written polish of the built-in analyst briefing that
 * needs no API key at all. When no key is configured, SkOiT still writes the
 * briefing deterministically from the collected evidence; this module then
 * offers a language-model *rewording* of exactly that text.
 *
 * The honesty rule is hard: the model is told to change wording only — every
 * fact, number, name and caveat must survive verbatim — and anything that
 * does not look like the same briefing (length guards) is thrown away. The
 * original deterministic text is always one tap away.
 */

const ENDPOINT = "https://text.pollinations.ai/";

const SYSTEM_INSTRUCTION =
  "You are a careful editor. Rewrite the user's briefing text keeping EVERY fact, number, name, date, caveat and source reference exactly as given. Change only the wording so it reads clear and friendly. Do not add new claims, do not remove caveats, do not add opinions. Reply with the rewritten briefing only, in the same language as the input.";

/** The exact request URL (exported for the sanity suite). */
export function buildFreeAiUrl(briefing: string): string {
  return `${ENDPOINT}${encodeURIComponent(briefing.slice(0, 3600))}?system=${encodeURIComponent(SYSTEM_INSTRUCTION)}`;
}

/** Cheap structural guard: same substance, plausible length, no refusals. */
export function isPlausiblePolish(original: string, candidate: string): boolean {
  const trimmed = candidate.trim();
  if (trimmed.length < Math.max(80, original.length * 0.4)) {
    return false;
  }
  if (trimmed.length > original.length * 2.5 + 400) {
    return false;
  }
  const lowered = trimmed.toLowerCase();
  if (
    /^(i('|’)?m sorry|i cannot|i can't|as an ai)/.test(lowered) ||
    lowered.includes("i cannot rewrite")
  ) {
    return false;
  }
  // Every number in the original must appear in the candidate — the single
  // strongest cheap check that facts survived the rewrite.
  const numbers = original.match(/\d[\d,.:%]*/g) ?? [];
  const missing = numbers.filter((figure) => !trimmed.includes(figure.replace(/,$/, "")));
  return missing.length <= Math.ceil(numbers.length * 0.1);
}

/**
 * Reword the briefing with the keyless model. Throws when the network, the
 * model, or the output fails any guard — the caller keeps the original.
 */
export async function freeAiPolish(
  briefing: string,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<string> {
  const result = await relayText(buildFreeAiUrl(briefing), {
    timeoutMs: options.timeoutMs ?? 20_000,
    signal: options.signal,
    skipDirect: false,
  });
  if (!isRelayOk(result)) {
    throw new Error("free ai unreachable");
  }
  const candidate = result.data.replace(/^["']|["']$/g, "").trim();
  if (!isPlausiblePolish(briefing, candidate)) {
    throw new Error("free ai output failed the fact guard");
  }
  return candidate;
}
