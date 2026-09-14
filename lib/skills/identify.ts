import type { Confidence, DetectedTarget, TargetKind } from "@/lib/types";

const TLD_HINTS = new Set([
  "com",
  "net",
  "org",
  "io",
  "ai",
  "dev",
  "app",
  "in",
  "co",
  "uk",
  "us",
  "de",
  "fr",
  "nl",
  "ru",
  "cn",
  "jp",
  "br",
  "au",
  "ca",
  "info",
  "biz",
  "me",
  "tv",
  "xyz",
  "online",
  "site",
  "store",
  "tech",
  "cloud",
  "gov",
  "edu",
  "mil",
  "int",
  "mil",
  "live",
  "news",
  "blog",
  "shop",
  "ai",
  "so",
  "gg",
  "to",
  "cc",
  "id",
  "pk",
  "bd",
  "lk",
  "np",
  "sg",
  "my",
  "ae",
  "sa",
  "za",
  "ng",
  "ke",
  "gh",
  "ug",
  "tz",
  "tr",
  "ir",
  "iq",
  "il",
  "pl",
  "se",
  "no",
  "dk",
  "fi",
  "es",
  "it",
  "ch",
  "at",
  "be",
  "pt",
  "gr",
  "cz",
  "ro",
  "hu",
  "ua",
  "kz",
  "hub",
  "network",
  "systems",
  "agency",
  "solutions",
  "finance",
  "bank",
  "health",
  "academy",
]);

const PATTERNS: Array<{
  kind: TargetKind;
  regex: RegExp;
  confidence: Confidence;
  priority: number;
  normalize?: (value: string) => string;
}> = [
  {
    kind: "url",
    regex: /\bhttps?:\/\/[^\s<>"'`)\]]+/gi,
    confidence: "confirmed",
    priority: 100,
  },
  {
    kind: "email",
    regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,24}\b/gi,
    confidence: "confirmed",
    priority: 95,
    normalize: (value) => value.toLowerCase(),
  },
  {
    kind: "crypto-address",
    regex:
      /\b(?:bc1[a-z0-9]{25,62}|[13][a-km-zA-HJ-NP-Z1-9]{25,34}|0x[a-fA-F0-9]{40})\b/g,
    confidence: "confirmed",
    priority: 92,
  },
  {
    kind: "iban",
    regex: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g,
    confidence: "possible",
    priority: 88,
  },
  {
    kind: "hash",
    regex: /\b(?:[a-f0-9]{32}|[a-f0-9]{40}|[a-f0-9]{64}|[a-f0-9]{128})\b/gi,
    confidence: "probable",
    priority: 70,
    normalize: (value) => value.toLowerCase(),
  },
  {
    kind: "ip",
    regex:
      /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b|\b(?:[A-F0-9]{1,4}:){2,7}[A-F0-9]{1,4}\b/gi,
    confidence: "confirmed",
    priority: 60,
  },
  {
    kind: "coordinate",
    regex:
      /\b-?\d{1,3}\.\d{3,8}\s*,\s*-?\d{1,3}\.\d{3,8}\b|\b\d{1,3}°\d{1,2}['′]?\s*\d{0,2}(?:\.\d+)?["″]?\s*[NSEW]\b/gi,
    confidence: "probable",
    priority: 58,
  },
  {
    kind: "phone",
    regex:
      /(?:^|[\s(])(?:\+\d{1,3}[\s.-]?(?:\d[\s.-]?){6,12}\d|\(?\b0\d{2,4}\)?[\s.-]?\d{6,8}\b)/g,
    confidence: "probable",
    priority: 55,
    normalize: (value) => value.replace(/[^\d+]/g, ""),
  },
  {
    kind: "domain",
    regex: /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,24})\b/gi,
    confidence: "probable",
    priority: 50,
    normalize: (value) => value.toLowerCase().replace(/^www\./, ""),
  },
  {
    kind: "username",
    regex: /(?:^|\s)@([a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9]))\b/gi,
    confidence: "probable",
    priority: 40,
    normalize: (value) => value.replace(/^@/, "").toLowerCase(),
  },
];

