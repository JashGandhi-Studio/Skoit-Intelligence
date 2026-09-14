import { parsePhoneNumberFromString } from "libphonenumber-js";
import { md5, sha256 } from "@/lib/crypto/digest";
import { dnsSource, resolveDns, txtRecords } from "@/lib/net/dns";
import { concurrency, request, source } from "@/lib/net/http";
import { attrs, entity, evidence } from "@/lib/skills/emit";
import { normalizeDomain } from "@/lib/skills/identify";
import {
  maskDigits,
  upiLooksValid,
  verifyBase58Check,
  verifyBech32,
  verifyIban,
} from "@/lib/skills/validators";
import type { Entity, SkillDefinition } from "@/lib/types";

/* -------------------------------- Email -------------------------------- */

interface MailCheckResponse {
  domain?: string;
  disposable?: boolean;
  role?: boolean;
  free?: boolean;
  mx?: boolean;
  alias?: boolean;
  did_you_mean?: string | null;
  blocked?: boolean;
}

export const emailIntelligence: SkillDefinition = {
  id: "email-intelligence",
  name: "Email intelligence",
  short: "Email",
  description:
    "Normalises an address, verifies the mail domain really accepts mail (MX), classifies free/role/disposable mailboxes and computes Gravatar-linked identities from the address hash.",
  category: "identity",
  runtime: "live",
  accepts: ["email"],
  produces: ["mx", "mailbox-class", "gravatar-hash"],
  keywords: ["email", "mail", "address", "gmail", "mailbox", "contact", "disposable"],
  clientFallback: true,
  async run(target, ctx) {
    const skill = "email-intelligence";
    const email = target.value.toLowerCase().trim();
    const [local, mailDomain] = email.split("@");
    if (!local || !mailDomain) {
      return {
        status: "error",
        summary: "Not a parsable email address.",
        evidence: [],
        entities: [],
        sources: [],
        error: { code: "parse", message: "Malformed email address." },
      };
    }

    const mxResult = await resolveDns(mailDomain, "MX", ctx);
    const spfResult = await resolveDns(mailDomain, "TXT", ctx);
    const dnsSrc = dnsSource(mxResult.resolver);
    const mxHosts = (mxResult.answers ?? []).map(
      (answer) => answer.data.split(" ").pop() ?? "",
    );
    const spf = txtRecords(spfResult.answers).find((value) => value.startsWith("v=spf1"));
    const mailProvider = mxHosts[0]?.toLowerCase() ?? "";
    const providerName = /google|googlemail/.test(mailProvider)
      ? "Google Workspace / Gmail"
      : /outlook|protection\.outlook/.test(mailProvider)
        ? "Microsoft 365 / Outlook"
        : /zoho/.test(mailProvider)
          ? "Zoho Mail"
          : /yandex/.test(mailProvider)
            ? "Yandex Mail"
            : /protonmail|proton\.ch/.test(mailProvider)
              ? "Proton Mail"
              : /mimecast|proofpoint|barracuda/.test(mailProvider)
                ? `Secure email gateway (${mailProvider.split(".").slice(-2).join(".")})`
                : mailProvider || "unknown";

    const mailcheckSrc = source(
      "email:mailcheck",
      "mailcheck.ai mailbox classifier",
      `https://api.mailcheck.ai/email/${email}`,
      "api",
    );
    const mailcheck = await request<MailCheckResponse>(
      `https://api.mailcheck.ai/email/${encodeURIComponent(email)}`,
      ctx,
      { timeoutMs: 8000 },
    );

    const gravatarHash = md5(email);
    const gravatarSrc = source(
      "identity:gravatar",
      "Gravatar public profile service",
      `https://www.gravatar.com/avatar/${gravatarHash}?d=404`,
      "api",
    );
    const gravatar = await request(
      `https://www.gravatar.com/avatar/${gravatarHash}?d=404&s=200`,
      ctx,
      { parse: "text", timeoutMs: 6000, retries: 0 },
    );

    const evidenceItems = [
      evidence(skill, "Mail domain", mailDomain, { source: dnsSrc }),
      evidence(
        skill,
        "Accepts mail",
        mxHosts.length > 0
          ? `yes — ${mxHosts.slice(0, 4).join(", ")}`
          : "no MX published",
        {
          source: dnsSrc,
          severity: mxHosts.length === 0 ? "high" : "info",
          detail:
            mxHosts.length === 0
              ? "A domain with no MX cannot receive mail; any address at it is undeliverable and commonly used for throwaway signups."
              : undefined,
        },
      ),
      evidence(skill, "Mail provider", providerName, { source: dnsSrc }),
      evidence(skill, "SPF record", spf ?? "not published", {
        source: dnsSrc,
        confidence: spf ? "confirmed" : "probable",
      }),
      evidence(skill, "Gravatar MD5 (email hash)", gravatarHash, {
        source: gravatarSrc,
        detail:
          "Public, deterministic hash of the address. Any service that keys on it can correlate this identity.",
      }),
      ...(gravatar.ok
        ? [
            evidence(
              skill,
              "Gravatar profile",
              `present — https://www.gravatar.com/avatar/${gravatarHash}`,
              {
                source: gravatarSrc,
                severity: "low",
                detail:
                  "A profile image exists for this address, so the address is in active use on at least one site.",
              },
            ),
          ]
        : []),
      ...(mailcheck.ok && mailcheck.data
        ? [
            evidence(
              skill,
              "Mailbox classification",
              [
                mailcheck.data.free ? "free provider" : null,
                mailcheck.data.role ? "role account (not a person)" : null,
                mailcheck.data.disposable ? "disposable" : null,
                mailcheck.data.alias ? "alias" : null,
                mailcheck.data.blocked ? "blocked by provider classifier" : null,
              ]
                .filter(Boolean)
                .join(" · ") || "ordinary mailbox",
              {
                source: mailcheckSrc,
                severity: mailcheck.data.disposable ? "medium" : "info",
              },
            ),
            ...(mailcheck.data.did_you_mean
              ? [
                  evidence(
                    skill,
                    "Possible typo",
                    `did you mean ${mailcheck.data.did_you_mean}?`,
                    {
                      source: mailcheckSrc,
                      severity: "low",
                    },
                  ),
                ]
              : []),
          ]
        : [
            evidence(skill, "Mailbox classification", "provider unreachable this run", {
              source: mailcheckSrc,
              confidence: "unknown",
              kind: "warning",
            }),
          ]),
    ];

    return {
      status: "ok",
      summary: `${email} — ${mxHosts.length ? `deliverable via ${providerName}` : "domain has no MX"}${
        gravatar.ok ? ", Gravatar profile present" : ""
      }.`,
      evidence: evidenceItems,
      entities: [
        entity(
          skill,
          "email",
          email,
          "Target address",
          attrs({ local, domain: mailDomain }),
        ),
        entity(skill, "domain", mailDomain, "Mail domain"),
        ...mxHosts
          .slice(0, 4)
          .map((host) =>
            entity(
              skill,
              "domain",
              host.replace(/\.$/, ""),
              "Mail exchanger",
              [],
              "confirmed",
            ),
          ),
      ],
      sources: [dnsSrc, mailcheckSrc, gravatarSrc],
    };
  },
};

