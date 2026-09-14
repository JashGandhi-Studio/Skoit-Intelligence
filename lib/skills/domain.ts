import {
  answerValues,
  type DNS_TYPE,
  DNS_TYPE_NAME,
  dnsSource,
  resolveDns,
  txtRecords,
} from "@/lib/net/dns";
import { concurrency, request, source } from "@/lib/net/http";
import { entity, evidence } from "@/lib/skills/emit";
import { apexOf, looksLikeDomain, normalizeDomain } from "@/lib/skills/identify";
import type { DetectedTarget, SkillDefinition, SkillOutcome } from "@/lib/types";

const RISKY_PORTS: Record<number, string> = {
  21: "FTP (cleartext file transfer)",
  23: "Telnet (unencrypted shell)",
  25: "SMTP relay",
  111: "rpcbind",
  135: "MSRPC",
  139: "NetBIOS",
  445: "SMB file sharing",
  1433: "MSSQL",
  1521: "Oracle DB",
  2375: "Docker daemon (unauthenticated API)",
  3306: "MySQL",
  3389: "RDP remote desktop",
  5432: "PostgreSQL",
  5900: "VNC",
  6379: "Redis",
  9200: "Elasticsearch",
  11211: "memcached",
  27017: "MongoDB",
};

/* ----------------------------- DNS intel ------------------------------ */

export const dnsIntel: SkillDefinition = {
  id: "dns-intel",
  name: "DNS intelligence",
  short: "DNS",
  description:
    "Resolves A, AAAA, MX, NS, TXT, CNAME, CAA and SOA records over DNS-over-HTTPS and lists nameservers and mail routes.",
  category: "network",
  runtime: "live",
  accepts: ["domain"],
  produces: ["records", "nameservers", "mail-routes"],
  keywords: ["dns", "resolve", "nameserver", "mx", "record", "nameserver", "zone"],
  clientFallback: true,
  async run(target, ctx) {
    const domain = apexOf(target.value);
    const skill = "dns-intel";
    const types: Array<keyof typeof DNS_TYPE> = [
      "A",
      "AAAA",
      "MX",
      "NS",
      "TXT",
      "CAA",
      "SOA",
    ];
    const collected: Array<{ type: keyof typeof DNS_TYPE; values: string[] }> = [];
    const sources = new Map<string, ReturnType<typeof dnsSource>>();
    let lastError: SkillOutcome["error"];
    let resolver = "cloudflare";

    for (const type of types) {
      const result = await resolveDns(domain, type, ctx);
      resolver = result.resolver;
      if (!result.ok) {
        lastError = result.error;
        continue;
      }
      sources.set(result.resolver, dnsSource(result.resolver));
      const values = answerValues(result.answers);
      if (values.length > 0) {
        collected.push({ type, values });
      }
    }

    if (collected.length === 0) {
      return {
        status: lastError ? "unreachable" : "ok",
        summary: lastError
          ? `Could not reach a DoH resolver: ${lastError.message}`
          : `${domain} resolves to no records — likely unregistered or parked.`,
        evidence: [
          evidence(skill, "Zone state", lastError ? "Unverified" : "No records", {
            source: sources.get(resolver) ?? dnsSource(resolver),
            confidence: lastError ? "unknown" : "probable",
            detail: lastError?.message,
          }),
        ],
        entities: [],
        sources: Array.from(sources.values()),
        error: lastError,
      };
    }

    const dnsSrc = sources.get(resolver) ?? dnsSource(resolver);
    const values = collected.flatMap((item) => item.values);
    const mailHosts = answerValues(
      (await resolveDns(domain, "MX", ctx)).answers ?? [],
      "MX",
    ).map((value) => value.split(" ").pop() ?? value);

    return {
      status: "ok",
      summary: `${domain} → ${values.length} records across ${collected.map((item) => item.type).join(", ")}.`,
      evidence: collected.map((item) =>
        evidence(skill, `${item.type} records`, item.values.join(" · "), {
          source: dnsSrc,
          raw: item.values,
        }),
      ),
      entities: [
        entity(skill, "domain", domain, "Apex domain"),
        ...collected
          .filter((item) => item.type === "A")
          .flatMap((item) => item.values)
          .slice(0, 4)
          .map((ip) => entity(skill, "ip", ip, "Hosting address", [])),
        ...mailHosts
          .slice(0, 4)
          .map((host) => entity(skill, "domain", host, "Mail exchanger", [], "probable")),
      ].filter((item) => item.value),
      sources: Array.from(sources.values()),
    };
  },
};

