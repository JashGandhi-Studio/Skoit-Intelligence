/**
 * Pure verification helpers behind two honest features:
 *
 *  - the WhatsApp **forward checker**: from a pasted forward, decide what the
 *    open web actually says — first appearance, how many independent outlets,
 *    fact-check signals — and show "forward this" or "don't".
 *  - the **receipt scanner**: from OCR'd shop-bill text, pull GSTIN (with the
 *    mod-36 checksum), the amount and the date. It never claims a department
 *    database was consulted — only what the paper itself shows.
 */

export type ForwardVerdict = "forward" | "caution" | "dont";

export interface ForwardFinding {
  verdict: ForwardVerdict;
  headline: string;
  reasons: string[];
  firstSeen?: number;
  firstSeenUrl?: string;
  domains: string[];
  corroborations: number;
  factChecks: Array<{ host: string; url: string; snippet: string; negative: boolean }>;
  query: string;
}

const FACTCHECK_HOSTS =
  /(altnews|boomlive|factly|smhoaxslayer|vishvas\.|politifact|snopes|afp.*fact|ptifact|factcrescendo|factchecker\.in|indiantabloid|thelogicalindian|datasarkar|peddles)/i;
const SOCIAL_HOSTS =
  /(whatsapp|facebook|twitter|x\.com|instagram|t\.me|telegram|reddit|youtube)/i;