/* ------------------------------ Breach data ---------------------------- */

interface HibpBreach {
  Name: string;
  Title: string;
  Domain: string;
  BreachDate: string;
  PwnCount: number;
  DataClasses?: string[];
  IsVerified?: boolean;
}

export const breachExposure: SkillDefinition = {
  id: "breach-exposure",
  name: "Breach exposure",
  short: "Breaches",
  description:
    "Checks Have I Been Pwned for verified breach records tied to an address or domain. Requires HIBP_API_KEY for account-level lookups; domain-level results run unauthenticated.",
  category: "identity",
  runtime: "live",
  accepts: ["email", "domain"],
  produces: ["breaches", "exposure-dates"],
  keywords: ["breach", "leak", "pwned", "compromised", "leaked", "dump", "credential"],
  clientFallback: false,
  requiresKey: ["HIBP_API_KEY"],
  async run(target, ctx) {
    const skill = "breach-exposure";
    const apiKey = ctx.env("HIBP_API_KEY");
    const sourceRef = source(
      "breach:hibp",
      "Have I Been Pwned",
      "https://haveibeenpwned.com/api/v3",
      "api",
    );

    if (target.kind === "email") {
      if (!apiKey) {
        return {
          status: "blocked",
          summary:
            "Account-level breach lookup needs an HIBP API key. Set HIBP_API_KEY to enable this skill — until then Nothing was queried and nothing is assumed.",
          evidence: [
            evidence(skill, "Account breach check", "not performed", {
              source: sourceRef,
              kind: "warning",
              confidence: "unknown",
              detail:
                "Set HIBP_API_KEY in the environment to enable this source. No fabricated result is shown in its place.",
            }),
          ],
          entities: [],
          sources: [sourceRef],
          error: { code: "requires_key", message: "HIBP_API_KEY not configured." },
        };
      }

      const result = await request<HibpBreach[]>(
        `https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(target.value)}?truncateResponse=false`,
        ctx,
        { headers: { "hibp-api-key": apiKey }, timeoutMs: 10000, retries: 0 },
      );

      if (!result.ok) {
        if (result.error.status === 404) {
          return {
            status: "ok",
            summary: `${target.value} does not appear in any verified breach corpus.`,
            evidence: [evidence(skill, "Breach records", "none", { source: sourceRef })],
            entities: [],
            sources: [sourceRef],
          };
        }
        return {
          status: result.error.status === 401 ? "blocked" : "error",
          summary: `Breach source rejected the query: ${result.error.message}`,
          evidence: [],
          entities: [],
          sources: [sourceRef],
          error: result.error,
        };
      }

      const breaches = result.data ?? [];
      return {
        status: "ok",
        summary: `${breaches.length} verified breach corpus record(s) contain this address.`,
        evidence: [
          evidence(skill, "Breach count", String(breaches.length), {
            source: sourceRef,
            severity:
              breaches.length > 2 ? "high" : breaches.length > 0 ? "medium" : "info",
          }),
          ...breaches.slice(0, 12).map((breach) =>
            evidence(skill, breach.Title, breach.BreachDate, {
              source: sourceRef,
              detail: `${breach.PwnCount.toLocaleString()} accounts; exposes ${(breach.DataClasses ?? []).join(", ")}`,
              severity: (breach.DataClasses ?? []).some((item) => /password/i.test(item))
                ? "high"
                : "medium",
            }),
          ),
        ],
        entities: breaches
          .slice(0, 12)
          .map((breach) =>
            entity(
              skill,
              "date",
              breach.BreachDate,
              `${breach.Title} breach`,
              [],
              "confirmed",
            ),
          ),
        sources: [sourceRef],
      };
    }

    ctx.log("Domain-level breach listing is public but rate limited");
    const result = await request<HibpBreach[]>(
      `https://haveibeenpwned.com/api/v3/breaches`,
      ctx,
      { timeoutMs: 12000, retries: 1 },
    );

    if (!result.ok) {
      return {
        status: result.error.code === "egress_blocked" ? "unreachable" : "error",
        summary: "Breach corpus unreachable from this runtime.",
        evidence: [],
        entities: [],
        sources: [sourceRef],
        error: result.error,
      };
    }

    const domain = normalizeDomain(target.value);
    const matched = (result.data ?? []).filter(
      (breach) => breach.Domain?.toLowerCase() === domain,
    );

    return {
      status: "ok",
      summary:
        matched.length > 0
          ? `${matched.length} corpus record(s) for ${domain}, totalling ${matched.reduce((sum, item) => sum + (item.PwnCount ?? 0), 0).toLocaleString()} accounts.`
          : `No corpus record names ${domain} as the breached organisation.`,
      evidence: matched.flatMap((breach) => [
        evidence(skill, breach.Title, breach.BreachDate, {
          source: sourceRef,
          detail: `${breach.PwnCount.toLocaleString()} accounts; ${(breach.DataClasses ?? []).join(", ")}`,
          severity: breach.IsVerified ? "high" : "low",
        }),
      ]),
      entities: matched.map((breach) =>
        entity(
          skill,
          "date",
          breach.BreachDate,
          `${breach.Title} breach`,
          [],
          "confirmed",
        ),
      ),
      sources: [sourceRef],
    };
  },
};

