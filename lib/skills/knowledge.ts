import { resolveDns } from "@/lib/net/dns";
import { concurrency, request, source } from "@/lib/net/http";
import { attrs, entity, evidence as makeEvidence } from "@/lib/skills/emit";
import { normalizeDomain } from "@/lib/skills/identify";
import type { Evidence, SkillDefinition } from "@/lib/types";

/* --------------------------- URL dissection ---------------------------- */

const SUSPICIOUS_TERMS = [
  "login",
  "signin",
  "verify",
  "verification",
  "secure",
  "account",
  "update",
  "billing",
  "payment",
  "invoice",
  "refund",
  "kyc",
  "pan-card",
  "aadhaar",
  "upi",
  "netbanking",
  "wallet",
  "otp",
  "unlock",
  "support",
  "recover",
  "gift",
  "bonus",
  "winner",
  "claim",
  "customs",
  "parcel",
  "courier",
];

const SHORTENERS = [
  "bit.ly",
  "tinyurl.com",
  "t.co",
  "goo.gl",
  "is.gd",
  "buff.ly",
  "ow.ly",
  "rb.gy",
  "cutt.ly",
  "shorturl.at",
  "tiny.cc",
  "rebrand.ly",
  "lnkd.in",
  "s.id",
  "clck.ru",
  "vk.cc",
  "t.ly",
];

const BRANDS = [
  "sbi",
  "hdfc",
  "icici",
  "axis",
  "kotak",
  "paytm",
  "phonepe",
  "gpay",
  "googlepay",
  "aadhaar",
  "uidai",
  "irctc",
  "epfo",
  "incometax",
  "gst",
  "amazon",
  "flipkart",
  "myntra",
  "swiggy",
  "zomato",
  "netflix",
  "instagram",
  "facebook",
  "whatsapp",
  "telegram",
  "apple",
  "microsoft",
  "paypal",
  "binance",
  "coinbase",
];

