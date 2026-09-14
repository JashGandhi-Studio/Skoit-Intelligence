import { request, source } from "@/lib/net/http";
import { attrs, entity, evidence } from "@/lib/skills/emit";
import type { SkillDefinition } from "@/lib/types";

/**
 * Everyday skills — the calculators and quick lookups people actually need
 * in India: loan EMI, SIP growth, GST split, currency conversion, word
 * meanings and public holidays. Pure helpers are exported so the sanity
 * suite can pin the arithmetic.
 */

/* ------------------------------------------------------------ pure maths -- */

/**
 * Indian-amount parsing: "25 lakh", "1.5 crore", "₹4,999", "25k", "2.3 cr".
 * Returns the plain number, or undefined when no figure is present.
 */
export function parseIndianAmount(text: string): number | undefined {
  const match = text.match(
    /(?:₹|rs\.?|inr)?\s*(\d+(?:,\d{2,3})*(?:\.\d+)?)\s*(lakh|lac|crore|cr|k|thousand)?\b/i,
  );
  if (!match) {
    return undefined;
  }
  const base = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(base)) {
    return undefined;
  }
  const unit = match[2]?.toLowerCase();
  if (unit === "lakh" || unit === "lac") {
    return base * 100_000;
  }
  if (unit === "crore" || unit === "cr") {
    return base * 10_000_000;
  }
  if (unit === "k" || unit === "thousand") {
    return base * 1_000;
  }
  return base;
}

/** Interest rate in % per year from prose like "at 8.5%" or "9 percent". */
export function parseRatePercent(text: string): number | undefined {
  const match = text.match(/(\d+(?:\.\d+)?)\s*(?:%|percent|p\.?a\.?)/i);
  if (!match) {
    return undefined;
  }
  const rate = Number(match[1]);
  return Number.isFinite(rate) && rate > 0 && rate < 100 ? rate : undefined;
}

/** Tenure in months from "20 years", "for 18 months", "5yr". */
export function parseTenureMonths(text: string): number | undefined {
  const years = text.match(/(\d+(?:\.\d+)?)\s*(?:years?|yrs?|yr)\b/i);
  if (years) {
    return Math.round(Number(years[1]) * 12);
  }
  const months = text.match(/(\d+)\s*(?:months?|mos?)\b/i);
  if (months) {
    return Number(months[1]);
  }
  return undefined;
}

/** Standard reducing-balance EMI. */
export function emiFor(
  principal: number,
  annualRatePercent: number,
  months: number,
): number {
  if (principal <= 0 || months <= 0) {
    return 0;
  }
  const r = annualRatePercent / 12 / 100;
  if (r === 0) {
    return principal / months;
  }
  const growth = (1 + r) ** months;
  return (principal * r * growth) / (growth - 1);
}

/** Monthly SIP future value (annuity-due, monthly compounding). */
export function sipFutureValue(
  monthly: number,
  annualRatePercent: number,
  months: number,
): number {
  if (monthly <= 0 || months <= 0) {
    return 0;
  }
  const i = annualRatePercent / 12 / 100;
  if (i === 0) {
    return monthly * months;
  }
  return monthly * (((1 + i) ** months - 1) / i) * (1 + i);
}

/** GST split; `inclusive` means the amount already contains the tax. */
export function gstBreakup(
  amount: number,
  ratePercent: number,
  inclusive: boolean,
): {
  net: number;
  tax: number;
  gross: number;
  cgst: number;
  sgst: number;
} {
  const rate = ratePercent / 100;
  const net = inclusive ? amount / (1 + rate) : amount;
  const tax = inclusive ? amount - net : amount * rate;
  return {
    net: Math.round(net * 100) / 100,
    tax: Math.round(tax * 100) / 100,
    gross: Math.round((net + tax) * 100) / 100,
    cgst: Math.round((tax / 2) * 100) / 100,
    sgst: Math.round((tax / 2) * 100) / 100,
  };
}