/* --------------------------- Username footprint ------------------------ */

interface GithubUser {
  login?: string;
  name?: string;
  company?: string;
  blog?: string;
  location?: string;
  bio?: string;
  twitter_username?: string;
  public_repos?: number;
  followers?: number;
  created_at?: string;
  updated_at?: string;
  avatar_url?: string;
  email?: string;
}

const PLATFORMS: Array<{
  id: string;
  label: string;
  url: (user: string) => string;
  parse?: (body: any) => Record<string, string | number | undefined>;
  accept?: string;
}> = [
  {
    id: "github",
    label: "GitHub",
    url: (user) => `https://api.github.com/users/${user}`,
    accept: "application/vnd.github+json",
    parse: (body: GithubUser) => ({
      name: body.name,
      company: body.company,
      location: body.location,
      blog: body.blog,
      repos: body.public_repos,
      followers: body.followers,
      joined: body.created_at?.slice(0, 10),
      twitter: body.twitter_username,
      bio: body.bio,
    }),
  },
  {
    id: "gitlab",
    label: "GitLab",
    url: (user) => `https://gitlab.com/api/v4/users?username=${encodeURIComponent(user)}`,
    parse: (
      body: Array<{
        name?: string;
        state?: string;
        created_at?: string;
        web_url?: string;
      }>,
    ) =>
      Array.isArray(body) && body[0]
        ? {
            name: body[0].name,
            state: body[0].state,
            joined: body[0].created_at?.slice(0, 10),
          }
        : {},
  },
  {
    id: "codeberg",
    label: "Codeberg",
    url: (user) => `https://codeberg.org/api/v1/users/${encodeURIComponent(user)}`,
    parse: (body: {
      full_name?: string;
      location?: string;
      created?: string;
      website?: string;
    }) => ({
      name: body.full_name,
      location: body.location,
      joined: body.created?.slice(0, 10),
      website: body.website,
    }),
  },
  {
    id: "hackernews",
    label: "Hacker News",
    url: (user) => `https://hn.algolia.com/api/v1/users/${encodeURIComponent(user)}`,
    parse: (body: { karma?: number; created_at?: string; about?: string }) => ({
      karma: body.karma,
      joined: body.created_at?.slice(0, 10),
      about: body.about,
    }),
  },
  {
    id: "keybase",
    label: "Keybase",
    url: (user) =>
      `https://keybase.io/_/api/1.0/user/lookup.json?username=${encodeURIComponent(user)}&fields=basics,profile`,
    parse: (body: any) => {
      const them = body?.them?.[0];
      if (!them) {
        return {};
      }
      return {
        name: them.profile?.full_name,
        location: them.profile?.location,
        website: them.profile?.website,
        bio: them.profile?.bio,
      };
    },
  },
  {
    id: "reddit",
    label: "Reddit",
    url: (user) => `https://www.reddit.com/user/${encodeURIComponent(user)}/about.json`,
    parse: (body: any) => ({
      name: body?.data?.subreddit?.title,
      karma: body?.data?.total_karma,
      joined: body?.data?.created_utc
        ? new Date(body.data.created_utc * 1000).toISOString().slice(0, 10)
        : undefined,
    }),
  },
];

