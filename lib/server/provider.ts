import { readConfig, runtimeEnv } from "./config";

/**
 * Briefing models are called over plain HTTP. The console needs exactly one
 * capability — "given this evidence, write the briefing" — so it talks to the
 * provider APIs directly rather than pulling a model SDK into the bundle.
 */

export type ProviderKind = "openai" | "gemini" | "anthropic";

export interface ProviderCandidate {
  id: string;
  label: string;
  kind: ProviderKind;
  envVar: string;
  defaultModel: string;
  modelEnvVar: string;
  baseUrl: string;
  baseUrlEnvVar?: string;
  requiresKey: boolean;
  /** Must be explicitly configured before it is treated as available. */
  requiresOptIn?: boolean;
}

export const PROVIDERS: ProviderCandidate[] = [
  {
    id: "sarvam",
    label: "Sarvam AI (Sarvam-M)",
    kind: "openai",
    envVar: "SARVAM_API_KEY",
    defaultModel: "sarvam-m",
    modelEnvVar: "SARVAM_MODEL",
    baseUrl: "https://api.sarvam.ai/v1",
    baseUrlEnvVar: "SARVAM_BASE_URL",
    requiresKey: true,
  },
  {
    id: "openai",
    label: "OpenAI",
    kind: "openai",
    envVar: "OPENAI_API_KEY",
    defaultModel: "gpt-4.1-mini",
    modelEnvVar: "OPENAI_MODEL",
    baseUrl: "https://api.openai.com/v1",
    baseUrlEnvVar: "OPENAI_BASE_URL",
    requiresKey: true,
  },
  {
    id: "anthropic",
    label: "Anthropic",
    kind: "anthropic",
    envVar: "ANTHROPIC_API_KEY",
    defaultModel: "claude-3-5-haiku-latest",
    modelEnvVar: "ANTHROPIC_MODEL",
    baseUrl: "https://api.anthropic.com/v1",
    baseUrlEnvVar: "ANTHROPIC_BASE_URL",
    requiresKey: true,
  },
  {
    id: "google",
    label: "Google Gemini",
    kind: "gemini",
    envVar: "GOOGLE_GENERATIVE_AI_API_KEY",
    defaultModel: "gemini-2.0-flash",
    modelEnvVar: "GOOGLE_MODEL",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    baseUrlEnvVar: "GOOGLE_BASE_URL",
    requiresKey: true,
  },
  {
    id: "compatible",
    label: "Local OpenAI-compatible server",
    kind: "openai",
    envVar: "COMPATIBLE_API_KEY",
    defaultModel: "llama3.1",
    modelEnvVar: "COMPATIBLE_MODEL",
    baseUrl: "http://localhost:11434/v1",
    baseUrlEnvVar: "COMPATIBLE_BASE_URL",
    requiresKey: false,
    requiresOptIn: true,
  },
];

export interface ResolvedModel {
  providerId: string;
  providerLabel: string;
  kind: ProviderKind;
  baseUrl: string;
  apiKey: string;
  model: string;
  label: string;
}

export async function resolveModel(): Promise<ResolvedModel | null> {
  const config = await readConfig();
  const preferred =
    process.env.SKOIT_MODEL_PROVIDER ??
    process.env.INDUS_MODEL_PROVIDER ??
    config.preferences.provider;
  const ordered = preferred
    ? [
        ...PROVIDERS.filter((provider) => provider.id === preferred),
        ...PROVIDERS.filter((provider) => provider.id !== preferred),
      ]
    : PROVIDERS;

  for (const provider of ordered) {
    const apiKey = (await runtimeEnv(provider.envVar)) ?? "";
    if (provider.requiresKey && !apiKey) {
      continue;
    }
    const configuredBase = provider.baseUrlEnvVar
      ? process.env[provider.baseUrlEnvVar]
      : undefined;
    if (provider.requiresOptIn && !configuredBase) {
      continue;
    }
    const baseUrl = configuredBase ?? provider.baseUrl;
    const model =
      process.env[provider.modelEnvVar] ??
      (config.preferences.model && config.preferences.provider === provider.id
        ? config.preferences.model
        : undefined) ??
      provider.defaultModel;

    return {
      providerId: provider.id,
      providerLabel: provider.label,
      kind: provider.kind,
      baseUrl: baseUrl.replace(/\/$/, ""),
      apiKey,
      model,
      label: `${provider.label} · ${model}`,
    };
  }

  return null;
}