/** "convert 100 usd to inr" / "usd to inr" → {amount, from, to} | null. */
export function parseCurrencyAsk(text: string): {
  amount: number;
  from: string;
  to: string;
} | null {
  const match = text.match(
    /\b(\d+(?:,\d{3})*(?:\.\d+)?)?\s*([a-z]{3})\s*(?:to|in|into)\s*([a-z]{3})\b/i,
  );
  if (!match || match[2].toLowerCase() === match[3].toLowerCase()) {
    return null;
  }
  const amount = match[1] ? Number(match[1].replace(/,/g, "")) : 1;
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }
  return { amount, from: match[2].toUpperCase(), to: match[3].toUpperCase() };
}

/** "meaning of X" / "define X" / "what does X mean" → X | null. */
export function parseDefineAsk(text: string): string | null {
  const patterns = [
    /\bmeaning\s+of\s+([a-z][a-z-]{1,30})\b/i,
    /\bdefine\s+([a-z][a-z-]{1,30})\b/i,
    /\bwhat\s+does\s+([a-z][a-z-]{1,30})\s+mean\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1].toLowerCase();
    }
  }
  return null;
}

/** A 4-digit year for the holidays ask, else the current year. */
export function parseHolidayYear(text: string): number {
  const match = text.match(/\b(20\d{2})\b/);
  return match ? Number(match[1]) : new Date().getFullYear();
}