export const usernameFootprint: SkillDefinition = {
  id: "username-footprint",
  name: "Username footprint",
  short: "Username",
  description:
    "Checks which public platforms actually host this handle and harvests the profile metadata each one exposes (real names, locations, join dates, linked sites).",
  category: "identity",
  runtime: "live",
  accepts: ["username"],
  produces: ["accounts", "profile-fields", "join-dates"],
  keywords: [
    "username",
    "handle",
    "account",
    "profile",
    "github",
    "social",
    "alias",
    "pseudonym",
  ],
  clientFallback: true,
  async run(target, ctx) {
    const skill = "username-footprint";
    const handle = target.value.replace(/^@/, "").trim();
    const hits: Array<{
      platform: string;
      url: string;
      fields: Record<string, string | number | undefined>;
    }> = [];
    const failures: string[] = [];

    await concurrency(PLATFORMS, 4, async (platform) => {
      const result = await request<any>(platform.url(handle), ctx, {
        accept: platform.accept ?? "application/json",
        timeoutMs: 8000,
        retries: 0,
      });
      if (result.ok) {
        const fields = platform.parse ? platform.parse(result.data) : {};
        const meaningful = Object.values(fields).some(
          (value) => value !== undefined && value !== "",
        );
        if (meaningful || platform.id === "github") {
          hits.push({ platform: platform.label, url: platform.url(handle), fields });
        }
        return null;
      }
      if (result.error.status === 404) {
        return null;
      }
      if (result.error.code === "egress_blocked" || result.error.code === "http_error") {
        failures.push(platform.label);
      }
      return null;
    });

    if (hits.length === 0) {
      return {
        status: failures.length === PLATFORMS.length ? "unreachable" : "ok",
        summary:
          failures.length === PLATFORMS.length
            ? "No platform API reachable — handle presence could not be verified."
            : `No public account found for “${handle}” on the checked platforms.`,
        evidence: [
          evidence(skill, "Accounts found", "none", {
            source: source(
              "identity:platforms",
              "Platform profile APIs",
              undefined,
              "api",
            ),
            confidence: failures.length === PLATFORMS.length ? "unknown" : "probable",
            detail:
              "Absence of a public profile does not mean the handle is unused; many platforms hide accounts from unauthenticated queries.",
          }),
        ],
        entities: [entity(skill, "username", handle, "Handle checked")],
        sources: [
          source("identity:platforms", "Platform profile APIs", undefined, "api"),
        ],
      };
    }

    const entities: Entity[] = [entity(skill, "username", handle, "Handle checked")];
    const evidenceItems = [
      evidence(skill, "Accounts located", hits.map((hit) => hit.platform).join(" · "), {
        source: source("identity:platforms", "Platform profile APIs", undefined, "api"),
      }),
    ];

    for (const hit of hits) {
      const pairs = Object.entries(hit.fields)
        .filter(([, value]) => value !== undefined && value !== "")
        .map(([key, value]) => `${key}: ${value}`);
      evidenceItems.push(
        evidence(
          skill,
          `${hit.platform} profile`,
          pairs.join(" · ") || "exists (no public fields)",
          {
            source: source(`identity:${hit.platform}`, hit.platform, hit.url, "api"),
          },
        ),
      );
      if (typeof hit.fields.name === "string" && hit.fields.name) {
        entities.push(
          entity(
            skill,
            "person",
            hit.fields.name,
            `Name on ${hit.platform}`,
            [],
            "probable",
          ),
        );
      }
      if (typeof hit.fields.location === "string" && hit.fields.location) {
        entities.push(
          entity(
            skill,
            "address",
            hit.fields.location,
            `Stated location on ${hit.platform}`,
            [],
            "possible",
          ),
        );
      }
      if (typeof hit.fields.blog === "string" && hit.fields.blog) {
        entities.push(
          entity(
            skill,
            "domain",
            normalizeDomain(hit.fields.blog),
            `Linked site on ${hit.platform}`,
            [],
            "probable",
          ),
        );
      }
      if (typeof hit.fields.joined === "string" && hit.fields.joined) {
        entities.push(
          entity(
            skill,
            "date",
            hit.fields.joined,
            `Joined ${hit.platform}`,
            [],
            "confirmed",
          ),
        );
      }
    }

    return {
      status: "ok",
      summary: `“${handle}” is present on ${hits.map((hit) => hit.platform).join(", ")}.`,
      evidence: evidenceItems,
      entities,
      sources: [source("identity:platforms", "Platform profile APIs", undefined, "api")],
    };
  },
};

