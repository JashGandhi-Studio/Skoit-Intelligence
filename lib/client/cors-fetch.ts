/**
 * Browser-side fetch with honest fallbacks.
 *
 * SkOiT often runs where the *server* has no general internet egress (a
 * sandboxed deployment). The analyst's browser does have a route — but many of
 * the freshest sources (Google News RSS, JioSaavn, YouTube, DuckDuckGo) do not
 * send CORS headers, so a direct browser fetch is refused by the *browser*.
 *
 * This module is the single relay chain used by every new retrieval skill:
 *
 *   1. try the URL directly (works when the runtime has egress, or the source
 *      happens to send CORS headers);
 *   2. then through public CORS relays, in order, each with its own timeout;
 *   3. report which relay answered, or exactly which stage refused.
 *
 * Nothing here fabricates content: a failed chain is a failed chain, and the
 * skill that called it says so.
 */

export interface RelayOutcome<T> {
  data: T;
  via: string;
  ms: number;
}

export interface RelayFailure {
  error: string;
  tried: string[];
  ms: number;
}

export type RelayResult<T> = RelayOutcome<T> | RelayFailure;

export function isRelayOk<T>(result: RelayResult<T>): result is RelayOutcome<T> {
  return "data" in result;
}

interface Relay {
  label: string;
  wrap: (url: string) => string;
  /** relays that mangle binary bodies are excluded from byte fetches */
  binary?: boolean;
  /** relays that only handle text/html well are skipped for JSON APIs */
  textPreferred?: boolean;
}

const RELAYS: Relay[] = [
  {
    label: "allorigins",
    wrap: (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  },
  {
    label: "codetabs",
    wrap: (u) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(u)}`,
  },
  {
    label: "corsproxy",
    wrap: (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  },
  {
    label: "thingproxy",
    wrap: (u) => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
    textPreferred: true,
  },
];

const DIRECT_TIMEOUT_MS = 5_000;
const RELAY_TIMEOUT_MS = 14_000;

async function timedFetch(
  url: string,
  init: RequestInit | undefined,
  timeoutMs: number,
  outerSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  outerSignal?.addEventListener("abort", onAbort, { once: true });
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timer);
    outerSignal?.removeEventListener("abort", onAbort);
  }
}

async function readBody(response: Response): Promise<string> {
  const text = await response.text();
  // allorigins /get wraps the payload in JSON — unwrap it when it looks wrapped.
  if (text.startsWith('{"contents"')) {
    try {
      const parsed = JSON.parse(text) as { contents?: string };
      if (typeof parsed.contents === "string") {
        return parsed.contents;
      }
    } catch {
      /* not wrapped after all */
    }
  }
  return text;
}

function directHeaders(accept: string | undefined): HeadersInit | undefined {
  return accept ? { accept } : undefined;
}

/** Fetch a URL as text, direct first, then through the relay chain. */
export async function relayText(
  url: string,
  options: {
    accept?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
    /** skip the direct attempt (known CORS-refusing host, avoid the wasted call) */
    skipDirect?: boolean;
  } = {},
): Promise<RelayResult<string>> {
  const started = Date.now();
  const tried: string[] = [];
  const { accept, signal, skipDirect } = options;

  if (!skipDirect) {
    tried.push("direct");
    try {
      const response = await timedFetch(
        url,
        { headers: directHeaders(accept) },
        options.timeoutMs ?? DIRECT_TIMEOUT_MS,
        signal,
      );
      if (response.ok) {
        return {
          data: await readBody(response),
          via: "direct",
          ms: Date.now() - started,
        };
      }
    } catch {
      /* direct refused or unreachable — the chain continues */
    }
  }

  for (const relay of RELAYS) {
    tried.push(relay.label);
    try {
      const response = await timedFetch(
        relay.wrap(url),
        { headers: directHeaders(accept) },
        options.timeoutMs ?? RELAY_TIMEOUT_MS,
        signal,
      );
      if (!response.ok) {
        continue;
      }
      const body = await readBody(response);
      if (body.length === 0) {
        continue;
      }
      return { data: body, via: relay.label, ms: Date.now() - started };
    } catch {
      /* next relay */
    }
  }

  return {
    error: `no route to the source (tried ${tried.join(", ")})`,
    tried,
    ms: Date.now() - started,
  };
}

/** Fetch a JSON API through the same chain. */
export async function relayJson<T>(
  url: string,
  options: {
    headers?: Record<string, string>;
    timeoutMs?: number;
    signal?: AbortSignal;
    skipDirect?: boolean;
  } = {},
): Promise<RelayResult<T>> {
  const result = await relayText(url, {
    accept: "application/json",
    timeoutMs: options.timeoutMs,
    signal: options.signal,
    skipDirect: options.skipDirect,
  });
  if (!isRelayOk(result)) {
    return result;
  }
  const body = result.data.trim();
  if (!body.startsWith("{") && !body.startsWith("[")) {
    return {
      error: "source returned a non-JSON body",
      tried: result.via ? [result.via] : [],
      ms: result.ms,
    };
  }
  try {
    return { data: JSON.parse(body) as T, via: result.via, ms: result.ms };
  } catch {
    return {
      error: "source returned malformed JSON",
      tried: [result.via],
      ms: result.ms,
    };
  }
}

/** Fetch bytes (an image, a PDF, an audio file) — relays that pass binary through. */
export async function relayBytes(
  url: string,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<RelayResult<{ bytes: Uint8Array; mime: string }>> {
  const started = Date.now();
  const tried: string[] = [];

  tried.push("direct");
  try {
    const response = await timedFetch(
      url,
      undefined,
      options.timeoutMs ?? RELAY_TIMEOUT_MS,
      options.signal,
    );
    if (response.ok) {
      const buffer = await response.arrayBuffer();
      return {
        data: {
          bytes: new Uint8Array(buffer),
          mime: response.headers.get("content-type") ?? "",
        },
        via: "direct",
        ms: Date.now() - started,
      };
    }
  } catch {
    /* chain continues */
  }

  for (const relay of RELAYS.filter((item) => !item.textPreferred)) {
    tried.push(relay.label);
    try {
      const response = await timedFetch(
        relay.wrap(url),
        undefined,
        options.timeoutMs ?? RELAY_TIMEOUT_MS,
        options.signal,
      );
      if (!response.ok) {
        continue;
      }
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength === 0) {
        continue;
      }
      return {
        data: {
          bytes: new Uint8Array(buffer),
          mime: response.headers.get("content-type") ?? "",
        },
        via: relay.label,
        ms: Date.now() - started,
      };
    } catch {
      /* next relay */
    }
  }

  return {
    error: `no route to the file (tried ${tried.join(", ")})`,
    tried,
    ms: Date.now() - started,
  };
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 40);
  }
}
