import type { NetContext, SkillError, SourceRef } from "@/lib/types";

export const USER_AGENT =
  "INDUS-OSINT-Analyst/1.0 (+public-source research console; contact: analyst@localhost)";

const DEFAULT_TIMEOUT = 8000;

export type NetResult<T> =
  | { ok: true; data: T; status: number; ms: number }
  | { ok: false; error: SkillError; ms: number };

function classify(error: unknown): SkillError {
  const message = error instanceof Error ? error.message : String(error);
  const cause = (error as { cause?: { code?: string; message?: string } })?.cause;
  const code = cause?.code ?? "";

  if (error instanceof Error && error.name === "AbortError") {
    return { code: "timeout", message: "Request exceeded its time budget." };
  }
  if (
    /ENOTFOUND|EAI_AGAIN|ENETUNREACH|ECONNREFUSED|ECONNRESET|EPIPE|EHOSTUNREACH|ETIMEDOUT/i.test(
      code,
    ) ||
    /fetch failed|network|socket hang up|tls|SSL/i.test(message)
  ) {
    return {
      code: "egress_blocked",
      message: `No network path to the source (${code || "network failure"}).`,
    };
  }
  return { code: "unknown", message };
}

/**
 * Every outbound call goes through here: hard timeout, retry on transient
 * failures, honest error classification. No source is ever "assumed" reachable.
 */
export async function request<T = unknown>(
  url: string,
  ctx: Pick<NetContext, "fetch" | "signal">,
  init: RequestInit & {
    timeoutMs?: number;
    retries?: number;
    parse?: "json" | "text";
    accept?: string;
  } = {},
): Promise<NetResult<T>> {
  const {
    timeoutMs = DEFAULT_TIMEOUT,
    retries = 1,
    parse = "json",
    accept,
    ...rest
  } = init;
  const started = Date.now();
  let last: SkillError | undefined;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    ctx.signal?.addEventListener("abort", onAbort, { once: true });

    try {
      const response = await ctx.fetch(url, {
        ...rest,
        signal: controller.signal,
        redirect: rest.redirect ?? "follow",
        headers: {
          "user-agent": USER_AGENT,
          accept: accept ?? (parse === "json" ? "application/json" : "*/*"),
          ...(rest.headers as Record<string, string> | undefined),
        },
        cache: "no-store",
      });
      const ms = Date.now() - started;

      if (response.status === 429) {
        last = {
          code: "rate_limited",
          message: "Source rate limit reached.",
          status: 429,
        };
        await delay(400 * (attempt + 1));
        continue;
      }
      if (response.status === 403 || response.status === 451) {
        return {
          ok: false,
          ms,
          error: {
            code: "egress_blocked",
            message: `Source refused this request (HTTP ${response.status}).`,
            status: response.status,
          },
        };
      }
      if (!response.ok) {
        return {
          ok: false,
          ms,
          error: {
            code: "http_error",
            message: `Source returned HTTP ${response.status}.`,
            status: response.status,
          },
        };
      }

      const text = await response.text();
      if (parse === "text") {
        return { ok: true, data: text as unknown as T, status: response.status, ms };
      }
      try {
        return {
          ok: true,
          data: JSON.parse(text) as T,
          status: response.status,
          ms,
        };
      } catch {
        return {
          ok: false,
          ms,
          error: { code: "parse", message: "Source returned a non-JSON body." },
        };
      }
    } catch (error) {
      last = classify(error);
      if (last.code === "egress_blocked") {
        break;
      }
      await delay(250 * (attempt + 1));
    } finally {
      clearTimeout(timer);
      ctx.signal?.removeEventListener("abort", onAbort);
    }
  }

  return {
    ok: false,
    ms: Date.now() - started,
    error: last ?? { code: "unknown", message: "Request failed." },
  };
}

export function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function source(
  id: string,
  label: string,
  url: string | undefined,
  kind: SourceRef["kind"],
): SourceRef {
  return { id, label, url, kind, accessedAt: Date.now() };
}

export function outcomeFromError(skillId: string, error: SkillError) {
  const status =
    error.code === "egress_blocked"
      ? ("unreachable" as const)
      : error.code === "requires_key"
        ? ("blocked" as const)
        : error.code === "rate_limited"
          ? ("partial" as const)
          : ("error" as const);
  return { skillId, error, status };
}

export function describeError(error: SkillError): string {
  switch (error.code) {
    case "egress_blocked":
      return `Source unreachable from the executing runtime — ${error.message}`;
    case "requires_key":
      return error.message;
    case "rate_limited":
      return "Source rate limited this run; partial results only.";
    case "timeout":
      return "Source did not answer inside the time budget.";
    case "http_error":
      return error.message;
    default:
      return error.message;
  }
}

/** Exponential-ish backoff helper, capped, for multi-request skills. */
export function concurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function lane() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }

  const lanes = Array.from({ length: Math.min(limit, items.length) }, lane);
  return Promise.all(lanes).then(() => results);
}