/* ------------------------------- Crypto -------------------------------- */

export const cryptoAddress: SkillDefinition = {
  id: "crypto-address",
  name: "Crypto address check",
  short: "Crypto",
  description:
    "Detects the address format, verifies its checksum where the scheme defines one, and reads public chain statistics for Bitcoin via mempool.space.",
  category: "identity",
  runtime: "live",
  accepts: ["crypto-address"],
  produces: ["chain", "checksum", "activity"],
  keywords: [
    "bitcoin",
    "btc",
    "eth",
    "crypto",
    "wallet",
    "blockchain",
    "address",
    "tron",
    "usdt",
  ],
  clientFallback: true,
  async run(target, ctx) {
    const skill = "crypto-address";
    const value = target.value.trim();
    const chainSource = source(
      "chain:mempool",
      "mempool.space public Bitcoin API",
      `https://mempool.space/api/address/${value}`,
      "api",
    );

    let chain = "unknown";
    let checksum = "not applicable";
    let formatNote = "";

    if (/^0x[a-fA-F0-9]{40}$/.test(value)) {
      chain = "EVM (Ethereum and compatible chains)";
      checksum =
        /^0x[0-9a-fA-F]*$/.test(value) &&
        value !== value.toLowerCase() &&
        value !== value.toUpperCase()
          ? "EIP-55 mixed-case checksum present"
          : "no EIP-55 casing (valid, casing is optional)";
      formatNote =
        "Balance and token holdings require a keyed EVM indexer (e.g. Etherscan API key).";
    } else if (/^bc1[a-z0-9]{25,62}$/.test(value)) {
      const bech = verifyBech32(value);
      chain = "Bitcoin (native segwit / bech32)";
      checksum = bech.valid ? "bech32 checksum valid" : "bech32 checksum FAILED";
      formatNote = `Human-readable prefix: ${bech.prefix ?? "unknown"}`;
    } else if (/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(value)) {
      const decoded = await verifyBase58Check(value);
      chain =
        decoded.version === 0
          ? "Bitcoin (P2PKH, legacy)"
          : decoded.version === 5
            ? "Bitcoin (P2SH)"
            : "Base58Check-compatible chain";
      checksum = decoded.valid
        ? "Base58Check checksum valid"
        : "Base58Check checksum FAILED";
    } else if (/^(T|8)[1-9A-HJ-NP-Za-km-z]{33}$/.test(value)) {
      chain = "Tron (often USDT-TRC20)";
      checksum = "shape-only (no local verifier)";
    } else {
      checksum = "unrecognised format";
    }

    const evidenceItems = [
      evidence(skill, "Address format", chain, {
        confidence: chain === "unknown" ? "unknown" : "confirmed",
      }),
      evidence(skill, "Checksum verification", checksum, {
        confidence: checksum.includes("FAILED") ? "confirmed" : "probable",
        severity: checksum.includes("FAILED") ? "high" : "info",
        detail: checksum.includes("FAILED")
          ? "An address that fails its own checksum cannot exist on-chain — treat the string as mistyped or fabricated."
          : formatNote || undefined,
      }),
    ];

    const entities: Entity[] = [entity(skill, "crypto-address", value, chain)];

    if (chain.startsWith("Bitcoin")) {
      const stats = await request<{
        chain_stats?: {
          funded_txo_count?: number;
          tx_count?: number;
          funded_txo_sum?: number;
          spent_txo_sum?: number;
        };
        mempool_stats?: { count?: number };
      }>(`https://mempool.space/api/address/${encodeURIComponent(value)}`, ctx, {
        timeoutMs: 9000,
      });

      if (stats.ok && stats.data.chain_stats) {
        const chainStats = stats.data.chain_stats;
        const balance =
          ((chainStats.funded_txo_sum ?? 0) - (chainStats.spent_txo_sum ?? 0)) / 1e8;
        evidenceItems.push(
          evidence(skill, "Confirmed transactions", String(chainStats.tx_count ?? 0), {
            source: chainSource,
          }),
          evidence(skill, "Current balance", `${balance.toFixed(8)} BTC`, {
            source: chainSource,
          }),
          evidence(
            skill,
            "Lifetime received",
            `${((chainStats.funded_txo_sum ?? 0) / 1e8).toFixed(8)} BTC`,
            { source: chainSource },
          ),
          ...(stats.data.mempool_stats?.count
            ? [
                evidence(
                  skill,
                  "Pending transactions",
                  String(stats.data.mempool_stats.count),
                  {
                    source: chainSource,
                    detail:
                      "The owning party moved funds while this analysis was running.",
                  },
                ),
              ]
            : []),
        );
      } else {
        evidenceItems.push(
          evidence(
            skill,
            "Chain lookup",
            "public Bitcoin API unreachable or rate limited this run",
            {
              source: chainSource,
              kind: "warning",
              confidence: "unknown",
            },
          ),
        );
      }
    }

    return {
      status: "ok",
      summary: `${chain}; ${checksum}.`,
      evidence: evidenceItems,
      entities,
      sources: [chainSource],
    };
  },
};