export const urlStructure: SkillDefinition = {
  id: "url-structure",
  name: "URL dissection",
  short: "URL",
  description:
    "Breaks a link into its real components, exposes userinfo and punycode tricks, homoglyph hosts, brand impersonation patterns, shorteners and tracking parameters.",
  category: "tradecraft",
  runtime: "local",
  accepts: ["url", "domain"],
  produces: ["host", "risk-signals", "impersonation"],
  keywords: [
    "url",
    "link",
    "phishing",
    "homoglyph",
    "punycode",
    "typo",
    "shortener",
    "redirect",
    "suspicious",
  ],
  clientFallback: true,
  async run(target) {
    const skill = "url-structure";
    const localSrc = source(
      "local:urlparse",
      "Bundled URL analysis rules (offline)",
      undefined,
      "local",
    );
    const raw = target.raw.trim();
    let parsed: URL;

    try {
      parsed = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
    } catch {
      return {
        status: "error",
        summary: "Not a parsable URL.",
        evidence: [],
        entities: [],
        sources: [localSrc],
        error: { code: "parse", message: "URL could not be parsed." },
      };
    }

    const host = parsed.hostname.toLowerCase();
    const asciiHost = host;
    let unicodeHost = host;
    let punycode = false;
    if (host.includes("xn--")) {
      punycode = true;
      try {
        unicodeHost = new URL(`https://${host}`).hostname.normalize("NFC");
      } catch {
        unicodeHost = host;
      }
    }

    const evidenceItems: Evidence[] = [
      makeEvidence(skill, "Host", host, { source: localSrc }),
      makeEvidence(skill, "Scheme", parsed.protocol.replace(":", ""), {
        source: localSrc,
        severity: parsed.protocol === "http:" ? "medium" : "info",
        detail:
          parsed.protocol === "http:"
            ? "Plain HTTP — credentials and content are readable in transit."
            : undefined,
      }),
      makeEvidence(
        skill,
        "Port",
        parsed.port || (parsed.protocol === "https:" ? "443 (default)" : "80 (default)"),
        {
          source: localSrc,
        },
      ),
      makeEvidence(skill, "Path", parsed.pathname || "/", { source: localSrc }),
      makeEvidence(skill, "Query", parsed.search || "none", {
        source: localSrc,
        raw: Object.fromEntries(parsed.searchParams),
      }),
      makeEvidence(skill, "Fragment", parsed.hash || "none", { source: localSrc }),
    ];

    const entities = [entity(skill, "domain", normalizeDomain(host), "Link host")];

    if (parsed.username || parsed.password) {
      evidenceItems.push(
        makeEvidence(
          skill,
          "Embedded credentials in URL",
          `${parsed.username ? "username" : ""}${parsed.password ? " + password" : ""}`,
          {
            source: localSrc,
            severity: "high",
            detail:
              "Text before the @ is userinfo, not the host. Attackers use it to fake a trusted name: https://sbi.co.in@evil.example/ looks like SBI but resolves to evil.example.",
          },
        ),
      );
    }

    if (punycode) {
      evidenceItems.push(
        makeEvidence(skill, "Internationalised domain", `${unicodeHost} (${asciiHost})`, {
          source: localSrc,
          severity: "medium",
          detail:
            "Punycode hosts can mix scripts to imitate a Latin brand. Confirm the Unicode form character by character.",
        }),
      );
    }

    const labels = host.split(".");
    if (labels.length > 4) {
      evidenceItems.push(
        makeEvidence(skill, "Deep subdomain nesting", `${labels.length} labels`, {
          source: localSrc,
          severity: "low",
          detail:
            "Long trusted-looking prefixes are used to push the real domain out of view on mobile bars.",
        }),
      );
    }

    const term = labels
      .join(" ")
      .match(new RegExp(`(${SUSPICIOUS_TERMS.join("|")})`, "i"));
    if (term) {
      evidenceItems.push(
        makeEvidence(skill, "Sensitive term in host", term[1], {
          source: localSrc,
          severity: "medium",
          detail:
            "Credential, payment or KYC wording inside the hostname is a strong phishing heuristic.",
        }),
      );
    }

    const brandInHost = BRANDS.find((brand) => host.includes(brand));
    const registeredDomain = labels.slice(-2).join(".");
    if (brandInHost && !registeredDomain.startsWith(brandInHost)) {
      evidenceItems.push(
        makeEvidence(
          skill,
          "Possible brand impersonation",
          `${brandInHost} appears in ${host} but the registered domain is ${registeredDomain}`,
          {
            source: localSrc,
            severity: "critical",
            detail:
              "The brand name is being used as a subdomain or suffix to borrow trust it does not own.",
          },
        ),
      );
    }

    if (SHORTENERS.includes(registeredDomain)) {
      evidenceItems.push(
        makeEvidence(skill, "Link shortener", registeredDomain, {
          source: localSrc,
          severity: "medium",
          detail:
            "Shorteners hide the destination and are the default carrier for bulk smishing links.",
        }),
      );
    }

    const tracking = Array.from(parsed.searchParams.keys()).filter((key) =>
      /^(utm_|gclid|fbclid|ref|aff|mc_|_ga|igshid|si$)/i.test(key),
    );
    if (tracking.length > 0) {
      evidenceItems.push(
        makeEvidence(skill, "Tracking parameters", tracking.join(" · "), {
          source: localSrc,
          severity: "low",
          detail:
            "These identify the campaign or click source — useful for attributing a message to a sender.",
        }),
      );
    }

    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
      evidenceItems.push(
        makeEvidence(skill, "IP-literal host", host, {
          source: localSrc,
          severity: "medium",
          detail:
            "Legitimate services rarely link by raw address; it usually indicates throwaway infrastructure.",
        }),
      );
      entities.push(entity(skill, "ip", host, "Link host address"));
    }

    return {
      status: "ok",
      summary: `${host} — ${evidenceItems.length - 6} risk signal(s) detected.`,
      evidence: evidenceItems,
      entities,
      sources: [localSrc],
    };
  },
};

