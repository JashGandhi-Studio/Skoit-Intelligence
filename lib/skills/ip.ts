import { resolveDns } from "@/lib/net/dns";
import { concurrency, request, source } from "@/lib/net/http";
import { describeRiskyPort } from "@/lib/skills/domain";
import { attrs, entity, evidence } from "@/lib/skills/emit";
import { isIpv4, isIpv6 } from "@/lib/skills/identify";
import type { SkillDefinition } from "@/lib/types";

const CDN_ORGANISATIONS = [
  "cloudflare",
  "akamai",
  "fastly",
  "amazon",
  "google",
  "microsoft",
  "cloudfront",
  "incapsula",
  "imperva",
  "stackpath",
  "sucuri",
  "bunny",
  "vercel",
  "netlify",
];

function ipKind(value: string): "ipv4" | "ipv6" | "invalid" {
  const clean = value.trim();
  if (isIpv4(clean)) {
    return "ipv4";
  }
  if (isIpv6(clean)) {
    return "ipv6";
  }
  return "invalid";
}

function isPrivate(value: string): boolean {
  if (!isIpv4(value)) {
    return /^(fe80|fc|fd|::1)/i.test(value);
  }
  const [a, b] = value.split(".").map(Number);
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    a === 0
  );
}

/* ------------------------- Geolocation & network ---------------------- */

interface IpWhoIsResponse {
  ip: string;
  success: boolean;
  message?: string;
  type?: string;
  country?: string;
  country_code?: string;
  region?: string;
  city?: string;
  postal?: string;
  latitude?: number;
  longitude?: number;
  timezone?: { id?: string };
  connection?: { asn?: number; org?: string; isp?: string; domain?: string };
}

interface IpApiResponse {
  status: string;
  message?: string;
  country?: string;
  countryCode?: string;
  regionName?: string;
  city?: string;
  zip?: string;
  lat?: number;
  lon?: number;
  timezone?: string;
  isp?: string;
  org?: string;
  as?: string;
  reverse?: string;
  mobile?: boolean;
  proxy?: boolean;
  hosting?: boolean;
  query: string;
}