/* -------------------------------- Phone -------------------------------- */

export const phoneIntelligence: SkillDefinition = {
  id: "phone-intelligence",
  name: "Phone number intelligence",
  short: "Phone",
  description:
    "Parses a number against libphonenumber metadata: country, carrier prefix, line type (mobile/fixed/VoIP), valid number ranges and canonical E.164 formatting. No HLR data is invented.",
  category: "comms",
  runtime: "local",
  accepts: ["phone"],
  produces: ["e164", "line-type", "country"],
  keywords: ["phone", "number", "mobile", "sim", "call", "whatsapp", "e164", "carrier"],
  clientFallback: true,
  async run(target) {
    const skill = "phone-intelligence";
    const raw = target.raw.trim();
    const defaultCountry = /^\+/.test(raw) ? undefined : ("IN" as const);
    const parsed =
      parsePhoneNumberFromString(raw, defaultCountry) ??
      parsePhoneNumberFromString(raw.replace(/[^\d+]/g, ""), defaultCountry);

    if (!parsed) {
      return {
        status: "partial",
        summary: "Number could not be parsed by libphonenumber metadata.",
        evidence: [
          evidence(skill, "Parse result", "unparsable", {
            kind: "warning",
            confidence: "confirmed",
            detail:
              "Add a country code (e.g. +91) for a definitive read, or the string is not a phone number.",
          }),
        ],
        entities: [],
        sources: [
          source(
            "local:libphonenumber",
            "libphonenumber metadata (bundled)",
            "https://github.com/google/libphonenumber",
            "dataset",
          ),
        ],
      };
    }

    const type = parsed.getType?.() ?? "unknown";
    const typeLabel: Record<string, string> = {
      MOBILE: "mobile",
      FIXED_LINE: "fixed line",
      FIXED_LINE_OR_MOBILE: "fixed line or mobile (ambiguous range)",
      TOLL_FREE: "toll free",
      PREMIUM_RATE: "premium rate",
      SHARED_COST: "shared cost",
      VOIP: "VoIP / internet number",
      PERSONAL_NUMBER: "personal number",
      PAGER: "pager",
      UAN: "universal access number",
      VOICEMAIL: "voicemail",
      unknown: "unclassified",
    };

    const isVoip = type === "VOIP";
    const localSource = source(
      "local:libphonenumber",
      "libphonenumber metadata (bundled, offline)",
      "https://github.com/google/libphonenumber",
      "dataset",
    );

    return {
      status: "ok",
      summary: `${parsed.number} — ${parsed.country ?? "unknown country"}, ${typeLabel[type] ?? type}, valid: ${parsed.isValid() ? "yes" : "no"}.`,
      evidence: [
        evidence(skill, "E.164", parsed.number, { source: localSource }),
        evidence(
          skill,
          "Country",
          `${parsed.country ?? "unknown"}${parsed.countryCallingCode ? ` (+${parsed.countryCallingCode})` : ""}`,
          {
            source: localSource,
          },
        ),
        evidence(skill, "National format", parsed.formatNational(), {
          source: localSource,
        }),
        evidence(skill, "Line type", typeLabel[type] ?? type, {
          source: localSource,
          severity: isVoip ? "medium" : "info",
          detail: isVoip
            ? "VoIP ranges are trivially registered in bulk and are the usual backbone of spam and fraud campaigns."
            : undefined,
        }),
        evidence(
          skill,
          "Number valid per numbering plan",
          parsed.isValid() ? "yes" : "no",
          {
            source: localSource,
            severity: parsed.isValid() ? "info" : "medium",
          },
        ),
        evidence(skill, "Possible number", parsed.isPossible() ? "yes" : "no", {
          source: localSource,
        }),
        evidence(skill, "Local subscriber digits", maskDigits(parsed.nationalNumber, 3), {
          source: localSource,
          kind: "fact",
          detail:
            "Masked deliberately — full subscriber digits stay in the case file, not in shared output.",
        }),
        evidence(
          skill,
          "Subscriber identity",
          "not queried — requires a licensed HLR/HLR-lookup provider",
          {
            source: localSource,
            kind: "warning",
            confidence: "unknown",
            detail:
              "Who actually holds a SIM is carrier data behind lawful-access or commercial HLR providers. This console does not guess it from metadata.",
          },
        ),
      ],
      entities: [
        entity(
          skill,
          "phone",
          parsed.number,
          "E.164 number",
          attrs({
            country: parsed.country,
            callingCode: parsed.countryCallingCode,
            type: typeLabel[type],
          }),
        ),
        ...(parsed.country
          ? [
              entity(
                skill,
                "address",
                parsed.country,
                "Registration country",
                [],
                "probable",
              ),
            ]
          : []),
      ],
      sources: [localSource],
    };
  },
};

