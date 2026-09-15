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

/**
 * Every public CORS relay the console knows, raced at once — a dead relay no
 * longer adds its full timeout to a fetch, the first live one wins. The list
 * is deliberately broad: on any given network one or two of these will answer.
 */
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
    label: "corsproxy-org",
    wrap: (u) => `https://corsproxy.org/?url=${encodeURIComponent(u)}`,
  },
  {
    label: "isomorphic",
    wrap: (u) => `https://cors.isomorphic-git.org/${u}`,
  },
  {
    label: "allorigins-json",
    wrap: (u) => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
    textPreferred: true,
  },
];

const DIRECT_TIMEOUT_MS = 4_000;
const RELAY_TIMEOUT_MS = 9_000;
const RELAY_RACE_STAGGER_MS = 250;

/**
 * True when this module runs inside Node (the API route) rather than the
 * browser. The server has its own egress — routing it through public CORS
 * relays would only add latency and a third party that can be down. Everything
 * therefore goes direct on the server; the relay chain remains a browser-only
 * device for sources that refuse cross-origin reads.
 */
const ON_SERVER = typeof window === "undefined";

/** A browser-like UA: several engines serve scrapes only to real clients. */
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

function fetchInit(init: RequestInit | undefined): RequestInit {
  const merged: RequestInit = { ...init, cache: "no-store" };
  if (ON_SERVER) {
    const headers = new Headers(init?.headers ?? {});
    if (!headers.has("user-agent")) {
      headers.set("user-agent", BROWSER_UA);
    }
    if (!headers.has("accept-language")) {
      headers.set("accept-language", "en-IN,en;q=0.9,hi;q=0.8");
    }
    merged.headers = headers;
  }
  return merged;
}

/** Resolve on the first fetch that answers ok; reject if every route fails. */
async function raceRoutes(
  routes: Array<{ label: string; url: string; timeoutMs: number; init?: RequestInit }>,
  outerSignal?: AbortSignal,
): Promise<{ label: string; response: Response }> {
  if (routes.length === 1) {
    const route = routes[0];
    return {
      label: route.label,
      response: await timedFetch(route.url, route.init, route.timeoutMs, outerSignal),
    };
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let failures = 0;
    let cancelled = false;
    const onCancel = () => {
      cancelled = true;
      reject(new Error("aborted"));
    };
    outerSignal?.addEventListener("abort", onCancel, { once: true });
    routes.forEach((route, index) => {
      const start = async () => {
        try {
          const response = await timedFetch(
            route.url,
            route.init,
            route.timeoutMs,
            outerSignal,
          );
          if (!settled) {
            if (response.ok) {
              settled = true;
              resolve({ label: route.label, response });
            } else {
              throw new Error(String(response.status));
            }
          }
        } catch {
          if (!settled && !cancelled) {
            failures += 1;
            if (failures >= routes.length) {
              settled = true;
              reject(new Error(`all ${routes.length} route(s) failed`));
            }
          }
        }
      };
      setTimeout(() => void start(), index * RELAY_RACE_STAGGER_MS);
    });
  });
}

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
    return await fetch(url, {
      ...fetchInit(init),
      signal: controller.signal,
    });
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

  // On the server there is no CORS, so a direct call is the fast path — but a
  // few engines refuse datacenter IPs outright, so on a direct refusal the
  // relay chain still gets a say before the run reports a dead source.
  // skipDirect is a browser-only economy (skip a fetch the browser would
  // refuse anyway); the server has no CORS, so direct is always worth trying.
  let skipDirectNow = Boolean(skipDirect) && !ON_SERVER;
  if (ON_SERVER) {
    tried.push("direct");
    skipDirectNow = true; // the chain below must not repeat the attempt
    try {
      const response = await timedFetch(
        url,
        { headers: directHeaders(accept) },
        Math.min(options.timeoutMs ?? 12_000, 10_000),
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
      /* direct refused or unreachable — relays are next */
    }
  }

  const routes: Array<{
    label: string;
    url: string;
    timeoutMs: number;
    init?: RequestInit;
  }> = [];
  if (!skipDirectNow) {
    tried.push("direct");
    routes.push({
      label: "direct",
      url,
      timeoutMs: options.timeoutMs ?? DIRECT_TIMEOUT_MS,
      init: { headers: directHeaders(accept) },
    });
  }
  for (const relay of RELAYS) {
    tried.push(relay.label);
    routes.push({
      label: relay.label,
      url: relay.wrap(url),
      timeoutMs: options.timeoutMs ?? RELAY_TIMEOUT_MS,
      init: { headers: directHeaders(accept) },
    });
  }

  try {
    // Every route is raced (relays slightly staggered to protect their rate
    // limits) — the first one to answer wins, so a dead relay no longer adds
    // its full timeout to every fetch.
    const winner = await raceRoutes(routes, signal);
    const body = await readBody(winner.response);
    if (body.length === 0) {
      return {
        error: `the source answered empty (via ${winner.label})`,
        tried,
        ms: Date.now() - started,
      };
    }
    return { data: body, via: winner.label, ms: Date.now() - started };
  } catch {
    return {
      error: signal?.aborted
        ? "cancelled"
        : `no route to the source (tried ${tried.join(", ")})`,
      tried,
      ms: Date.now() - started,
    };
  }
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

  // Server: direct is the fast path; the binary-safe relays stay as backup
  // for publishers that block datacenter ranges.
  if (ON_SERVER) {
    tried.push("direct");
    try {
      const response = await timedFetch(
        url,
        undefined,
        Math.min(options.timeoutMs ?? 12_000, 10_000),
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
      /* fall through to the shared relay chain */
    }
  }

  const routes: Array<{
    label: string;
    url: string;
    timeoutMs: number;
    init?: RequestInit;
  }> = ON_SERVER
    ? [] // the server already attempted direct above
    : [{ label: "direct", url, timeoutMs: options.timeoutMs ?? RELAY_TIMEOUT_MS }];

  // Images get one extra, extremely reliable route: the wsrv.nl image proxy
  // (CORS-open, binary-safe, long-lived). It only ever serves images.
  if (/\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(url) || /image/i.test(url)) {
    tried.push("wsrv");
    routes.push({
      label: "wsrv",
      url: `https://wsrv.nl/?url=${encodeURIComponent(url.replace(/^https?:\/\//, ""))}&n=-1`,
      timeoutMs: options.timeoutMs ?? RELAY_TIMEOUT_MS,
    });
  }

  for (const relay of RELAYS.filter((item) => !item.textPreferred)) {
    tried.push(relay.label);
    routes.push({
      label: relay.label,
      url: relay.wrap(url),
      timeoutMs: options.timeoutMs ?? RELAY_TIMEOUT_MS,
    });
  }

  try {
    const winner = await raceRoutes(routes, options.signal);
    const buffer = await winner.response.arrayBuffer();
    if (buffer.byteLength === 0) {
      return {
        error: `the file arrived empty (via ${winner.label})`,
        tried,
        ms: Date.now() - started,
      };
    }
    return {
      data: {
        bytes: new Uint8Array(buffer),
        mime: winner.response.headers.get("content-type") ?? "",
      },
      via: winner.label,
      ms: Date.now() - started,
    };
  } catch {
    return {
      error: `no route to the file (tried ${tried.join(", ")})`,
      tried,
      ms: Date.now() - started,
    };
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 40);
  }
}