export const ipGeolocation: SkillDefinition = {
  id: "ip-geolocation",
  name: "IP geolocation & network",
  short: "GeoIP",
  description:
    "Resolves an address to country, region, city, coordinates, ISP/ASN and flags hosting, proxy or mobile-carrier ranges.",
  category: "network",
  runtime: "live",
  accepts: ["ip", "domain"],
  produces: ["coordinates", "asn", "isp", "timezone"],
  keywords: [
    "ip",
    "geolocation",
    "geoip",
    "asn",
    "isp",
    "location",
    "where",
    "server",
    "hosting",
  ],
  clientFallback: true,
  async run(target, ctx) {
    const skill = "ip-geolocation";
    let address = target.value.trim();

    if (target.kind === "domain") {
      const resolved = await resolveDns(address, "A", ctx);
      if (!resolved.ok || resolved.answers.length === 0) {
        return {
          status: resolved.error ? "unreachable" : "partial",
          summary: `Could not resolve ${address} to an address for enrichment.`,
          evidence: [],
          entities: [],
          sources: [],
          error: resolved.error ?? { code: "unsupported", message: "No A record found." },
        };
      }
      address = resolved.answers[0].data;
      ctx.log(`Resolved ${target.value} → ${address}`);
    }

    if (ipKind(address) !== "ipv4") {
      return {
        status: "partial",
        summary: `GeoIP provider used here is IPv4-only; ${address} needs an IPv6-capable keyed provider.`,
        evidence: [
          evidence(skill, "Address family", isIpv6(address) ? "IPv6" : "unrecognised", {
            kind: "warning",
            confidence: "confirmed",
          }),
        ],
        entities: [],
        sources: [],
        error: {
          code: "unsupported",
          message: "IPv6 enrichment not available without a keyed provider.",
        },
      };
    }

    const primarySource = source(
      "geo:ipwhois",
      "ipwho.is public geolocation (HTTPS, CORS-enabled)",
      `https://ipwho.is/${address}`,
      "api",
    );
    const primary = await request<IpWhoIsResponse>(
      `https://ipwho.is/${encodeURIComponent(address)}`,
      ctx,
      { timeoutMs: 8000 },
    );

    let city: string | undefined;
    let region: string | undefined;
    let postal: string | undefined;
    let country: string | undefined;
    let countryCode: string | undefined;
    let lat: number | undefined;
    let lon: number | undefined;
    let timezone: string | undefined;
    let isp: string | undefined;
    let org: string | undefined;
    let asn: string | undefined;
    let reverse: string | undefined;
    let proxyFlag = false;
    let hostingFlag = false;
    let mobileFlag = false;
    let origin = primarySource;
    let usedFallback = false;

    if (primary.ok && primary.data.success !== false) {
      const data = primary.data;
      city = data.city;
      region = data.region;
      postal = data.postal;
      country = data.country;
      countryCode = data.country_code;
      lat = typeof data.latitude === "number" ? data.latitude : undefined;
      lon = typeof data.longitude === "number" ? data.longitude : undefined;
      timezone = data.timezone?.id;
      isp = data.connection?.isp;
      org = data.connection?.org;
      asn = data.connection?.asn ? `AS${data.connection.asn}` : undefined;
    } else {
      // Secondary provider, only when the primary fails.
      const fallbackSource = source(
        "geo:ip-api",
        "ip-api.com geolocation (CC-BY-SA, HTTPS)",
        `https://ip-api.com/json/${address}`,
        "api",
      );
      const fallback = await request<IpApiResponse>(
        `https://ip-api.com/json/${address}?fields=status,message,country,countryCode,regionName,city,zip,lat,lon,timezone,isp,org,as,reverse,mobile,proxy,hosting,query`,
        ctx,
        { timeoutMs: 8000 },
      );

      if (fallback.ok && fallback.data.status !== "fail") {
        const data = fallback.data;
        city = data.city;
        region = data.regionName;
        postal = data.zip;
        country = data.country;
        countryCode = data.countryCode;
        lat = typeof data.lat === "number" ? data.lat : undefined;
        lon = typeof data.lon === "number" ? data.lon : undefined;
        timezone = data.timezone;
        isp = data.isp;
        org = data.org;
        asn = data.as;
        reverse = data.reverse;
        proxyFlag = Boolean(data.proxy);
        hostingFlag = Boolean(data.hosting);
        mobileFlag = Boolean(data.mobile);
        origin = fallbackSource;
        usedFallback = true;
      } else {
        const reason = primary.ok
          ? `provider rejected the address: ${primary.data.message ?? "unknown reason"}`
          : primary.error.message;
        return {
          status:
            !primary.ok &&
            primary.error.code === "egress_blocked" &&
            !fallback.ok &&
            fallback.error.code === "egress_blocked"
              ? "unreachable"
              : "error",
          summary: `Geolocation unavailable — ${reason}.`,
          evidence: [
            evidence(skill, "Geolocation", "not obtained from either provider", {
              source: primarySource,
              kind: "warning",
              confidence: "unknown",
            }),
          ],
          entities: [],
          sources: [primarySource],
          error: primary.ok
            ? { code: "http_error", message: "Providers rejected the query." }
            : primary.error,
        };
      }
    }

    const geoSource = origin;
    const operator = `${isp ?? ""} ${org ?? ""}`.toLowerCase();
    const behindCdn = CDN_ORGANISATIONS.some((name) => operator.includes(name));
    const flags: string[] = [];
    if (hostingFlag) {
      flags.push("datacentre/hosting range");
    }
    if (proxyFlag) {
      flags.push("anonymiser or proxy exit");
    }
    if (mobileFlag) {
      flags.push("mobile carrier range");
    }

    return {
      status: "ok",
      summary: `${address} → ${[city, region, country].filter(Boolean).join(", ") || "location withheld"} · ${
        isp ?? org ?? "unknown network"
      }${asn ? ` (${asn})` : ""}${reverse ? ` · rDNS ${reverse}` : ""}.`,
      evidence: [
        evidence(
          skill,
          "Location",
          [city, region, postal, country].filter(Boolean).join(", ") || "not published",
          {
            source: geoSource,
            detail:
              "City-level geolocation is approximate and routinely wrong for mobile, satellite and VPN ranges.",
          },
        ),
        ...(lat !== undefined && lon !== undefined
          ? [evidence(skill, "Coordinates", `${lat}, ${lon}`, { source: geoSource })]
          : []),
        evidence(skill, "Network operator", isp ?? "unknown", { source: geoSource }),
        evidence(skill, "Organisation", org ?? "unknown", { source: geoSource }),
        evidence(skill, "Autonomous system", asn ?? "unknown", { source: geoSource }),
        evidence(skill, "Timezone", timezone ?? "unknown", { source: geoSource }),
        ...(reverse
          ? [evidence(skill, "Reverse DNS", reverse, { source: geoSource })]
          : []),
        ...(usedFallback
          ? [
              evidence(skill, "Provider", "primary provider failed; secondary answered", {
                source: geoSource,
                confidence: "confirmed",
                kind: "warning",
              }),
            ]
          : []),
        ...(flags.length > 0
          ? [
              evidence(skill, "Infrastructure flags", flags.join(" · "), {
                source: geoSource,
                severity: proxyFlag ? "medium" : "low",
              }),
            ]
          : []),
        ...(behindCdn
          ? [
              evidence(
                skill,
                "Shared edge infrastructure",
                "Address belongs to a CDN/edge provider",
                {
                  source: geoSource,
                  severity: "medium",
                  detail:
                    "The origin is masked behind a CDN. Scan results and the address itself describe the edge, not the site owner.",
                },
              ),
            ]
          : []),
      ],
      entities: [
        entity(skill, "ip", address, "Analysed address", attrs({ isp, asn })),
        ...(lat !== undefined && lon !== undefined
          ? [
              entity(
                skill,
                "coordinate",
                `${lat},${lon}`,
                "Approximate coordinates",
                [],
                "probable",
              ),
            ]
          : []),
        ...(asn
          ? [
              entity(
                skill,
                "asn",
                asn.split(" ")[0] ?? asn,
                asn,
                attrs({ country: countryCode }),
              ),
            ]
          : []),
      ],
      sources: [geoSource],
    };
  },
};