/* --------------------------- Archive history --------------------------- */

export const archiveHistory: SkillDefinition = {
  id: "archive-history",
  name: "Archive history",
  short: "Archive",
  description:
    "Checks the Wayback Machine for snapshots of a page or domain: first and last capture, capture density and status codes, which reveals how long an asset has existed and when its content changed.",
  category: "infrastructure",
  runtime: "live",
  accepts: ["url", "domain"],
  produces: ["first-capture", "snapshot-count", "timeline"],
  keywords: [
    "archive",
    "wayback",
    "history",
    "snapshot",
    "old",
    "deleted",
    "changed",
    "timeline",
  ],
  clientFallback: true,
  async run(target, ctx) {
    const skill = "archive-history";
    const raw = target.raw.trim();
    const host = normalizeDomain(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
    const cdxSrc = source(
      "archive:cdx",
      "Internet Archive CDX index",
      `https://web.archive.org/cdx/search/cdx?url=${host}`,
      "dataset",
    );

    const result = await request<string[][]>(
      `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(host)}&output=json&fl=timestamp,original,statuscode,mimetype&collapse=timestamp:6&limit=40`,
      ctx,
      { timeoutMs: 12000, retries: 1 },
    );

    if (!result.ok || !Array.isArray(result.data)) {
      return {
        status: result.ok
          ? "error"
          : result.error.code === "egress_blocked"
            ? "unreachable"
            : "error",
        summary: result.ok
          ? "Archive index returned an unexpected body."
          : "Internet Archive unreachable from this runtime.",
        evidence: [],
        entities: [],
        sources: [cdxSrc],
        error: result.ok
          ? { code: "parse", message: "Unparsable CDX response." }
          : result.error,
      };
    }

    const rows = (result.data as string[][])
      .slice(1)
      .filter((row) => Array.isArray(row) && row.length >= 3);
    if (rows.length === 0) {
      return {
        status: "ok",
        summary: `No archived captures for ${host} — the page is either very new, blocked from crawlers or never linked publicly.`,
        evidence: [
          makeEvidence(skill, "Snapshots", "none found", {
            source: cdxSrc,
            confidence: "probable",
          }),
        ],
        entities: [],
        sources: [cdxSrc],
      };
    }

    const timestamps = rows.map((row) => row[0]).sort();
    const first = timestamps[0];
    const last = timestamps[timestamps.length - 1];
    const errors = rows.filter((row) => row[2] && !row[2].startsWith("2"));
    const years = Array.from(new Set(timestamps.map((value) => value.slice(0, 4))));

    const formatStamp = (value: string) =>
      `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)} ${value.slice(8, 10)}:${value.slice(10, 12)}Z`;

    return {
      status: "ok",
      summary: `${rows.length} captures sampled between ${formatStamp(first)} and ${formatStamp(last)} across ${years.length} year(s).`,
      evidence: [
        makeEvidence(skill, "First capture", formatStamp(first), {
          source: cdxSrc,
          detail: "The page existed at least this early — useful for dating an asset.",
        }),
        makeEvidence(skill, "Latest capture", formatStamp(last), { source: cdxSrc }),
        makeEvidence(skill, "Active years", years.join(", "), {
          source: cdxSrc,
          raw: years,
        }),
        makeEvidence(skill, "Sampled snapshots", String(rows.length), {
          source: cdxSrc,
          kind: "metric",
        }),
        ...(errors.length > 0
          ? [
              makeEvidence(
                skill,
                "Non-success captures",
                errors
                  .slice(0, 8)
                  .map((row) => `${row[0].slice(0, 8)} → ${row[2]}`)
                  .join(" · "),
                {
                  source: cdxSrc,
                  severity: "low",
                  detail: "Outage windows or access blocks recorded by the crawler.",
                },
              ),
            ]
          : []),
        makeEvidence(
          skill,
          "Timeline entry point",
          `https://web.archive.org/web/${first}/${host}`,
          { source: cdxSrc, kind: "reference" },
        ),
      ],
      entities: [
        entity(skill, "domain", host, "Archived host"),
        entity(
          skill,
          "date",
          formatStamp(first),
          "First archival capture",
          [],
          "confirmed",
        ),
      ],
      sources: [cdxSrc],
    };
  },
};

/* ------------------------------ IP registry ---------------------------- */

interface RdapIp {
  handle?: string;
  name?: string;
  startAddress?: string;
  endAddress?: string;
  country?: string;
  type?: string;
  ipVersion?: string;
  parentHandle?: string;
  events?: Array<{ eventAction: string; eventDate: string }>;
  entities?: Array<{
    handle?: string;
    roles?: string[];
    vcardArray?: [string, Array<[string, unknown, string, unknown]>];
  }>;
  remarks?: Array<{ description?: string[] }>;
}

function orgName(rdap: RdapIp): string | undefined {
  for (const item of rdap.entities ?? []) {
    const vcard = item.vcardArray?.[1];
    const fn = vcard?.find((entry) => entry[0] === "fn")?.[3];
    if (typeof fn === "string" && fn) {
      return fn;
    }
  }
  return undefined;
}

export const ipRegistry: SkillDefinition = {
  id: "ip-registry",
  name: "IP registry record",
  short: "Registry",
  description:
    "Reads the authoritative RIR record for an address block: allocation name, organisation, country, registration and update events, and the parent allocation.",
  category: "infrastructure",
  runtime: "live",
  accepts: ["ip"],
  produces: ["network-block", "organisation", "allocation-date"],
  keywords: [
    "registry",
    "rir",
    "arin",
    "ripe",
    "apnic",
    "allocation",
    "whois ip",
    "netblock",
    "owner",
  ],
  clientFallback: true,
  async run(target, ctx) {
    const skill = "ip-registry";
    const address = target.value.trim();
    const rdapSrc = source(
      "rdap:ip",
      "RDAP bootstrap registry for addresses (rdap.org)",
      `https://rdap.org/ip/${address}`,
      "registry",
    );
    const result = await request<RdapIp>(
      `https://rdap.org/ip/${encodeURIComponent(address)}`,
      ctx,
      {
        accept: "application/rdap+json, application/json",
        timeoutMs: 10000,
      },
    );

    if (!result.ok) {
      return {
        status: result.error.code === "egress_blocked" ? "unreachable" : "error",
        summary: `Registry lookup failed: ${result.error.message}`,
        evidence: [],
        entities: [],
        sources: [rdapSrc],
        error: result.error,
      };
    }

    const data = result.data;
    const allocation = (data.events ?? []).find(
      (event) => event.eventAction === "registration",
    );
    const updated = (data.events ?? []).find(
      (event) => event.eventAction === "last changed",
    );
    const organisation = orgName(data);

    return {
      status: "ok",
      summary: `${address} belongs to ${data.name ?? organisation ?? "an unannounced block"}${data.country ? ` (${data.country})` : ""}.`,
      evidence: [
        makeEvidence(skill, "Network name", data.name ?? "not published", {
          source: rdapSrc,
        }),
        makeEvidence(skill, "Organisation", organisation ?? "not published", {
          source: rdapSrc,
        }),
        makeEvidence(
          skill,
          "Address block",
          `${data.startAddress ?? "?"} – ${data.endAddress ?? "?"} (IPv${data.ipVersion ?? "?"})`,
          { source: rdapSrc },
        ),
        makeEvidence(skill, "Registry country", data.country ?? "not published", {
          source: rdapSrc,
        }),
        makeEvidence(
          skill,
          "Allocation type",
          data.type ?? data.handle ?? "not published",
          { source: rdapSrc },
        ),
        makeEvidence(skill, "Registered", allocation?.eventDate ?? "not published", {
          source: rdapSrc,
        }),
        makeEvidence(skill, "Last changed", updated?.eventDate ?? "not published", {
          source: rdapSrc,
        }),
        ...((data.remarks ?? []).length > 0
          ? [
              makeEvidence(
                skill,
                "Registry remarks",
                (data.remarks ?? [])
                  .flatMap((remark) => remark.description ?? [])
                  .slice(0, 3)
                  .join(" · "),
                { source: rdapSrc },
              ),
            ]
          : []),
      ],
      entities: [
        entity(skill, "ip", address, "Query address"),
        ...(data.name
          ? [
              entity(
                skill,
                "asn",
                data.name,
                "Allocation name",
                attrs({ country: data.country ?? "" }),
                "probable",
              ),
            ]
          : []),
        ...(allocation
          ? [
              entity(
                skill,
                "date",
                allocation.eventDate,
                "Block allocated",
                [],
                "confirmed",
              ),
            ]
          : []),
      ],
      sources: [rdapSrc],
    };
  },
};

/* --------------------------- Reference lab ----------------------------- */

function decodeBase64Url(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const withPadding = padded + "=".repeat((4 - (padded.length % 4)) % 4);
  if (typeof atob === "function") {
    return atob(withPadding);
  }
  return Buffer.from(withPadding, "base64").toString("utf8");
}

export const referenceLab: SkillDefinition = {
  id: "reference-lab",
  name: "Identifier & encoding lab",
  short: "Decoder",
  description:
    "Decodes embedded identifiers: JWT claims (without asserting signature validity), MongoDB ObjectId and UUID timestamps, Unix timestamps, base64/hex payloads and URL-encoded strings.",
  category: "tradecraft",
  runtime: "local",
  accepts: ["text", "hash"],
  produces: ["decoded-identifiers", "embedded-timestamps"],
  keywords: [
    "jwt",
    "token",
    "decode",
    "base64",
    "objectid",
    "uuid",
    "timestamp",
    "encoding",
    "id",
    "mongo",
  ],
  clientFallback: true,
  async run(target) {
    const skill = "reference-lab";
    const localSrc = source(
      "local:decoders",
      "Bundled identifier decoders (offline)",
      undefined,
      "local",
    );
    const input = target.raw.trim();
    const evidenceItems: Evidence[] = [];
    const entities = [];

    const jwt = input.match(
      /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{0,}/,
    );
    if (jwt) {
      try {
        const [headerPart, payloadPart] = jwt[0].split(".");
        const header = JSON.parse(decodeBase64Url(headerPart));
        const payload = JSON.parse(decodeBase64Url(payloadPart));
        evidenceItems.push(
          makeEvidence(
            skill,
            "JWT header",
            `alg=${header.alg ?? "?"}, typ=${header.typ ?? "?"}, kid=${header.kid ?? "none"}`,
            {
              source: localSrc,
              raw: header,
              severity:
                header.alg === "none" || header.alg === "HS256" ? "medium" : "info",
              detail:
                header.alg === "none"
                  ? "alg=none means the token is unsigned — any party can forge it."
                  : header.alg === "HS256"
                    ? "HMAC-signed: a weak or leaked secret makes tokens forgeable."
                    : "Asymmetric signature declared.",
            },
          ),
          makeEvidence(
            skill,
            "JWT claims",
            Object.entries(payload)
              .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
              .join(" · "),
            {
              source: localSrc,
              raw: payload,
            },
          ),
          makeEvidence(skill, "Signature", "not verified — no key available", {
            source: localSrc,
            kind: "warning",
            confidence: "unknown",
            detail:
              "Claims are readable by anyone; only a signature check with the issuer's key proves authenticity.",
          }),
        );
        for (const [key, value] of Object.entries(payload)) {
          if (
            typeof value === "string" &&
            /email|mail/.test(key) &&
            value.includes("@")
          ) {
            entities.push(
              entity(skill, "email", value, `JWT claim ${key}`, [], "probable"),
            );
          }
          if (
            typeof value === "string" &&
            /sub|user|uid|username|preferred_username|name/i.test(key)
          ) {
            entities.push(
              entity(skill, "username", value, `JWT claim ${key}`, [], "probable"),
            );
          }
          if (/exp|iat|nbf|auth_time/.test(key) && typeof value === "number") {
            entities.push(
              entity(
                skill,
                "date",
                new Date(value * 1000).toISOString(),
                `JWT ${key}`,
                [],
                "confirmed",
              ),
            );
          }
        }
      } catch {
        evidenceItems.push(
          makeEvidence(
            skill,
            "JWT",
            "looks like a token but the payload did not decode as JSON",
            {
              source: localSrc,
              confidence: "unknown",
              kind: "warning",
            },
          ),
        );
      }
    }

    const objectId = input.match(/\b[0-9a-f]{24}\b/i);
    if (objectId) {
      const timestamp = Number.parseInt(objectId[0].slice(0, 8), 16) * 1000;
      const date = new Date(timestamp);
      evidenceItems.push(
        makeEvidence(skill, "MongoDB ObjectId", objectId[0], {
          source: localSrc,
          detail: `First four bytes are a Unix timestamp: created ${date.toISOString()}. Counter bytes ${objectId[0].slice(18)} identify the generating process.`,
        }),
      );
      entities.push(
        entity(
          skill,
          "date",
          date.toISOString(),
          "ObjectId creation time",
          [],
          "confirmed",
        ),
      );
    }

    const uuid = input.match(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-([1-7])[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
    );
    if (uuid) {
      const version = uuid[1];
      let derived: string | undefined;
      if (version === "1") {
        const timeHigh = uuid[0].slice(15, 18);
        const timeLow = uuid[0].slice(0, 8);
        const mid = uuid[0].slice(9, 13);
        const ticks =
          Number.parseInt(`${timeHigh}${mid}${timeLow}`, 16) - 122192928000000000;
        derived = new Date(ticks / 10000).toISOString();
      } else if (version === "7") {
        derived = new Date(
          Number.parseInt(uuid[0].replace(/-/g, "").slice(0, 12), 16),
        ).toISOString();
      }
      evidenceItems.push(
        makeEvidence(skill, "UUID", uuid[0], {
          source: localSrc,
          detail: derived
            ? `Version ${version}; embeds creation time ${derived}.`
            : `Version ${version}; no embedded timestamp in this version (v3/v5 are name-based hashes).`,
        }),
      );
      if (derived) {
        entities.push(
          entity(skill, "date", derived, "UUID creation time", [], "probable"),
        );
      }
    }

    const unix = input.match(/(?:^|\D)(1[0-9]{9}|1[0-9]{12})(?:\D|$)/);
    if (unix && !objectId) {
      const value = Number(unix[1]);
      const milliseconds = unix[1].length === 13 ? value : value * 1000;
      const date = new Date(milliseconds);
      if (date.getFullYear() > 2001 && date.getFullYear() < 2100) {
        evidenceItems.push(
          makeEvidence(
            skill,
            "Unix timestamp",
            `${unix[1]} → ${date.toISOString()} (UTC)`,
            {
              source: localSrc,
              detail: "Interpreted as seconds unless 13 digits, which is milliseconds.",
            },
          ),
        );
        entities.push(
          entity(skill, "date", date.toISOString(), "Decoded timestamp", [], "probable"),
        );
      }
    }

    const base64 = input.match(/^(?:[A-Za-z0-9+/]{16,}={0,2})$/);
    if (base64) {
      try {
        const decoded =
          typeof atob === "function"
            ? atob(base64[0])
            : Buffer.from(base64[0], "base64").toString("binary");
        const printable = decoded.replace(/[^\x20-\x7e]/g, "");
        evidenceItems.push(
          makeEvidence(
            skill,
            "Base64 decode",
            printable.length > 10 ? printable.slice(0, 300) : "(binary payload)",
            {
              source: localSrc,
              raw: decoded.slice(0, 500),
              confidence:
                printable.length / Math.max(decoded.length, 1) > 0.8
                  ? "confirmed"
                  : "possible",
            },
          ),
        );
      } catch {
        /* not base64 after all */
      }
    }

    if (/%[0-9a-f]{2}/i.test(input)) {
      try {
        evidenceItems.push(
          makeEvidence(skill, "URL decode", decodeURIComponent(input).slice(0, 300), {
            source: localSrc,
          }),
        );
      } catch {
        /* invalid escape sequence */
      }
    }

    if (evidenceItems.length === 0) {
      return {
        status: "partial",
        summary: "Nothing in the input matched a decodable identifier.",
        evidence: [
          makeEvidence(
            skill,
            "Decoders tried",
            "JWT, ObjectId, UUID v1-v7, Unix time, base64, URL encoding",
            {
              source: localSrc,
              kind: "fact",
            },
          ),
        ],
        entities: [],
        sources: [localSrc],
      };
    }

    return {
      status: "ok",
      summary: `Decoded ${evidenceItems.length} embedded identifier detail(s).`,
      evidence: evidenceItems,
      entities,
      sources: [localSrc],
    };
  },
};

/* ----------------------- Keyed search (transparent) -------------------- */

export const webSearch: SkillDefinition = {
  id: "web-search",
  name: "Web & news search",
  short: "Search",
  description:
    "Runs keyword searches across the open web and news indexes. Requires SEARCH_API_KEY (Brave Search or any Bing-compatible endpoint); without a key it declares itself unavailable rather than inventing hits.",
  category: "knowledge",
  runtime: "live",
  accepts: ["text", "person", "organisation"],
  produces: ["results", "news"],
  keywords: [
    "search",
    "google",
    "news",
    "find",
    "articles",
    "mentions",
    "press",
    "reports",
  ],
  clientFallback: false,
  requiresKey: ["SEARCH_API_KEY"],
  async run(target, ctx) {
    const skill = "web-search";
    const key = ctx.env("SEARCH_API_KEY");
    const endpoint =
      ctx.env("SEARCH_API_ENDPOINT") ?? "https://api.search.brave.com/res/v1/web/search";
    const searchSrc = source("search:brave", "Brave Search API", endpoint, "api");

    if (!key) {
      return {
        status: "blocked",
        summary:
          "Open-web search needs SEARCH_API_KEY. No query was sent and no result is presented — link-level sources (RDAP, CT logs, DNS, archives) still run without any key.",
        evidence: [
          makeEvidence(skill, "Search provider", "not configured", {
            source: searchSrc,
            kind: "warning",
            confidence: "unknown",
            detail:
              "Add SEARCH_API_KEY (and optionally SEARCH_API_ENDPOINT) to enable indexed web and news search inside the console.",
          }),
        ],
        entities: [],
        sources: [searchSrc],
        error: { code: "requires_key", message: "SEARCH_API_KEY not configured." },
      };
    }

    const query = encodeURIComponent(target.raw.slice(0, 300));
    const result = await request<{
      web?: {
        results?: Array<{
          title?: string;
          url?: string;
          description?: string;
          age?: string;
        }>;
      };
    }>(`${endpoint}?q=${query}&count=10`, ctx, {
      headers: { "x-subscription-token": key, accept: "application/json" },
      timeoutMs: 12000,
    });

    if (!result.ok) {
      return {
        status:
          result.error.status === 401 || result.error.status === 403
            ? "blocked"
            : "error",
        summary: `Search provider rejected the request: ${result.error.message}`,
        evidence: [],
        entities: [],
        sources: [searchSrc],
        error: result.error,
      };
    }

    const hits = result.data.web?.results ?? [];
    return {
      status: hits.length > 0 ? "ok" : "partial",
      summary:
        hits.length > 0
          ? `${hits.length} indexed result(s) for “${target.raw.slice(0, 80)}”.`
          : "No indexed results returned for this query.",
      evidence: hits.slice(0, 10).map((hit) =>
        makeEvidence(skill, hit.title ?? "untitled", hit.url ?? "", {
          source: searchSrc,
          detail: hit.description,
          raw: hit,
        }),
      ),
      entities: hits
        .map((hit) => (hit.url ? normalizeDomain(hit.url) : undefined))
        .filter((value): value is string => typeof value === "string" && value.length > 3)
        .slice(0, 8)
        .map((domain) =>
          entity(skill, "domain", domain, "Result domain", [], "confirmed"),
        ),
      sources: [searchSrc],
    };
  },
};

/* --------------------- Multi-host resolution check --------------------- */

export const hostResolutionSweep: SkillDefinition = {
  id: "host-resolution-sweep",
  name: "Host resolution sweep",
  short: "Sweep",
  description:
    "Resolves a list of hosts and reports which ones are live, which are parked and which no longer resolve — the fastest way to triage a subdomain list.",
  category: "network",
  runtime: "live",
  accepts: ["text", "domain"],
  produces: ["live-hosts", "dead-hosts"],
  keywords: ["sweep", "resolve", "list", "subdomains", "live", "check hosts", "bulk"],
  clientFallback: true,
  async run(target, ctx) {
    const skill = "host-resolution-sweep";
    const candidates = Array.from(
      new Set(
        (
          target.raw.match(
            /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}\b/gi,
          ) ?? []
        )
          .map((value) => normalizeDomain(value))
          .filter((value) => value.split(".").length >= 2),
      ),
    ).slice(0, 20);

    if (candidates.length < 2) {
      return {
        status: "skipped",
        summary: "Fewer than two hosts supplied for a sweep.",
        evidence: [],
        entities: [],
        sources: [],
      };
    }

    const dnsSrc = source(
      "dns:cloudflare",
      "Cloudflare 1.1.1.1 (DoH)",
      "https://cloudflare-dns.com/dns-query",
      "dns",
    );
    const live: Array<{ host: string; addresses: string[] }> = [];
    const dead: string[] = [];
    let unreachable = 0;

    await concurrency(candidates, 5, async (host) => {
      const result = await resolveDns(host, "A", ctx, 5000);
      if (!result.ok) {
        unreachable += 1;
        return null;
      }
      if (result.answers.length > 0) {
        live.push({ host, addresses: result.answers.map((answer) => answer.data) });
      } else {
        dead.push(host);
      }
      return null;
    });

    return {
      status: unreachable === candidates.length ? "unreachable" : "ok",
      summary: `${live.length} of ${candidates.length} hosts resolve; ${dead.length} do not${unreachable ? `; ${unreachable} could not be checked` : ""}.`,
      evidence: [
        makeEvidence(
          skill,
          "Live hosts",
          live.map((item) => `${item.host} → ${item.addresses.join("/")}`).join(" · ") ||
            "none",
          {
            source: dnsSrc,
            raw: live,
          },
        ),
        makeEvidence(skill, "Non-resolving hosts", dead.join(" · ") || "none", {
          source: dnsSrc,
          raw: dead,
        }),
        ...(unreachable > 0
          ? [
              makeEvidence(
                skill,
                "Unchecked",
                `${unreachable} host(s) could not be queried`,
                {
                  source: dnsSrc,
                  kind: "warning",
                  confidence: "unknown",
                },
              ),
            ]
          : []),
      ],
      entities: live.flatMap((item) => [
        entity(skill, "subdomain", item.host, "Live host"),
        ...item.addresses
          .slice(0, 2)
          .map((ip) =>
            entity(skill, "ip", ip, `Address for ${item.host}`, [], "confirmed"),
          ),
      ]),
      sources: [dnsSrc],
    };
  },
};

export const knowledgeSkills: SkillDefinition[] = [
  urlStructure,
  archiveHistory,
  ipRegistry,
  referenceLab,
  hostResolutionSweep,
  webSearch,
];