/* -------------------------- Domain registration ------------------------ */

interface RdapEntity {
  roles?: string[];
  vcardArray?: [string, Array<[string, unknown, string, unknown]>];
  handle?: string;
}

interface RdapDomain {
  ldhName?: string;
  unicodeName?: string;
  status?: string[];
  events?: Array<{ eventAction: string; eventDate: string }>;
  nameservers?: Array<{ ldhName?: string }>;
  secureDNS?: { delegationSigned?: boolean };
  entities?: RdapEntity[];
  status_?: string;
}

function vcardValue(entity: RdapEntity, key: string): string | undefined {
  const vcard = entity.vcardArray?.[1];
  if (!Array.isArray(vcard)) {
    return undefined;
  }
  const entry = vcard.find((item) => item[0] === key);
  if (!entry) {
    return undefined;
  }
  const value = entry[3];
  if (Array.isArray(value)) {
    return value.filter(Boolean).join(", ");
  }
  return typeof value === "string" ? value : undefined;
}

export const domainRegistration: SkillDefinition = {
  id: "domain-registration",
  name: "Registration & ownership",
  short: "WHOIS",
  description:
    "Pulls authoritative registration data from RDAP: registrar, creation and expiry events, EPP status flags, abuse contacts and DNSSEC signing state.",
  category: "infrastructure",
  runtime: "live",
  accepts: ["domain"],
  produces: ["registrar", "events", "contacts", "status"],
  keywords: [
    "whois",
    "rdap",
    "registrar",
    "ownership",
    "created",
    "expiry",
    "expires",
    "owner",
  ],
  clientFallback: true,
  async run(target, ctx) {
    const domain = apexOf(target.value);
    const skill = "domain-registration";
    const rdapSrc = source(
      "rdap:domain",
      "RDAP bootstrap registry (rdap.org)",
      `https://rdap.org/domain/${domain}`,
      "registry",
    );
    const result = await request<RdapDomain>(
      `https://rdap.org/domain/${encodeURIComponent(domain)}`,
      ctx,
      {
        accept: "application/rdap+json, application/json",
        timeoutMs: 9000,
      },
    );

    if (!result.ok) {
      return {
        status: result.error.code === "egress_blocked" ? "unreachable" : "error",
        summary:
          result.error.code === "egress_blocked"
            ? "RDAP registry unreachable from this runtime."
            : `RDAP lookup failed: ${result.error.message}`,
        evidence: [],
        entities: [],
        sources: [rdapSrc],
        error: result.error,
      };
    }

    const data = result.data;
    const registrar = data.entities?.find((item) => item.roles?.includes("registrar"));
    const abuse = data.entities?.find((item) => item.roles?.includes("abuse"));
    const events = data.events ?? [];
    const created = events.find((event) => event.eventAction === "registration");
    const expires = events.find((event) => event.eventAction === "expiration");
    const changed = events.find((event) => event.eventAction === "last changed");

    const evidenceItems = [
      registrar
        ? evidence(
            skill,
            "Registrar",
            vcardValue(registrar, "fn") ?? registrar.handle ?? "Listed in RDAP",
            { source: rdapSrc },
          )
        : evidence(
            skill,
            "Registrar",
            "Not published — registry redacts or domain is not delegated",
            {
              source: rdapSrc,
              confidence: "possible",
            },
          ),
      created
        ? evidence(skill, "Registered", created.eventDate, { source: rdapSrc })
        : evidence(skill, "Registered", "Not published", {
            source: rdapSrc,
            confidence: "unknown",
          }),
      expires
        ? evidence(skill, "Expires", expires.eventDate, { source: rdapSrc })
        : evidence(skill, "Expires", "Not published", {
            source: rdapSrc,
            confidence: "unknown",
          }),
      changed
        ? evidence(skill, "Last changed", changed.eventDate, { source: rdapSrc })
        : evidence(skill, "Last changed", "Not published", {
            source: rdapSrc,
            confidence: "unknown",
          }),
      evidence(
        skill,
        "Status flags",
        (data.status ?? []).join(" · ") || "none published",
        {
          source: rdapSrc,
        },
      ),
      evidence(
        skill,
        "DNSSEC",
        data.secureDNS?.delegationSigned ? "Signed (delegation signed)" : "Not signed",
        {
          source: rdapSrc,
          severity: data.secureDNS?.delegationSigned ? "info" : "low",
          detail: data.secureDNS?.delegationSigned
            ? undefined
            : "Unsigned zones are trivially spoofable in cache-poisoning scenarios.",
        },
      ),
      evidence(
        skill,
        "Name servers",
        (data.nameservers ?? [])
          .map((item) => item.ldhName?.toLowerCase())
          .filter(Boolean)
          .join(" · ") || "none published",
        { source: rdapSrc },
      ),
      ...(abuse
        ? [
            evidence(
              skill,
              "Abuse contact",
              vcardValue(abuse, "email") ?? vcardValue(abuse, "fn") ?? "listed",
              { source: rdapSrc },
            ),
          ]
        : []),
    ];

    return {
      status: "ok",
      summary: `${domain}: ${registrar ? `registrar ${vcardValue(registrar, "fn") ?? "listed"}` : "registrar redacted"}${created ? `, registered ${created.eventDate.slice(0, 10)}` : ""}.`,
      evidence: evidenceItems,
      entities: [
        entity(skill, "domain", domain, "Registered domain"),
        ...(created
          ? [
              entity(
                skill,
                "date",
                created.eventDate,
                "Domain registered",
                [],
                "confirmed",
              ),
            ]
          : []),
        ...(expires
          ? [entity(skill, "date", expires.eventDate, "Domain expires", [], "confirmed")]
          : []),
      ],
      sources: [rdapSrc],
    };
  },
};