/* ------------------------ Passive port intelligence ------------------- */

interface ShodanInternetDb {
  ip: string;
  ports?: number[];
  hostnames?: string[];
  cpes?: string[];
  tags?: string[];
  vulns?: string[];
}

export const ipServices: SkillDefinition = {
  id: "ip-services",
  name: "Exposed services",
  short: "Ports",
  description:
    "Reads a passive internet-scan dataset for open ports, TLS hostnames, device fingerprints and known CVEs. Never sends a packet to the target.",
  category: "infrastructure",
  runtime: "live",
  accepts: ["ip"],
  produces: ["ports", "cve", "fingerprints"],
  keywords: [
    "port",
    "service",
    "open",
    "scan",
    "cve",
    "vulnerability",
    "exposed",
    "banner",
    "shodan",
  ],
  clientFallback: true,
  async run(target, ctx) {
    const skill = "ip-services";
    const address = target.value.trim();

    if (isPrivate(address)) {
      return {
        status: "skipped",
        summary: "Private or reserved address — no passive dataset covers it.",
        evidence: [],
        entities: [],
        sources: [],
      };
    }

    const scanSource = source(
      "scan:internetdb",
      "Shodan InternetDB public scan dataset",
      `https://internetdb.shodan.io/${address}`,
      "dataset",
    );
    const result = await request<ShodanInternetDb>(
      `https://internetdb.shodan.io/${encodeURIComponent(address)}`,
      ctx,
      { timeoutMs: 8000 },
    );

    if (!result.ok) {
      return {
        status: result.error.code === "egress_blocked" ? "unreachable" : "error",
        summary:
          result.error.code === "egress_blocked"
            ? "Passive scan dataset unreachable from this runtime."
            : `Scan dataset lookup failed: ${result.error.message}`,
        evidence: [],
        entities: [],
        sources: [scanSource],
        error: result.error,
      };
    }

    const data = result.data;
    const ports = data.ports ?? [];
    const risky = ports.filter((port) => describeRiskyPort(port));
    const vulns = data.vulns ?? [];

    if (ports.length === 0 && (data.hostnames ?? []).length === 0 && vulns.length === 0) {
      return {
        status: "ok",
        summary: `No records for ${address} in the passive dataset — nothing observed listening, or the address was never scanned.`,
        evidence: [
          evidence(skill, "Dataset coverage", "Address not present in scan dataset", {
            source: scanSource,
            confidence: "probable",
            detail:
              "Absence of data is not proof that nothing is exposed; it only means no scan result was recorded.",
          }),
        ],
        entities: [],
        sources: [scanSource],
      };
    }

    return {
      status: "ok",
      summary: `${ports.length} observed open port(s)${vulns.length ? `, ${vulns.length} associated CVE(s)` : ""}${risky.length ? `, ${risky.length} high-risk service(s)` : ""}.`,
      evidence: [
        evidence(skill, "Open ports", ports.join(", ") || "none recorded", {
          source: scanSource,
          raw: ports,
        }),
        ...(risky.length > 0
          ? [
              evidence(
                skill,
                "High-risk services",
                risky.map((port) => `${port} — ${describeRiskyPort(port)}`).join(" · "),
                {
                  source: scanSource,
                  severity: "high",
                  detail:
                    "These services were observed from the public internet. Validate before reporting; scan data can be stale.",
                },
              ),
            ]
          : []),
        ...(vulns.length > 0
          ? [
              evidence(skill, "Known CVEs", vulns.join(" · "), {
                source: scanSource,
                severity: "critical",
                detail:
                  "CVE identifiers observed in the same scan record. Treat as unverified until reproduced.",
              }),
            ]
          : []),
        ...((data.hostnames ?? []).length > 0
          ? [
              evidence(skill, "TLS hostnames", (data.hostnames ?? []).join(" · "), {
                source: scanSource,
              }),
            ]
          : []),
        ...((data.cpes ?? []).length > 0
          ? [
              evidence(
                skill,
                "Software fingerprints",
                (data.cpes ?? []).slice(0, 12).join(" · "),
                { source: scanSource },
              ),
            ]
          : []),
        ...((data.tags ?? []).length > 0
          ? [
              evidence(skill, "Dataset tags", (data.tags ?? []).join(" · "), {
                source: scanSource,
              }),
            ]
          : []),
      ],
      entities: [
        entity(skill, "ip", address, "Analysed address"),
        ...(data.hostnames ?? [])
          .slice(0, 10)
          .map((host) =>
            entity(
              skill,
              "domain",
              host.toLowerCase(),
              "Hostname from scan",
              [],
              "probable",
            ),
          ),
      ],
      sources: [scanSource],
    };
  },
};

