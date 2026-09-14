"use client";

import {
  type AnalysisBundle,
  buildModelPrompt,
  isRetrievalAsk,
  PLAIN_INSTRUCTIONS,
  RETRIEVAL_INSTRUCTIONS,
  SYNTHESIS_INSTRUCTIONS,
} from "@/lib/agent/synthesize";
import type { RiskAssessment } from "@/lib/types";

/**
 * The optional free model.
 *
 * When the analyst has no API key of their own, this asks Puter.js — a free,
 * keyless model endpoint that runs from the browser — to write the briefing over
 * the evidence this console already collected. Three rules hold:
 *
 *   1. It is opt-in. `ai: "off"` never loads the script at all.
 *   2. Only collected evidence and source labels are sent, never a question
 *      without the data behind it.
 *   3. If the script cannot load or the call fails, the built-in writer's answer
 *      stands and the failure is reported. Nothing is invented to fill the gap.
 */

const PUTER_SRC = "https://js.puter.com/v2/";
const LOAD_TIMEOUT_MS = 12_000;

interface PuterResponse {
  message?: { content?: string };
  text?: string;
  toString?: () => string;
}

interface PuterLike {
  ai?: {
    chat?: (
      prompt: string,
      options?: Record<string, unknown>,
    ) => Promise<PuterResponse | string>;
  };
}

declare global {
  interface Window {
    puter?: PuterLike;
  }
}

let pending: Promise<PuterLike | null> | null = null;

function loadScript(): Promise<PuterLike | null> {
  if (typeof window === "undefined") {
    return Promise.resolve(null);
  }
  if (window.puter?.ai?.chat) {
    return Promise.resolve(window.puter);
  }
  if (pending) {
    return pending;
  }

  pending = new Promise<PuterLike | null>((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${PUTER_SRC}"]`,
    );
    const timer = window.setTimeout(() => resolve(null), LOAD_TIMEOUT_MS);
    const settle = () => {
      window.clearTimeout(timer);
      resolve(window.puter?.ai?.chat ? window.puter : null);
    };

    if (existing) {
      existing.addEventListener("load", settle, { once: true });
      existing.addEventListener("error", () => resolve(null), { once: true });
      // A script already in the document may have loaded before we listened.
      window.setTimeout(settle, 300);
      return;
    }

    const script = document.createElement("script");
    script.src = PUTER_SRC;
    script.async = true;
    script.addEventListener("load", settle, { once: true });
    script.addEventListener("error", () => {
      window.clearTimeout(timer);
      resolve(null);
    });
    document.head.appendChild(script);
  }).finally(() => {
    pending = null;
  });

  return pending;
}

function textOf(response: PuterResponse | string): string | undefined {
  if (typeof response === "string") {
    return response.trim() || undefined;
  }
  const content = response?.message?.content ?? response?.text;
  if (typeof content === "string") {
    return content.trim() || undefined;
  }
  const stringified = response?.toString?.();
  return stringified && stringified !== "[object Object]"
    ? stringified.trim()
    : undefined;
}

export interface FreeModelResult {
  text?: string;
  error?: string;
}

/** Ask the free browser model to write up what was actually collected. */
export async function writeWithFreeModel(
  bundle: AnalysisBundle,
  risk: RiskAssessment,
  style: "plain" | "analyst",
  signal?: AbortSignal,
): Promise<FreeModelResult> {
  if (typeof window === "undefined") {
    return { error: "no browser context" };
  }
  if (signal?.aborted) {
    return { error: "run stopped" };
  }
  if (bundle.evidence.length === 0) {
    return { error: "nothing collected to write up" };
  }

  const puter = await loadScript();
  if (!puter?.ai?.chat) {
    return {
      error:
        "the free model script (js.puter.com) could not be loaded from this browser — it may be blocked by a network policy or an extension",
    };
  }

  const instructions = isRetrievalAsk(bundle)
    ? RETRIEVAL_INSTRUCTIONS
    : style === "analyst"
      ? SYNTHESIS_INSTRUCTIONS
      : PLAIN_INSTRUCTIONS;

  try {
    const response = await puter.ai.chat(
      `${instructions}\n\n${buildModelPrompt(bundle, risk)}`,
    );
    const text = textOf(response);
    return text ? { text } : { error: "the free model returned nothing usable" };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "the free model call failed",
    };
  }
}
