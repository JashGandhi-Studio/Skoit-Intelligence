import type { NetContext, SkillError } from "@/lib/types";
import { source } from "./http";

export interface DnsAnswer {
  name: string;
  type: number;
  TTL: number;
  data: string;
}

export interface DnsResult {
  ok: boolean;
  answers: DnsAnswer[];
  authority: DnsAnswer[];
  resolver: string;
  status: number | null;
  nxdomain: boolean;
  error?: SkillError;
  ms: number;
}

export const DNS_TYPE: Record<string, number> = {
  A: 1,
  NS: 2,
  CNAME: 5,
  SOA: 6,
  PTR: 12,
  MX: 15,
  TXT: 16,
  AAAA: 28,
  SRV: 33,
  DS: 43,
  CAA: 257,
};

export const DNS_TYPE_NAME: Record<number, string> = Object.fromEntries(
  Object.entries(DNS_TYPE).map(([name, code]) => [code, name]),
);

const RESOLVERS = [
  {
    id: "cloudflare",
    label: "Cloudflare 1.1.1.1 (DoH)",
    url: "https://cloudflare-dns.com/dns-query",
  },
  { id: "google", label: "Google Public DNS (DoH)", url: "https://dns.google/resolve" },
];

export function dnsSource(resolverId: string) {
  const resolver = RESOLVERS.find((item) => item.id === resolverId) ?? RESOLVERS[0];
  return source(`dns:${resolver.id}`, resolver.label, resolver.url, "dns");
}

/**
 * DNS over HTTPS — works identically in Node and the browser, leaks no local
 * resolver behaviour, and gives us a truthful NXDOMAIN signal.
 */
export async function resolveDns(
  name: string,
  type: keyof typeof DNS_TYPE,
  ctx: Pick<NetContext, "fetch" | "signal">,
  timeoutMs = 6000,
): Promise<DnsResult> {
  let lastError: SkillError | undefined;
  let elapsed = 0;

  for (const resolver of RESOLVERS) {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    ctx.signal?.addEventListener("abort", onAbort, { once: true });

    try {
      const response = await ctx.fetch(
        `${resolver.url}?name=${encodeURIComponent(name)}&type=${type}`,
        {
          headers: { accept: "application/dns-json" },
          signal: controller.signal,
          cache: "no-store",
        },
      );
      elapsed += Date.now() - started;
      if (!response.ok) {
        lastError = {
          code: "http_error",
          message: `Resolver ${resolver.id} returned HTTP ${response.status}.`,
          status: response.status,
        };
        continue;
      }
      const body = (await response.json()) as {
        Status: number;
        Answer?: DnsAnswer[];
        Authority?: DnsAnswer[];
      };
      return {
        ok: true,
        answers: body.Answer ?? [],
        authority: body.Authority ?? [],
        resolver: resolver.id,
        status: body.Status,
        nxdomain: body.Status === 3,
        ms: Date.now() - started,
      };
    } catch (error) {
      elapsed += Date.now() - started;
      const cause = (error as { cause?: { code?: string } })?.cause?.code ?? "";
      lastError =
        error instanceof Error && error.name === "AbortError"
          ? { code: "timeout", message: `DNS query for ${name} timed out.` }
          : {
              code: /ECONNREFUSED|ENETUNREACH|EAI_AGAIN|ENOTFOUND|ECONNRESET/i.test(cause)
                ? "egress_blocked"
                : "unknown",
              message: `DNS resolver ${resolver.id} unreachable (${cause || "network failure"}).`,
            };
      if (lastError.code === "egress_blocked") {
        break;
      }
    } finally {
      clearTimeout(timer);
      ctx.signal?.removeEventListener("abort", onAbort);
    }
  }

  return {
    ok: false,
    answers: [],
    authority: [],
    resolver: RESOLVERS[0].id,
    status: null,
    nxdomain: false,
    error: lastError ?? { code: "unknown", message: "DNS resolution failed." },
    ms: elapsed,
  };
}

/** True only when the name resolves; NXDOMAIN is authoritative when we have an answer status. */
export async function nameResolves(
  name: string,
  ctx: Pick<NetContext, "fetch" | "signal">,
  types: Array<keyof typeof DNS_TYPE> = ["A", "AAAA", "CNAME"],
): Promise<{ exists: boolean; checked: boolean; records: string[] }> {
  const records: string[] = [];
  let checked = false;

  for (const type of types) {
    const result = await resolveDns(name, type, ctx, 5000);
    if (!result.ok) {
      continue;
    }
    checked = true;
    for (const answer of result.answers) {
      records.push(`${DNS_TYPE_NAME[answer.type] ?? answer.type} ${answer.data}`);
    }
  }

  return { exists: records.length > 0, checked, records };
}

export function txtRecords(answers: DnsAnswer[]): string[] {
  return answers
    .filter((answer) => answer.type === DNS_TYPE.TXT)
    .map((answer) => answer.data.replace(/^"|"$/g, "").replace(/" "/g, ""));
}

export function answerValues(
  answers: DnsAnswer[],
  type?: keyof typeof DNS_TYPE,
): string[] {
  const code = type ? DNS_TYPE[type] : undefined;
  return answers
    .filter((answer) => (code === undefined ? true : answer.type === code))
    .map((answer) => answer.data.replace(/\.$/, ""));
}