const NEGATIVE_SIGNALS =
  /\b(false|fake|misleading|hoax|doctored|no evidence|unverified|debunked|circulated with a false|not true|did not|doesn't say|never said|old photograph|old photo|old video|shared out of context|mispleading)\b/i;
const POSITIVE_SIGNALS =
  /\b(confirmed|verified that|is true|are true|accurate|authentic|indeed|correctly|yes,? (?:the )?(?:photo|video|claim) is real)\b/i;

/** Strip forward-chain noise so the claim, not the chain, is what gets searched. */
export function cleanForwardText(raw: string): string {
  return raw
    .replace(/forwarded\s+as\s+received/gi, " ")
    .replace(/forwarded\s+many\s+times/gi, " ")
    .replace(/forward(ed)?\s+(this|message)/gi, " ")
    .replace(/[-–—=*~_]{3,}/g, " ")
    .replace(/\bplease\s+(?:forward|share|send)\b[^.!?]*[.!?]?\s*$/gi, " ")
    .replace(/\bdear\s+(all|friends|sir|madam)\b[,.]?/gi, " ")
    .replace(/\bregards[,]?[\s\S]{0,40}$/gi, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOPWORDS = new Set(
  (
    "the a an and or but if then else when what which who whom this that these those is are was were be been being have has had do does did will would shall should can could may might must not no " +
    "in on at to for of with by from as it its he she they we you i all any both each few more most other some such only own same so than too very just also under over after before between during " +
    "forward forwarded message please share send debt all friends dear sir madam regards video photo picture write says said said new"
  ).split(" "),
);

/** The most search-worthy words of the claim, in original order. */
export function claimQueryOf(text: string, maxWords = 10): string {
  const words = cleanForwardText(text)
    .split(/[^A-Za-z\u0900-\u097F0-9']+/)
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word.toLowerCase()));
  const kept = words.slice(0, maxWords);
  return kept.join(" ").trim();
}

export interface ForwardCandidate {
  title: string;
  url: string;
  snippet: string;
  host: string;
  publishedAt?: number;
}

/**
 * Verdict from what the open web returned. Conservative by design:
 * no corroborating coverage → caution, not either of the loud answers.
 */
export function verdictForForward(
  claim: string,
  candidates: ForwardCandidate[],
): ForwardFinding {
  const seen = new Set<string>();
  const domains: string[] = [];
  const factChecks: ForwardFinding["factChecks"] = [];
  let firstSeen: number | undefined;
  let firstSeenUrl: string | undefined;
  let negative = 0;
  let positive = 0;

  for (const candidate of candidates) {
    if (SOCIAL_HOSTS.test(candidate.host)) {
      continue;
    }
    if (!seen.has(candidate.host)) {
      seen.add(candidate.host);
      domains.push(candidate.host);
    }
    const text = `${candidate.title} ${candidate.snippet}`;
    const isFactCheck =
      FACTCHECK_HOSTS.test(candidate.host) || /fact[\s-]?check/i.test(text);
    if (isFactCheck) {
      const negativeHit = NEGATIVE_SIGNALS.test(text);
      factChecks.push({
        host: candidate.host,
        url: candidate.url,
        snippet: candidate.snippet.slice(0, 220),
        negative: negativeHit,
      });
      if (negativeHit) {
        negative += 1;
      } else if (POSITIVE_SIGNALS.test(text)) {
        positive += 1;
      }
    }
    if (
      candidate.publishedAt &&
      (firstSeen === undefined || candidate.publishedAt < firstSeen)
    ) {
      firstSeen = candidate.publishedAt;
      firstSeenUrl = candidate.url;
    }
  }

  const reasons: string[] = [];
  if (factChecks.length > 0 && negative > 0) {
    reasons.push(
      `${negative} fact-check${negative === 1 ? "" : "s"} call it false or misleading — ${factChecks
        .filter((check) => check.negative)
        .map((check) => check.host)
        .join(", ")}.`,
    );
  }
  if (factChecks.length > 0 && positive > 0) {
    reasons.push(
      `${positive} fact-check${positive === 1 ? "" : "s"} affirm it — ${factChecks
        .filter((check) => !check.negative)
        .map((check) => check.host)
        .join(", ")}.`,
    );
  }
  if (domains.length >= 3) {
    reasons.push(
      `Found on ${domains.length} independent sites, so the story is traceable to real reporting.`,
    );
  } else if (domains.length > 0) {
    reasons.push(
      `Only ${domains.length} site(s) carry anything like it — thin corroboration.`,
    );
  } else {
    reasons.push("No trace of this on the open web — nothing corroborates the claim.");
  }
  if (firstSeen) {
    reasons.push(`Earliest trace: ${new Date(firstSeen).toISOString().slice(0, 10)}.`);
  }

  let verdict: ForwardVerdict;
  if (negative > 0 && negative >= positive) {
    verdict = "dont";
  } else if (positive > 0 && factChecks.length > 0) {
    verdict = "forward";
  } else if (domains.length >= 3) {
    verdict = "forward";
  } else {
    verdict = "caution";
  }

  const headline =
    verdict === "forward"
      ? "Safe to forward — this traces to real reporting"
      : verdict === "dont"
        ? "Don't forward — fact-checkers flag this"
        : "Hold on — this could not be verified";

  return {
    verdict,
    headline,
    reasons,
    firstSeen,
    firstSeenUrl,
    domains,
    corroborations: domains.length,
    factChecks,
    query: claimQueryOf(claim),
  };
}

/* ------------------------------------------------------ receipt reading ---- */

const GST_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** The GSTIN mod-36 check digit — same arithmetic the format itself uses. */
export function gstinCheckDigit(first14: string): string {
  let factor = 2;
  let sum = 0;
  for (let index = 13; index >= 0; index -= 1) {
    let codePoint = GST_ALPHABET.indexOf(first14[index].toUpperCase());
    if (codePoint < 0) {
      return "";
    }
    codePoint *= factor;
    factor = factor === 2 ? 1 : 2;
    sum += Math.floor(codePoint / 36) + (codePoint % 36);
  }
  return GST_ALPHABET[(36 - (sum % 36)) % 36];
}

export function gstinLooksValid(value: string): boolean {
  const clean = value.trim().toUpperCase();
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(clean)) {
    return false;
  }
  return gstinCheckDigit(clean.slice(0, 14)) === clean[14];
}

export const GSTIN_PATTERN = /\b(\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z])\b/gi;
const IFSC_PATTERN = /\b([A-Z]{4}0[A-Z0-9]{6})\b/g;
const UPI_PATTERN = /\b([a-zA-Z0-9._-]{2,}@[a-zA-Z]{2,})\b/g;
const AMOUNT_PATTERN =
  /(?:grand\s*total|net\s*(?:amount|payable)|total\s*amount|payable|balance\s*due|total)\s*(?:[:=-]|rs\.?|₹|inr)?\s*(?:rs\.?|₹|inr)?\s*([1-9]\d{0,9}(?:[.,,]\d{2,3})*(?:\.\d{1,2})?)/gi;
const DATE_PATTERNS: RegExp[] = [
  /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/,
  /\b(\d{4})-(\d{2})-(\d{2})\b/,
  /\b(\d{1,2})[\s-]([A-Za-z]{3,9})[\s-](\d{2,4})\b/,
];

export interface ReceiptFinding {
  gstin?: { value: string; checksumValid: boolean; stateCode: string };
  amount?: { value: number; source: string };
  date?: { iso: string; source: string };
  invoiceNo?: string;
  vendorGuess?: string;
}

const STATE_CODES: Record<string, string> = {
  "01": "Jammu & Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "19": "West Bengal",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "27": "Maharashtra",
  "29": "Karnataka",
  "30": "Goa",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "36": "Telangana",
  "37": "Andhra Pradesh",
};

function parseAmount(raw: string): number {
  const normalised = raw.replace(/,/g, "");
  const parts = normalised.split(".");
  if (parts.length === 2 && parts[1].length === 2) {
    return Number(`${parts[0]}.${parts[1]}`);
  }
  if (parts.length === 2 && parts[1].length === 3) {
    // Indian grouping: 12,34,562 — no decimals
    return Number(parts.join(""));
  }
  return Number(normalised);
}

export function readReceiptText(text: string): ReceiptFinding {
  const finding: ReceiptFinding = {};

  const gstinMatch = [...text.matchAll(GSTIN_PATTERN)][0];
  if (gstinMatch) {
    const value = gstinMatch[1].toUpperCase();
    finding.gstin = {
      value,
      checksumValid: gstinLooksValid(value),
      stateCode: STATE_CODES[value.slice(0, 2)] ?? `state code ${value.slice(0, 2)}`,
    };
  }

  let bestAmount: { value: number; source: string } | undefined;
  for (const match of text.matchAll(AMOUNT_PATTERN)) {
    const value = parseAmount(match[1]);
    if (
      Number.isFinite(value) &&
      value > 0 &&
      (!bestAmount || value >= bestAmount.value)
    ) {
      // the largest "total"-labelled figure is almost always the payable one
      bestAmount = { value, source: match[0].trim().slice(0, 40) };
    }
  }
  finding.amount = bestAmount;

  for (const pattern of DATE_PATTERNS) {
    const match = pattern.exec(text);
    if (match) {
      const parsed =
        pattern === DATE_PATTERNS[1]
          ? Date.parse(match[0])
          : DATE_PATTERNS[2] === pattern
            ? Date.parse(match[0])
            : Date.parse(
                `${match[3].length === 2 ? `20${match[3]}` : match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`,
              );
      if (!Number.isNaN(parsed)) {
        finding.date = {
          iso: new Date(parsed).toISOString().slice(0, 10),
          source: match[0],
        };
        break;
      }
    }
  }

  const invoice =
    /\b(?:invoice|bill|receipt)\s*(?:no\.?|number|#)\s*[:=-]?\s*([A-Z0-9][A-Z0-9/-]{2,20})/i.exec(
      text,
    );
  if (invoice) {
    finding.invoiceNo = invoice[1].toUpperCase();
  }

  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const vendorLine = lines.find(
    (line) =>
      /[A-Za-z&.'-]{3,}/.test(line) &&
      !/^(tax|gst|cin|pan|invoice|bill|receipt|date|item|qty|amount|total)/i.test(line) &&
      line.length >= 6 &&
      line.length <= 60,
  );
  if (vendorLine) {
    finding.vendorGuess = vendorLine.slice(0, 48);
  }

  return finding;
}

/* ----------------------------------------------------- snippet pricing ---- */

const PRICE_PATTERN = /(?:₹|rs\.?|inr)\s*([1-9]\d{0,7}(?:,\d{2,3})*(?:\.\d{1,2})?)/i;
const MRP_HINTS = /\b(?:mrp|list price|was|striked|cut price)\b/i;

export interface SnippetPrice {
  value: number;
  raw: string;
  /** true when the context word suggests a list price, not the selling price */
  maybeMrp: boolean;
}

/** The most credible price in a search snippet, or nothing. Never invented. */
export function priceFromSnippet(text: string): SnippetPrice | undefined {
  const prices: SnippetPrice[] = [];
  for (const match of text.matchAll(new RegExp(PRICE_PATTERN.source, "gi"))) {
    const raw = match[1];
    const value = Number(raw.replace(/,/g, ""));
    if (!Number.isFinite(value) || value <= 0 || value > 100_000_000) {
      continue;
    }
    prices.push({
      value,
      raw: match[0].trim(),
      maybeMrp: MRP_HINTS.test(
        match.input?.slice(
          Math.max(0, (match.index ?? 0) - 24),
          (match.index ?? 0) + 24,
        ) ?? "",
      ),
    });
  }
  if (prices.length === 0) {
    return undefined;
  }
  // selling price heuristic: prefer the smallest non-MRP figure
  const sellable = prices.filter((price) => !price.maybeMrp);
  return (sellable.length > 0 ? sellable : prices).sort((a, b) => a.value - b.value)[0];
}