/* -------------------- Certificate transparency pivot ------------------- */

interface CrtShEntry {
  issuer_name?: string;
  common_name?: string;
  name_value?: string;
  not_before?: string;
  not_after?: string;
  entry_timestamp?: string;
}

export const certificateTransparency: SkillDefinition = {
  id: "certificate-transparency",
  name: "Certificate transparency",
  short: "CT logs",
  description:
    "Reads public CT logs to enumerate subdomains that ever received a TLS certificate, plus the issuing CAs.",
  category: "infrastructure",
  runtime: "live",
  accepts: ["domain"],
  produces: ["subdomains", "issuers", "certificates"],
  keywords: ["subdomain", "ct", "certificate", "crt", "attack surface", "asset", "san"],
  clientFallback: true,
  async run(target, ctx) {
    const domain = apexOf(target.value);
    const skill = "certificate-transparency";
    const crtSrc = source(
      "ct:crt.sh",
      "crt.sh certificate transparency search",
      `https://crt.sh/?q=${domain}`,
      "api",
    );

    ctx.log(`Querying CT logs for %.${domain}`);
    const result = await request<CrtShEntry[]>(
      `https://crt.sh/?q=%25.${encodeURIComponent(domain)}&output=json&exclude=expired&deduplicate=Y`,
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
          ? "CT log returned no parsable payload."
          : `CT log unreachable: ${result.error.message}`,
        evidence: [],
        entities: [],
        sources: [crtSrc],
        error: result.ok
          ? { code: "parse", message: "Unparsable CT response." }
          : result.error,
      };
    }

    const rows = result.data as CrtShEntry[];
    const names = new Set<string>();
    const issuers = new Set<string>();
    let earliest: string | undefined;

    for (const row of rows) {
      for (const name of (row.name_value ?? "").split("\n")) {
        const clean = name.trim().toLowerCase().replace(/^\*\./, "");
        if (clean.endsWith(domain) && clean !== domain && clean.includes(".")) {
          names.add(clean);
        }
      }
      if (row.issuer_name) {
        const short = row.issuer_name.match(/O=([^,]+)/)?.[1] ?? row.issuer_name;
        issuers.add(short.trim());
      }
      if (row.not_before && (!earliest || row.not_before < earliest)) {
        earliest = row.not_before;
      }
    }

    const sorted = Array.from(names).sort();
    const subdomains = sorted.slice(0, 60);
    const interesting = subdomains.filter((name) =>
      /(admin|staging|dev|test|internal|vpn|jenkins|git|jira|db|api|mail|sso|portal|old|backup)/.test(
        name,
      ),
    );

    return {
      status: names.size > 0 ? "ok" : "partial",
      summary:
        names.size > 0
          ? `${names.size} distinct subdomain names in CT logs (${interesting.length} flagged as sensitive-looking).`
          : "No certificate transparency entries found — domain may be new or not publicly certified.",
      evidence: [
        evidence(skill, "Certificates observed", String(rows.length), { source: crtSrc }),
        evidence(skill, "Subdomains discovered", String(names.size), {
          source: crtSrc,
          raw: subdomains,
        }),
        evidence(
          skill,
          "Issuing CAs",
          Array.from(issuers).slice(0, 8).join(" · ") || "unknown",
          {
            source: crtSrc,
          },
        ),
        evidence(skill, "Earliest certificate", earliest?.slice(0, 10) ?? "unknown", {
          source: crtSrc,
        }),
        ...(interesting.length > 0
          ? [
              evidence(skill, "Sensitive-looking hosts", interesting.join(" · "), {
                source: crtSrc,
                severity: "medium",
                detail:
                  "Names containing admin/staging/vpn/git are frequent pivots for exposed tooling. Confirm reachability before treating as live.",
              }),
            ]
          : []),
      ],
      entities: [
        ...subdomains
          .slice(0, 24)
          .map((name) =>
            entity(skill, "subdomain", name, "Subdomain (CT)", [], "confirmed"),
          ),
        ...(earliest
          ? [entity(skill, "date", earliest, "First certificate issued", [], "confirmed")]
          : []),
      ],
      sources: [crtSrc],
    };
  },
};