/* ------------------------------ Free text ------------------------------ */

export const textIntelligence: SkillDefinition = {
  id: "text-intelligence",
  name: "Text sweep",
  short: "Text sweep",
  description:
    "Extracts every address-like signal from pasted text or a message body and hashes it for exact-match comparison against a case file.",
  category: "knowledge",
  runtime: "local",
  accepts: ["text"],
  produces: ["entities", "hashes"],
  keywords: ["text", "message", "sweep", "extract", "paste", "chat", "sms", "email body"],
  clientFallback: true,
  async run(target) {
    const skill = "text-intelligence";
    const [digest256, digestMd5] = await Promise.all([
      sha256(target.raw),
      Promise.resolve(md5(target.raw)),
    ]);
    const lines = target.raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
    const urls = target.raw.match(/https?:\/\/[^\s<>"')]+/gi) ?? [];
    const suspicious = urls.filter((url) =>
      /(bit\.ly|tinyurl|t\.co|goo\.gl|is\.gd|shorturl|rb\.gy|cutt\.ly)/i.test(url),
    );

    return {
      status: "ok",
      summary: `Swept ${lines.length} line(s) and ${target.raw.length} characters; ${urls.length} URL(s) extracted.`,
      evidence: [
        evidence(skill, "SHA-256 of input", digest256, { kind: "metric" }),
        evidence(skill, "MD5 of input", digestMd5, {
          kind: "metric",
          detail:
            "Deterministic digests let this exact text be matched against other case files later.",
        }),
        evidence(skill, "Line count", String(lines.length), { kind: "metric" }),
        evidence(skill, "URLs found", urls.slice(0, 12).join(" · ") || "none", {
          raw: urls,
          confidence: "confirmed",
        }),
        ...(suspicious.length > 0
          ? [
              evidence(skill, "Shortened links", suspicious.join(" · "), {
                severity: "medium",
                detail:
                  "Shorteners hide the true destination; expand before clicking, never on your own network.",
              }),
            ]
          : []),
      ],
      entities: [],
      sources: [source("local:text", "Local text sweep (offline)", undefined, "local")],
    };
  },
};

export const identitySkills: SkillDefinition[] = [
  emailIntelligence,
  breachExposure,
  usernameFootprint,
  cryptoAddress,
  phoneIntelligence,
  textIntelligence,
];

export { upiLooksValid, verifyIban };