export function isIpv4(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4) {
    return false;
  }
  return parts.every((part) => {
    const n = Number(part);
    return /^\d{1,3}$/.test(part) && n >= 0 && n <= 255;
  });
}

export function isIpv6(value: string): boolean {
  return /^[0-9a-f]{0,4}(:[0-9a-f]{0,4}){2,7}$/i.test(value) && value.includes(":");
}

export function normalizeDomain(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .split("?")[0]
    .split(":")[0]
    .replace(/\.$/, "");
}

export function looksLikeDomain(value: string): boolean {
  const candidate = normalizeDomain(value);
  if (!candidate.includes(".") || candidate.length > 253) {
    return false;
  }
  if (isIpv4(candidate) || isIpv6(candidate)) {
    return false;
  }
  const labels = candidate.split(".");
  if (labels.length < 2) {
    return false;
  }
  const tld = labels[labels.length - 1];
  return /^[a-z]{2,24}$/.test(tld) && (TLD_HINTS.has(tld) || tld.length <= 24);
}

export function apexOf(value: string): string {
  const labels = normalizeDomain(value).split(".");
  if (labels.length <= 2) {
    return labels.join(".");
  }
  const tail = labels.slice(-2).join(".");
  const twoLevelSuffix = /^(co|com|net|org|gov|ac|edu)\.[a-z]{2}$/;
  if (twoLevelSuffix.test(tail)) {
    return labels.slice(-3).join(".");
  }
  return tail;
}

/** Ordering matters: a URL also matches "domain", so we keep the more specific read. */
export function detectTargets(input: string, limit = 6): DetectedTarget[] {
  const found: Array<DetectedTarget & { priority: number; span: [number, number] }> = [];
  const claimed: Array<[number, number]> = [];

  for (const pattern of PATTERNS) {
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    let match = regex.exec(input);
    while (match) {
      const raw = (match[0] ?? "").trim();
      const start = match.index + match[0].indexOf(raw);
      const span: [number, number] = [start, start + raw.length];
      const overlaps = claimed.some(([a, b]) => start < b && span[1] > a);
      if (raw && !overlaps) {
        const value = pattern.normalize ? pattern.normalize(raw) : raw;
        if (pattern.kind === "domain") {
          if (!looksLikeDomain(value)) {
            match = regex.exec(input);
            continue;
          }
          // Skip the domain part of an email address.
          if (input.slice(Math.max(0, start - 40), start).match(/[A-Za-z0-9._%+-]+@$/)) {
            match = regex.exec(input);
            continue;
          }
        }
        claimed.push(span);
        found.push({
          kind: pattern.kind,
          value,
          raw,
          confidence: pattern.confidence,
          priority: pattern.priority,
          span,
        });
      }
      match = regex.exec(input);
    }
  }

  return found
    .sort((a, b) => b.priority - a.priority || a.span[0] - b.span[0])
    .slice(0, limit)
    .map(({ priority: _priority, span: _span, ...target }) => target);
}

export function primaryTarget(kind: TargetKind, value: string): DetectedTarget {
  return { kind, value, raw: value, confidence: "confirmed" };
}

export function targetLabel(target: DetectedTarget): string {
  switch (target.kind) {
    case "domain":
      return "Domain";
    case "ip":
      return isIpv6(target.value) ? "IPv6 address" : "IPv4 address";
    case "email":
      return "Email address";
    case "phone":
      return "Phone number";
    case "username":
      return "Username";
    case "url":
      return "URL";
    case "hash":
      return "Hash";
    case "crypto-address":
      return "Crypto address";
    case "iban":
      return "IBAN";
    case "coordinate":
      return "Coordinate";
    default:
      return "Free text";
  }
}