/* --------------------------- Posture review --------------------------- */

const DKIM_SELECTORS = [
  "default",
  "google",
  "selector1",
  "selector2",
  "s1",
  "s2",
  "k1",
  "mail",
  "dkim",
  "mandrill",
  "sendgrid",
];

export const dnsPosture: SkillDefinition = {
  id: "dns-posture",
  name: "Email & DNS posture",
  short: "Posture",
  description:
    "Audits SPF, DMARC policy strength, DKIM selector publication, CAA constraints and security.txt / robots.txt exposure.",
  category: "tradecraft",
  runtime: "live",
  accepts: ["domain", "email"],
  produces: ["spf", "dmarc", "dkim", "caa", "policy-files"],
  keywords: [
    "spf",
    "dmarc",
    "dkim",
    "posture",
    "spoof",
    "phishing",
    "email security",
    "caa",
  ],
  clientFallback: true,
  async run(target, ctx) {
    const domain =
      target.kind === "email"
        ? normalizeDomain(target.value.split("@")[1] ?? "")
        : apexOf(target.value);
    const skill = "dns-posture";
    const dnsSrc = dnsSource("cloudflare");

    const [spfResult, dmarcResult, caaResult] = await Promise.all([
      resolveDns(domain, "TXT", ctx),
      resolveDns(`_dmarc.${domain}`, "TXT", ctx),
      resolveDns(domain, "CAA", ctx),
    ]);

    if (!spfResult.ok && !dmarcResult.ok) {
      return {
        status: spfResult.error?.code === "egress_blocked" ? "unreachable" : "error",
        summary: "DNS lookups for posture records failed in this runtime.",
        evidence: [],
        entities: [],
        sources: [dnsSrc],
        error: spfResult.error,
      };
    }

    const spf = txtRecords(spfResult.answers).find((value) => value.startsWith("v=spf1"));
    const dmarc = txtRecords(dmarcResult.answers).find((value) =>
      value.startsWith("v=DMARC1"),
    );
    const dmarcPolicy = dmarc?.match(/p=(\w+)/)?.[1] ?? "none";
    const dmarcStrict = /p=(reject|quarantine)/.test(dmarc ?? "");
    const spfHardFail = /-all/.test(spf ?? "");
    const _spfSoftFail = /~all/.test(spf ?? "");

    const dkimFound: string[] = [];
    await concurrency(DKIM_SELECTORS, 4, async (selector) => {
      const result = await resolveDns(`${selector}._domainkey.${domain}`, "TXT", ctx);
      if (
        result.ok &&
        txtRecords(result.answers).some((value) => /v=DKIM1|k=rsa|p=/.test(value))
      ) {
        dkimFound.push(selector);
      }
      return null;
    });

    const [securityTxt, robotsTxt] = await Promise.all([
      request<string>(`https://${domain}/.well-known/security.txt`, ctx, {
        parse: "text",
        timeoutMs: 6000,
        retries: 0,
      }),
      request<string>(`https://${domain}/robots.txt`, ctx, {
        parse: "text",
        timeoutMs: 6000,
        retries: 0,
      }),
    ]);

    const caa = answerValues(caaResult.answers);
    const disallow =
      securityTxt.ok || robotsTxt.ok
        ? (robotsTxt.ok ? (robotsTxt.data.match(/Disallow:\s*(\S+)/g) ?? []) : []).slice(
            0,
            6,
          )
        : [];

    const findings = [
      evidence(skill, "SPF policy", spf ?? "not published", {
        source: dnsSrc,
        severity: !spf ? "high" : spfHardFail ? "info" : "medium",
        confidence: spf ? "confirmed" : "probable",
        detail: !spf
          ? "Without SPF any host may claim to send mail as this domain."
          : spfHardFail
            ? "Hard fail (-all) is the strongest SPF qualifier."
            : "Soft fail (~all) permits spoofed mail to be delivered but marked.",
      }),
      evidence(skill, "DMARC policy", dmarc ?? "not published", {
        source: dnsSrc,
        severity: !dmarc ? "high" : dmarcStrict ? "info" : "medium",
        confidence: dmarc ? "confirmed" : "probable",
        detail: !dmarc
          ? "No DMARC record: receivers get no instruction on authentication failures."
          : `p=${dmarcPolicy}; rua aggregation present: ${/rua=/.test(dmarc) ? "yes" : "no"}.`,
      }),
      evidence(
        skill,
        "DKIM selectors",
        dkimFound.length > 0
          ? dkimFound.join(" · ")
          : "none found among common selectors",
        {
          source: dnsSrc,
          confidence: dkimFound.length > 0 ? "confirmed" : "possible",
          detail:
            "Selectors can be custom; absence here is not proof that DKIM is unused.",
        },
      ),
      evidence(skill, "CAA records", caa.join(" · ") || "not published", {
        source: dnsSrc,
        severity: caa.length > 0 ? "info" : "low",
        detail: caa.length
          ? "CAA constrains which CAs may issue for this domain."
          : "No CAA: any public CA may issue a certificate for this name.",
      }),
      ...(disallow.length > 0
        ? [
            evidence(skill, "robots.txt disallow paths", disallow.join(" · "), {
              source: source(
                "http:robots",
                `robots.txt on ${domain}`,
                `https://${domain}/robots.txt`,
                "document",
              ),
              severity: "low",
              detail:
                "Disallowed paths are a classic hint at unlisted admin/section routes.",
            }),
          ]
        : []),
      ...(securityTxt.ok
        ? [
            evidence(skill, "security.txt", securityTxt.data.slice(0, 240), {
              source: source(
                "http:securitytxt",
                `security.txt on ${domain}`,
                `https://${domain}/.well-known/security.txt`,
                "document",
              ),
            }),
          ]
        : []),
    ];

    return {
      status: "ok",
      summary: `Posture for ${domain}: SPF ${spf ? (spfHardFail ? "hard-fail" : "soft") : "missing"}, DMARC ${dmarc ? dmarcPolicy : "missing"}, DKIM ${dkimFound.length || "unconfirmed"} selector(s), CAA ${caa.length ? "set" : "absent"}.`,
      evidence: findings,
      entities: [entity(skill, "domain", domain, "Audited domain")],
      sources: [dnsSrc],
    };
  },
};