/* ------------------------------ Reverse lookup ------------------------ */

export const reverseDns: SkillDefinition = {
  id: "reverse-dns",
  name: "Reverse DNS",
  short: "rDNS",
  description:
    "Queries the PTR tree for an address and its surrounding /24 to expose provider naming conventions.",
  category: "network",
  runtime: "live",
  accepts: ["ip"],
  produces: ["ptr-records"],
  keywords: ["ptr", "reverse", "rdns", "hostname", "who owns"],
  clientFallback: true,
  async run(target, ctx) {
    const skill = "reverse-dns";
    const address = target.value.trim();
    if (!isIpv4(address)) {
      return {
        status: "partial",
        summary: "PTR sweep implemented for IPv4 only.",
        evidence: [],
        entities: [],
        sources: [],
        error: { code: "unsupported", message: "IPv4 only." },
      };
    }

    const ptrName = `${address.split(".").reverse().join(".")}.in-addr.arpa`;
    const result = await resolveDns(ptrName, "PTR", ctx);
    const neighbours = [1, 2, 3, 254].map((host) => {
      const parts = address.split(".");
      return `${parts.slice(0, 3).join(".")}.${host}`;
    });
    const neighbourNames: string[] = [];
    await concurrency(neighbours, 4, async (ip) => {
      const name = `${ip.split(".").reverse().join(".")}.in-addr.arpa`;
      const answer = await resolveDns(name, "PTR", ctx, 5000);
      for (const record of answer.answers) {
        neighbourNames.push(record.data.replace(/\.$/, ""));
      }
      return null;
    });

    if (!result.ok) {
      return {
        status: result.error?.code === "egress_blocked" ? "unreachable" : "error",
        summary: "Reverse DNS lookup failed in this runtime.",
        evidence: [],
        entities: [],
        sources: [],
        error: result.error ?? { code: "unknown", message: "Reverse DNS lookup failed." },
      };
    }

    const names = result.answers.map((answer) => answer.data.replace(/\.$/, ""));
    return {
      status: names.length > 0 ? "ok" : "partial",
      summary:
        names.length > 0
          ? `${address} reverses to ${names.join(", ")}.`
          : `No PTR record for ${address}.`,
      evidence: [
        evidence(skill, "PTR record", names.join(" · ") || "none published", {
          source: source("dns:ptr", "DNS-over-HTTPS PTR query", undefined, "dns"),
          confidence: names.length ? "confirmed" : "probable",
        }),
        ...(neighbourNames.length > 0
          ? [
              evidence(skill, "Neighbouring PTR names", neighbourNames.join(" · "), {
                source: source("dns:ptr", "DNS-over-HTTPS PTR query", undefined, "dns"),
                detail:
                  "Provider naming patterns in the same /24 reveal the hosting convention.",
              }),
            ]
          : []),
      ],
      entities: names.map((name) =>
        entity(skill, "domain", name, "PTR name", [], "confirmed"),
      ),
      sources: [source("dns:ptr", "DNS-over-HTTPS PTR query", undefined, "dns")],
    };
  },
};

/* ------------------------------ Bulk enrichment ----------------------- */