function inr(value: number): string {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

/* --------------------------------------------------------------- skills --- */

export const emiCalculator: SkillDefinition = {
  id: "calc-emi",
  name: "Loan EMI calculator",
  short: "EMI",
  description:
    "Computes the reducing-balance EMI, total interest and total payable for a loan amount, interest rate and tenure stated right in the question — pure arithmetic, offline, no data leaves the device.",
  category: "assist",
  runtime: "local",
  accepts: ["text"],
  produces: ["emi", "total-interest"],
  keywords: ["emi", "loan", "installment", "instalment", "interest"],
  clientFallback: true,
  async run(target) {
    const skill = "calc-emi";
    const raw = target.raw;
    const principal = parseIndianAmount(raw);
    const rate = parseRatePercent(raw);
    const months = parseTenureMonths(raw);
    if (principal === undefined || rate === undefined || months === undefined) {
      return {
        status: "partial",
        summary:
          "I need all three: amount (e.g. “25 lakh”), interest rate (e.g. “8.5%”) and tenure (e.g. “20 years”).",
        evidence: [],
        entities: [],
        sources: [],
      };
    }
    const emi = emiFor(principal, rate, months);
    const total = emi * months;
    const localSrc = source(
      "local:formula",
      "Standard reducing-balance EMI formula (computed on-device)",
      "https://en.wikipedia.org/wiki/Equated_monthly_installment",
      "dataset",
    );
    return {
      status: "ok",
      summary: `EMI ${inr(Math.round(emi))}/month for ${months} months at ${rate}% — total interest ${inr(
        Math.round(total - principal),
      )}, total payable ${inr(Math.round(total))}.`,
      evidence: [
        evidence(skill, "Principal", inr(principal), { source: localSrc }),
        evidence(skill, "Rate / tenure", `${rate}% · ${months} months`, {
          source: localSrc,
        }),
        evidence(skill, "EMI", `${inr(Math.round(emi))} per month`, { source: localSrc }),
        evidence(skill, "Total interest", inr(Math.round(total - principal)), {
          source: localSrc,
        }),
        evidence(skill, "Total payable", inr(Math.round(total)), { source: localSrc }),
      ],
      entities: [
        entity(
          skill,
          "text",
          String(Math.round(emi)),
          "EMI per month (₹)",
          attrs({ rate: `${rate}%`, months }),
        ),
      ],
      sources: [localSrc],
    };
  },
};

export const sipCalculator: SkillDefinition = {
  id: "calc-sip",
  name: "SIP growth calculator",
  short: "SIP",
  description:
    "Projects a monthly SIP investment to its future value at an expected annual return over the stated years — pure arithmetic, offline, with the assumption stated plainly.",
  category: "assist",
  runtime: "local",
  accepts: ["text"],
  produces: ["future-value"],
  keywords: ["sip", "mutual fund", "invest monthly", "monthly investment"],
  clientFallback: true,
  async run(target) {
    const skill = "calc-sip";
    const raw = target.raw;
    const monthly = parseIndianAmount(raw);
    const rate = parseRatePercent(raw) ?? 12;
    const months = parseTenureMonths(raw);
    if (monthly === undefined || months === undefined) {
      return {
        status: "partial",
        summary:
          "I need the monthly amount (e.g. “₹5,000 a month”), the expected return (e.g. “12%”) and the years (e.g. “10 years”).",
        evidence: [],
        entities: [],
        sources: [],
      };
    }
    const value = sipFutureValue(monthly, rate, months);
    const invested = monthly * months;
    const localSrc = source(
      "local:formula",
      "SIP annuity-due future value (computed on-device)",
      "https://en.wikipedia.org/wiki/Rate_of_return",
      "dataset",
    );
    return {
      status: "ok",
      summary: `${inr(monthly)}/month for ${months} months at ${rate}% expected → about ${inr(
        Math.round(value),
      )} (invested ${inr(invested)}, gains ${inr(Math.round(value - invested))}). Projected, not guaranteed.`,
      evidence: [
        evidence(skill, "Monthly investment", inr(monthly), { source: localSrc }),
        evidence(skill, "Assumed return / tenure", `${rate}% p.a. · ${months} months`, {
          source: localSrc,
        }),
        evidence(skill, "Projected value", inr(Math.round(value)), { source: localSrc }),
        evidence(
          skill,
          "Invested / gains",
          `${inr(invested)} / ${inr(Math.round(value - invested))}`,
          {
            source: localSrc,
          },
        ),
      ],
      entities: [
        entity(
          skill,
          "text",
          String(Math.round(value)),
          "Projected value (₹)",
          attrs({ rate: `${rate}%`, months }),
        ),
      ],
      sources: [localSrc],
    };
  },
};

export const gstCalculator: SkillDefinition = {
  id: "calc-gst",
  name: "GST amount calculator",
  short: "GST math",
  description:
    "Adds or removes GST at the stated slab (5/12/18/28%) and splits CGST/SGST — inclusive and exclusive amounts both handled, computed on-device.",
  category: "assist",
  runtime: "local",
  accepts: ["text"],
  produces: ["gst-split"],
  keywords: ["gst", "cgst", "sgst", "tax inclusive", "tax exclusive"],
  clientFallback: true,
  async run(target) {
    const skill = "calc-gst";
    const raw = target.raw;
    const amount = parseIndianAmount(raw);
    const rate = parseRatePercent(raw);
    if (amount === undefined || rate === undefined) {
      return {
        status: "partial",
        summary:
          "Give me the amount and the slab — e.g. “GST on ₹4,999 at 18%” or “₹4,999 inclusive of 12% GST”.",
        evidence: [],
        entities: [],
        sources: [],
      };
    }
    const inclusive = /\binclusive|includes?\s+gst|including\b/i.test(raw);
    const breakup = gstBreakup(amount, rate, inclusive);
    const localSrc = source(
      "local:formula",
      "GST arithmetic (computed on-device)",
      "https://gst.gov.in",
      "dataset",
    );
    return {
      status: "ok",
      summary: inclusive
        ? `${inr(amount)} inclusive of ${rate}% GST → base ${inr(breakup.net)} + tax ${inr(breakup.tax)} (CGST ${inr(breakup.cgst)} + SGST ${inr(breakup.sgst)}).`
        : `${inr(breakup.net)} + ${rate}% GST ${inr(breakup.tax)} → ${inr(breakup.gross)} total (CGST ${inr(breakup.cgst)} + SGST ${inr(breakup.sgst)}).`,
      evidence: [
        evidence(
          skill,
          "Stated amount",
          `${inr(amount)} (${inclusive ? "inclusive" : "exclusive"})`,
          {
            source: localSrc,
          },
        ),
        evidence(skill, "Base", inr(breakup.net), { source: localSrc }),
        evidence(skill, `GST @ ${rate}%`, inr(breakup.tax), { source: localSrc }),
        evidence(
          skill,
          "CGST / SGST split",
          `${inr(breakup.cgst)} / ${inr(breakup.sgst)}`,
          {
            source: localSrc,
          },
        ),
        evidence(skill, "Gross", inr(breakup.gross), { source: localSrc }),
      ],
      entities: [
        entity(
          skill,
          "text",
          String(breakup.gross),
          "Gross amount (₹)",
          attrs({ rate: `${rate}%` }),
        ),
      ],
      sources: [localSrc],
    };
  },
};

export const currencyConvert: SkillDefinition = {
  id: "currency-convert",
  name: "Currency conversion",
  short: "Currency",
  description:
    "Converts between world currencies using the Frankfurter API (European Central Bank reference rates, free, no key). Rates are reference rates, not dealer rates.",
  category: "assist",
  runtime: "live",
  accepts: ["text"],
  produces: ["fx-rate"],
  keywords: [
    "currency",
    "convert",
    "exchange rate",
    "usd",
    "inr",
    "euro",
    "dollar",
    "rupees",
  ],
  clientFallback: true,
  async run(target, ctx) {
    const skill = "currency-convert";
    const ask = parseCurrencyAsk(target.raw);
    if (!ask) {
      return {
        status: "partial",
        summary:
          "Ask like “convert 100 usd to inr” — three-letter currency codes on both sides.",
        evidence: [],
        entities: [],
        sources: [],
      };
    }
    const apiSrc = source(
      "fx:frankfurter",
      "Frankfurter.app — ECB reference rates (free, keyless)",
      "https://www.frankfurter.app",
      "api",
    );
    const live = await request<{
      amount?: number;
      base?: string;
      rates?: Record<string, number>;
    }>(
      `https://api.frankfurter.dev/v1/latest?amount=${ask.amount}&base=${ask.from}&symbols=${ask.to}`,
      ctx,
      { timeoutMs: 8000, retries: 1 },
    );
    const converted = live.ok ? live.data?.rates?.[ask.to] : undefined;
    if (converted === undefined) {
      return {
        status: "partial",
        summary: `Could not reach the rate service for ${ask.from} → ${ask.to} right now. Frankfurter carries major currencies only — crypto and exotic codes are not covered.`,
        evidence: [],
        entities: [],
        sources: [apiSrc],
      };
    }
    return {
      status: "ok",
      summary: `${ask.amount.toLocaleString("en-IN")} ${ask.from} = ${converted.toLocaleString(
        "en-IN",
        {
          maximumFractionDigits: 2,
        },
      )} ${ask.to} at the ECB reference rate — a reference rate, not what a dealer or card will charge.`,
      evidence: [
        evidence(skill, "Ask", `${ask.amount} ${ask.from} → ${ask.to}`, {
          source: apiSrc,
        }),
        evidence(skill, "Converted", `${converted} ${ask.to}`, { source: apiSrc }),
        evidence(skill, "Rate honesty", "ECB reference rate, not a dealer/card rate", {
          source: apiSrc,
          kind: "fact",
        }),
      ],
      entities: [
        entity(
          skill,
          "text",
          String(converted),
          `${ask.from}→${ask.to}`,
          attrs({ base: ask.from }),
        ),
      ],
      sources: [apiSrc],
    };
  },
};

export const wordDefine: SkillDefinition = {
  id: "word-define",
  name: "Word meaning",
  short: "Meaning",
  description:
    "Dictionary lookup through the free Dictionary API — part of speech, definition and an example sentence for any English word.",
  category: "assist",
  runtime: "live",
  accepts: ["text"],
  produces: ["definition"],
  keywords: ["meaning", "define", "definition", "dictionary", "vocabulary"],
  clientFallback: true,
  async run(target, ctx) {
    const skill = "word-define";
    const word = parseDefineAsk(target.raw);
    if (!word) {
      return {
        status: "partial",
        summary: "Ask like “meaning of serendipity” or “define ephemeral”.",
        evidence: [],
        entities: [],
        sources: [],
      };
    }
    const apiSrc = source(
      "dict:dictionaryapi",
      "dictionaryapi.dev (free, keyless)",
      "https://dictionaryapi.dev",
      "api",
    );
    type Entry = {
      word?: string;
      phonetic?: string;
      meanings?: Array<{
        partOfSpeech?: string;
        definitions?: Array<{ definition?: string; example?: string }>;
      }>;
    };
    const live = await request<Entry[]>(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
      ctx,
      { timeoutMs: 8000, retries: 1 },
    );
    const entry = live.ok ? live.data?.[0] : undefined;
    const firstMeaning = entry?.meanings?.[0];
    const firstDef = firstMeaning?.definitions?.[0];
    if (!entry || !firstDef?.definition) {
      return {
        status: "partial",
        summary: `No dictionary entry reached for “${word}”. It may be a proper noun or too new for the free dictionary.`,
        evidence: [],
        entities: [],
        sources: [apiSrc],
      };
    }
    const example = firstDef.example ? ` Example: “${firstDef.example}”.` : "";
    const phonetic = entry.phonetic ? ` (${entry.phonetic})` : "";
    return {
      status: "ok",
      summary: `${entry.word ?? word}${phonetic} — ${firstMeaning?.partOfSpeech ?? "word"}: ${firstDef.definition}.${example}`,
      evidence: [
        evidence(skill, "Word", entry.word ?? word, { source: apiSrc }),
        evidence(skill, "Part of speech", firstMeaning?.partOfSpeech ?? "—", {
          source: apiSrc,
        }),
        evidence(skill, "Definition", firstDef.definition, { source: apiSrc }),
        ...(firstDef.example
          ? [evidence(skill, "Example", firstDef.example, { source: apiSrc })]
          : []),
      ],
      entities: [entity(skill, "text", entry.word ?? word, "Dictionary word")],
      sources: [apiSrc],
    };
  },
};

export const holidayList: SkillDefinition = {
  id: "holiday-list",
  name: "Public holidays",
  short: "Holidays",
  description:
    "Lists a country's public holidays for a year through the free Nager.Date API (100+ countries, India included).",
  category: "assist",
  runtime: "live",
  accepts: ["text"],
  produces: ["holidays"],
  keywords: ["holiday", "holidays", "bank holiday", "public holiday", "gazetted"],
  clientFallback: true,
  async run(target, ctx) {
    const skill = "holiday-list";
    const raw = target.raw;
    const year = parseHolidayYear(raw);
    const COUNTRIES: Record<string, string> = {
      india: "IN",
      indian: "IN",
      usa: "US",
      america: "US",
      uk: "GB",
      britain: "GB",
      germany: "DE",
      france: "FR",
      japan: "JP",
      australia: "AU",
      canada: "CA",
      singapore: "SG",
      uae: "AE",
    };
    let code = "IN";
    for (const [name, value] of Object.entries(COUNTRIES)) {
      if (new RegExp(`\\b${name}\\b`, "i").test(raw)) {
        code = value;
        break;
      }
    }
    const apiSrc = source(
      "hols:nager",
      "Nager.Date public holiday API (free, keyless)",
      "https://date.nager.at",
      "api",
    );
    type Holiday = { date: string; localName: string; name: string; global?: boolean };
    const live = await request<Holiday[]>(
      `https://date.nager.at/api/v3/PublicHolidays/${year}/${code}`,
      ctx,
      { timeoutMs: 8000, retries: 1 },
    );
    const holidays = live.ok ? (live.data ?? []) : [];
    if (holidays.length === 0) {
      return {
        status: "partial",
        summary: `No public-holiday list came back for ${code} ${year}. Nager.Date covers 100+ countries — smaller regions may not be listed.`,
        evidence: [],
        entities: [],
        sources: [apiSrc],
      };
    }
    const upcoming = holidays
      .filter((holiday) => holiday.global !== false)
      .slice(0, 24)
      .map((holiday) => `${holiday.date}: ${holiday.name}`);
    return {
      status: "ok",
      summary: `${holidays.length} public holidays for ${code} in ${year}. First ones: ${upcoming
        .slice(0, 5)
        .join(" · ")}.`,
      evidence: upcoming.map((line) =>
        evidence(skill, "Holiday", line, { source: apiSrc }),
      ),
      entities: [],
      sources: [apiSrc],
    };
  },
};

export const everydaySkills: SkillDefinition[] = [
  emiCalculator,
  sipCalculator,
  gstCalculator,
  currencyConvert,
  wordDefine,
  holidayList,
];