/* ---------------------------- Typosquatting --------------------------- */

const HOMOGLYPHS: Record<string, string[]> = {
  a: ["4", "@", "а"],
  b: ["6", "ь"],
  c: ["с"],
  d: ["cl"],
  e: ["3", "е"],
  g: ["9", "q"],
  i: ["1", "l", "і"],
  l: ["1", "i"],
  m: ["rn", "м"],
  n: ["п"],
  o: ["0", "о"],
  p: ["р"],
  r: ["г"],
  s: ["5", "$"],
  t: ["7"],
  u: ["ц"],
  v: ["ѵ"],
  w: ["vv"],
  x: ["х"],
  y: ["у"],
  z: ["2"],
};

const SUSPICIOUS_TLDS = [
  "top",
  "xyz",
  "click",
  "link",
  "work",
  "support",
  "live",
  "buzz",
  "cyou",
  "rest",
  "shop",
  "monster",
  "lol",
  "quest",
  "cfd",
  "sbs",
  "cam",
  "beauty",
  "autos",
  "bond",
  "gq",
  "tk",
  "ml",
  "cf",
  "zip",
  "mov",
];

function hyphenize(label: string): string[] {
  if (label.length < 5) {
    return [];
  }
  const out: string[] = [];
  for (let i = 2; i < Math.min(label.length - 1, 6); i += 1) {
    out.push(`${label.slice(0, i)}-${label.slice(i)}`);
  }
  return out;
}