export const bulkIp: SkillDefinition = {
  id: "bulk-ip",
  name: "Address batch enrichment",
  short: "Batch",
  description:
    "Enriches several addresses at once so a log extract or blocklist can be triaged in one pass, reporting country and network distribution.",
  category: "network",
  runtime: "live",
  accepts: ["ip"],
  produces: ["batch-geo", "batch-asn"],
  keywords: ["batch", "list", "many", "ips", "range", "block list", "triage"],
  clientFallback: true,
  async run(target, ctx) {
    const skill = "bulk-ip";
    const addresses = Array.from(
      new Set(
        target.raw
          .split(/[\s,;]+/)
          .map((item) => item.trim())
          .filter((item) => isIpv4(item)),
      ),
    ).slice(0, 10);

    if (addresses.length < 2) {
      return {
        status: "skipped",
        summary: "Fewer than two valid IPv4 addresses in the input.",
        evidence: [],
        entities: [],
        sources: [],
      };
    }

    const batchSource = source(
      "geo:ipwhois-batch",
      "ipwho.is per-address lookups (HTTPS)",
      "https://ipwho.is/",
      "api",
    );

    const rows: Array<{
      query: string;
      country?: string;
      countryCode?: string;
      city?: string;
      isp?: string;
      asn?: string;
      lat?: number;
      lon?: number;
    }> = [];
    let failures = 0;

    await concurrency(addresses, 4, async (address) => {
      const result = await request<IpWhoIsResponse>(
        `https://ipwho.is/${encodeURIComponent(address)}`,
        ctx,
        {
          timeoutMs: 8000,
          retries: 0,
        },
      );
      if (!result.ok || result.data.success === false) {
        failures += 1;
        return null;
      }
      const data = result.data;
      rows.push({
        query: address,
        country: data.country,
        countryCode: data.country_code,
        city: data.city,
        isp: data.connection?.isp ?? data.connection?.org,
        asn: data.connection?.asn ? `AS${data.connection.asn}` : undefined,
        lat: typeof data.latitude === "number" ? data.latitude : undefined,
        lon: typeof data.longitude === "number" ? data.longitude : undefined,
      });
      return null;
    });

    if (rows.length === 0) {
      return {
        status: failures === addresses.length ? "unreachable" : "error",
        summary: "Batch enrichment could not reach a provider for any address.",
        evidence: [],
        entities: [],
        sources: [batchSource],
        error: { code: "egress_blocked", message: "No batch provider reachable." },
      };
    }

    const countries = new Map<string, number>();
    const networks = new Map<string, number>();
    for (const row of rows) {
      countries.set(row.country ?? "??", (countries.get(row.country ?? "??") ?? 0) + 1);
      networks.set(row.isp ?? "unknown", (networks.get(row.isp ?? "unknown") ?? 0) + 1);
    }

    return {
      status: "ok",
      summary: `${rows.length}/${addresses.length} addresses enriched; ${countries.size} countries, ${networks.size} distinct networks.`,
      evidence: [
        evidence(
          skill,
          "Address detail",
          rows
            .slice(0, 10)
            .map(
              (row) =>
                `${row.query} → ${[row.city, row.countryCode].filter(Boolean).join(", ")} · ${row.isp ?? "?"}`,
            )
            .join(" | "),
          { source: batchSource, raw: rows },
        ),
        evidence(
          skill,
          "Country distribution",
          Array.from(countries.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([country, count]) => `${country} ×${count}`)
            .join(" · "),
          { source: batchSource },
        ),
        evidence(
          skill,
          "Top networks",
          Array.from(networks.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6)
            .map(([name, count]) => `${name} ×${count}`)
            .join(" · "),
          { source: batchSource },
        ),
        ...(failures > 0
          ? [
              evidence(
                skill,
                "Unresolved addresses",
                `${failures} address(es) returned no data`,
                {
                  source: batchSource,
                  kind: "warning",
                  confidence: "unknown",
                },
              ),
            ]
          : []),
      ],
      entities: rows.flatMap((row) => [
        entity(
          skill,
          "ip",
          row.query,
          "Batched address",
          attrs({ country: row.countryCode, isp: row.isp }),
        ),
        ...(row.lat !== undefined && row.lon !== undefined
          ? [
              entity(
                skill,
                "coordinate",
                `${row.lat},${row.lon}`,
                "Approximate coordinates",
                [],
                "possible",
              ),
            ]
          : []),
      ]),
      sources: [batchSource],
    };
  },
};

export const ipSkills: SkillDefinition[] = [
  ipGeolocation,
  ipServices,
  reverseDns,
  bulkIp,
];
export const privateAddressCheck = isPrivate;