function isLoopback(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"].includes(
      parsed.hostname,
    );
  } catch {
    return false;
  }
}

/** One call, one purpose: turn collected evidence into the analyst briefing. */
export async function generateBriefing(
  resolved: ResolvedModel,
  system: string,
  prompt: string,
  signal: AbortSignal,
  timeoutMs = 45_000,
): Promise<string> {
  if (resolved.providerId === "compatible" && !isLoopback(resolved.baseUrl)) {
    throw new Error("Local model endpoints are restricted to loopback addresses.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  signal.addEventListener("abort", () => controller.abort(), { once: true });

  let url: string;
  let body: unknown;
  const headers: Record<string, string> = { "content-type": "application/json" };

  if (resolved.kind === "openai") {
    url = `${resolved.baseUrl}/chat/completions`;
    if (resolved.apiKey) {
      headers.authorization = `Bearer ${resolved.apiKey}`;
    }
    body = {
      model: resolved.model,
      temperature: 0.2,
      max_tokens: 1200,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
    };
  } else if (resolved.kind === "anthropic") {
    url = `${resolved.baseUrl}/messages`;
    headers["x-api-key"] = resolved.apiKey;
    headers["anthropic-version"] = "2023-06-01";
    body = {
      model: resolved.model,
      max_tokens: 1200,
      temperature: 0.2,
      system,
      messages: [{ role: "user", content: prompt }],
    };
  } else {
    url = `${resolved.baseUrl}/models/${encodeURIComponent(resolved.model)}:generateContent`;
    headers["x-goog-api-key"] = resolved.apiKey;
    body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 1200 },
    };
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw new Error(
        `${resolved.providerLabel} returned HTTP ${response.status}: ${detail}`,
      );
    }

    const payload = (await response.json()) as any;
    const text: string | undefined =
      payload?.choices?.[0]?.message?.content ??
      payload?.content?.map?.((part: { text?: string }) => part.text ?? "").join("") ??
      payload?.candidates?.[0]?.content?.parts
        ?.map?.((part: { text?: string }) => part.text ?? "")
        .join("");

    if (!text || typeof text !== "string") {
      throw new Error("Provider returned no text content.");
    }
    return text.trim();
  } finally {
    clearTimeout(timer);
  }
}

export async function providerReport(): Promise<
  Array<{ id: string; label: string; configured: boolean; envVar: string; model: string }>
> {
  const config = await readConfig();
  const rows = [];
  for (const provider of PROVIDERS) {
    const apiKey = await runtimeEnv(provider.envVar);
    const baseConfigured = Boolean(
      (provider.baseUrlEnvVar ? process.env[provider.baseUrlEnvVar] : undefined) ??
        (provider.id === "compatible" ? config.preferences.endpoint : undefined),
    );
    rows.push({
      id: provider.id,
      label: provider.label,
      configured: provider.requiresKey ? Boolean(apiKey) : baseConfigured,
      envVar: provider.envVar,
      model: process.env[provider.modelEnvVar] ?? provider.defaultModel,
    });
  }
  return rows;
}

export const KEYED_SOURCES = [
  "HIBP_API_KEY",
  "SEARCH_API_KEY",
  "OPENSANCTIONS_API_KEY",
  "VIRUSTOTAL_API_KEY",
  // Media libraries: without these the console still searches the keyless
  // Commons / Openverse / NASA / Internet Archive sources.
  "PEXELS_API_KEY",
  "PIXABAY_API_KEY",
  "UNSPLASH_ACCESS_KEY",
];

export async function sourceKeyReport() {
  const rows = [];
  for (const key of KEYED_SOURCES) {
    const value = await runtimeEnv(key);
    rows.push({ key, configured: Boolean(value) });
  }
  return rows;
}