export function generatePermutations(
  domain: string,
  limit = 40,
): Array<{ value: string; method: string }> {
  const apex = apexOf(domain);
  const [label, ...restSuffix] = apex.split(".");
  const suffix = restSuffix.join(".");
  const out = new Map<string, string>();

  const push = (value: string, method: string) => {
    if (value !== apex && looksLikeDomain(value) && !out.has(value)) {
      out.set(value, method);
    }
  };

  if (label.length > 2) {
    for (let i = 0; i < label.length; i += 1) {
      push(`${label.slice(0, i)}${label.slice(i + 1)}.${suffix}`, "character omission");
      if (i < label.length - 1) {
        push(
          `${label.slice(0, i)}${label[i + 1]}${label[i]}${label.slice(i + 2)}.${suffix}`,
          "character transposition",
        );
      }
      push(
        `${label.slice(0, i)}${label[i]}${label[i]}${label.slice(i + 1)}.${suffix}`,
        "character duplication",
      );
    }
    for (const candidate of hyphenize(label)) {
      push(`${candidate}.${suffix}`, "hyphen insertion");
    }
  }

  const neighbours = "qwertyuiopasdfghjklzxcvbnm";
  for (let i = 0; i < label.length; i += 1) {
    for (const char of neighbours.slice(0, 8)) {
      if (char !== label[i]) {
        push(
          `${label.slice(0, i)}${char}${label.slice(i + 1)}.${suffix}`,
          "adjacent key",
        );
      }
    }
  }

  const variants = [
    "-security",
    "-login",
    "-verify",
    "-support",
    "-help",
    "-auth",
    "-app",
    "-portal",
    "secure-",
    "my-",
    "get",
  ];
  for (const variant of variants) {
    push(
      variant.startsWith("-")
        ? `${label}${variant}.${suffix}`
        : `${variant}${label}.${suffix}`,
      "brand prefix/suffix",
    );
  }

  for (let i = 0; i < label.length; i += 1) {
    for (const glyph of HOMOGLYPHS[label[i]] ?? []) {
      push(`${label.slice(0, i)}${glyph}${label.slice(i + 1)}.${suffix}`, "homoglyph");
    }
  }

  for (const tld of SUSPICIOUS_TLDS.slice(0, 6)) {
    push(`${label}.${tld}`, "TLD swap (abuse-heavy zone)");
  }

  for (const [value, method] of out) {
    out.set(value, method);
    if (out.size >= limit) {
      break;
    }
  }

  return Array.from(out.entries())
    .slice(0, limit)
    .map(([value, method]) => ({ value, method }));
}

export const typosquatWatch: SkillDefinition = {
  id: "typosquat-watch",
  name: "Lookalike domains",
  short: "Typosquat",
  description:
    "Generates realistic lookalike permutations of a brand domain (omission, transposition, homoglyph, TLD swap) and verifies which of them are actually registered.",
  category: "tradecraft",
  runtime: "live",
  accepts: ["domain"],
  produces: ["registered-lookalikes", "homoglyphs"],
  keywords: [
    "typosquat",
    "lookalike",
    "phishing",
    "impersonation",
    "brand",
    "squat",
    "clone",
    "fake domain",
  ],
  clientFallback: true,
  async run(target, ctx) {
    const domain = apexOf(target.value);
    const skill = "typosquat-watch";
    const dnsSrc = dnsSource("cloudflare");
    const permutations = generatePermutations(domain, 36);
    ctx.log(`Testing ${permutations.length} permutations against live DNS`);

    const registered: Array<{ value: string; method: string; records: string[] }> = [];
    const unchecked: string[] = [];

    await concurrency(permutations, 6, async (candidate) => {
      const a = await resolveDns(candidate.value, "A", ctx, 5000);
      const ns =
        a.ok && a.answers.length === 0
          ? await resolveDns(candidate.value, "NS", ctx, 5000)
          : null;
      if (!a.ok && !ns) {
        unchecked.push(candidate.value);
        return null;
      }
      const records = [
        ...a.answers.map(
          (answer) => `${DNS_TYPE_NAME[answer.type] ?? answer.type} ${answer.data}`,
        ),
        ...(ns?.answers ?? []).map(
          (answer) => `${DNS_TYPE_NAME[answer.type] ?? answer.type} ${answer.data}`,
        ),
      ];
      if (records.length > 0) {
        registered.push({ ...candidate, records });
      }
      return null;
    });

    if (unchecked.length === permutations.length && registered.length === 0) {
      return {
        status: "unreachable",
        summary: "DNS resolution unavailable — lookalike verification could not run.",
        evidence: [],
        entities: [],
        sources: [dnsSrc],
        error: {
          code: "egress_blocked",
          message: "No DNS egress for permutation checks.",
        },
      };
    }

    const homoglyphHits = registered.filter((item) => item.method === "homoglyph");
    const abuseTldHits = registered.filter((item) => item.method.startsWith("TLD swap"));

    return {
      status: "ok",
      summary: `${registered.length} of ${permutations.length} generated lookalikes are registered${
        homoglyphHits.length > 0
          ? `, including ${homoglyphHits.length} homoglyph variant(s)`
          : ""
      }.`,
      evidence: [
        evidence(
          skill,
          "Registered lookalikes",
          registered.map((item) => item.value).join(" · ") || "none found",
          {
            source: dnsSrc,
            severity: registered.length > 0 ? "medium" : "info",
            raw: registered,
            detail:
              "Registration alone is not malicious intent; it is the standard first step of phishing campaigns built against a brand.",
          },
        ),
        evidence(
          skill,
          "Generation methods",
          Array.from(new Set(permutations.map((item) => item.method))).join(" · "),
          {
            source: dnsSrc,
            kind: "fact",
          },
        ),
        ...(abuseTldHits.length > 0
          ? [
              evidence(
                skill,
                "Abuse-prone TLD usage",
                abuseTldHits.map((item) => item.value).join(" · "),
                { source: dnsSrc, severity: "medium" },
              ),
            ]
          : []),
        ...(unchecked.length > 0
          ? [
              evidence(
                skill,
                "Not verified",
                `${unchecked.length} candidates unresolved`,
                {
                  source: dnsSrc,
                  confidence: "unknown",
                  kind: "warning",
                },
              ),
            ]
          : []),
      ],
      entities: registered
        .slice(0, 20)
        .map((item) =>
          entity(
            skill,
            "domain",
            item.value,
            `Lookalike (${item.method})`,
            [],
            "confirmed",
          ),
        ),
      sources: [dnsSrc],
    };
  },
};

export const domainSkills: SkillDefinition[] = [
  dnsIntel,
  domainRegistration,
  certificateTransparency,
  dnsPosture,
  typosquatWatch,
];

export const riskyPorts = RISKY_PORTS;
export function describeRiskyPort(port: number): string | undefined {
  return RISKY_PORTS[port];
}
export function targetDomain(target: DetectedTarget): string {
  return apexOf(target.value);
}
