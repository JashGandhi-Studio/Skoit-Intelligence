/**
 * Google News country editions — a pure module (no browser APIs) because the
 * planner runs on both passes and has to know which edition a news question
 * should use before anything is fetched.
 */

export interface NewsEdition {
  code: string;
  label: string;
  flag: string;
  hl: string;
  gl: string;
  ceid: string;
}

export const NEWS_EDITIONS: NewsEdition[] = [
  { code: "in", label: "India", flag: "🇮🇳", hl: "en-IN", gl: "IN", ceid: "IN:en" },
  {
    code: "in-hi",
    label: "India (हिंदी)",
    flag: "🇮🇳",
    hl: "hi-IN",
    gl: "IN",
    ceid: "IN:hi",
  },
  {
    code: "us",
    label: "United States",
    flag: "🇺🇸",
    hl: "en-US",
    gl: "US",
    ceid: "US:en",
  },
  {
    code: "gb",
    label: "United Kingdom",
    flag: "🇬🇧",
    hl: "en-GB",
    gl: "GB",
    ceid: "GB:en",
  },
  { code: "ae", label: "UAE", flag: "🇦🇪", hl: "en-AE", gl: "AE", ceid: "AE:en" },
  { code: "au", label: "Australia", flag: "🇦🇺", hl: "en-AU", gl: "AU", ceid: "AU:en" },
  { code: "ca", label: "Canada", flag: "🇨🇦", hl: "en-CA", gl: "CA", ceid: "CA:en" },
  { code: "sg", label: "Singapore", flag: "🇸🇬", hl: "en-SG", gl: "SG", ceid: "SG:en" },
  { code: "nz", label: "New Zealand", flag: "🇳🇿", hl: "en-NZ", gl: "NZ", ceid: "NZ:en" },
  { code: "pk", label: "Pakistan", flag: "🇵🇰", hl: "en-PK", gl: "PK", ceid: "PK:en" },
  { code: "bd", label: "Bangladesh", flag: "🇧🇩", hl: "en-BD", gl: "BD", ceid: "BD:en" },
  { code: "lk", label: "Sri Lanka", flag: "🇱🇰", hl: "en-LK", gl: "LK", ceid: "LK:en" },
  { code: "ng", label: "Nigeria", flag: "🇳🇬", hl: "en-NG", gl: "NG", ceid: "NG:en" },
  { code: "za", label: "South Africa", flag: "🇿🇦", hl: "en-ZA", gl: "ZA", ceid: "ZA:en" },
  { code: "ke", label: "Kenya", flag: "🇰🇪", hl: "en-KE", gl: "KE", ceid: "KE:en" },
  { code: "de", label: "Germany", flag: "🇩🇪", hl: "de-DE", gl: "DE", ceid: "DE:de" },
  { code: "fr", label: "France", flag: "🇫🇷", hl: "fr-FR", gl: "FR", ceid: "FR:fr" },
  { code: "es", label: "Spain", flag: "🇪🇸", hl: "es-ES", gl: "ES", ceid: "ES:es" },
  { code: "it", label: "Italy", flag: "🇮🇹", hl: "it-IT", gl: "IT", ceid: "IT:it" },
  { code: "br", label: "Brazil", flag: "🇧🇷", hl: "pt-BR", gl: "BR", ceid: "BR:pt-419" },
  { code: "jp", label: "Japan", flag: "🇯🇵", hl: "ja-JP", gl: "JP", ceid: "JP:ja" },
  { code: "kr", label: "South Korea", flag: "🇰🇷", hl: "ko-KR", gl: "KR", ceid: "KR:ko" },
  { code: "id", label: "Indonesia", flag: "🇮🇩", hl: "id-ID", gl: "ID", ceid: "ID:id" },
  { code: "my", label: "Malaysia", flag: "🇲🇾", hl: "en-MY", gl: "MY", ceid: "MY:en" },
  { code: "ph", label: "Philippines", flag: "🇵🇭", hl: "en-PH", gl: "PH", ceid: "PH:en" },
  { code: "world", label: "World", flag: "🌍", hl: "en-US", gl: "US", ceid: "US:en" },
];

export const QUICK_COUNTRY_CODES = ["in", "us", "gb", "ae", "au", "ca"];

export function editionByCode(code: string | undefined): NewsEdition | undefined {
  if (!code) {
    return undefined;
  }
  const needle = code.trim().toLowerCase();
  return NEWS_EDITIONS.find((edition) => edition.code === needle);
}

/** Aliases people actually type — mapped onto editions. */
const COUNTRY_ALIASES: Array<{ names: string[]; code: string }> = [
  { names: ["india", "bharat", "hindustan", "indian"], code: "in" },
  { names: ["usa", "us", "america", "united states", "american", "u s"], code: "us" },
  { names: ["uk", "britain", "england", "united kingdom", "british"], code: "gb" },
  { names: ["uae", "dubai", "abu dhabi", "emirates"], code: "ae" },
  { names: ["australia", "aussie"], code: "au" },
  { names: ["canada", "canadian"], code: "ca" },
  { names: ["singapore"], code: "sg" },
  { names: ["new zealand", "nz"], code: "nz" },
  { names: ["pakistan"], code: "pk" },
  { names: ["bangladesh"], code: "bd" },
  { names: ["sri lanka"], code: "lk" },
  { names: ["nigeria"], code: "ng" },
  { names: ["south africa"], code: "za" },
  { names: ["kenya"], code: "ke" },
  { names: ["germany", "deutschland"], code: "de" },
  { names: ["france"], code: "fr" },
  { names: ["spain"], code: "es" },
  { names: ["italy"], code: "it" },
  { names: ["brazil"], code: "br" },
  { names: ["japan", "japanese"], code: "jp" },
  { names: ["korea", "south korea"], code: "kr" },
  { names: ["indonesia"], code: "id" },
  { names: ["malaysia"], code: "my" },
  { names: ["philippines"], code: "ph" },
  { names: ["world", "global", "international", "everywhere"], code: "world" },
];

export function detectCountryInText(
  text: string,
): { code: string; label: string } | undefined {
  const lower = ` ${text.toLowerCase().replace(/[_—–]/g, " ")} `;
  for (const { names, code } of COUNTRY_ALIASES) {
    for (const name of names) {
      const pattern = new RegExp(
        `(?:^|[^a-z])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[^a-z]|$)`,
      );
      if (pattern.test(lower)) {
        const edition = editionByCode(code);
        if (edition) {
          return { code: edition.code, label: edition.label };
        }
      }
    }
  }
  return undefined;
}

/** "I am from India", "news from japan", "my country is the UK", "use US news". */
export function detectCountryStatement(
  text: string,
): { code: string; label: string } | undefined {
  const lower = text.toLowerCase();
  const statementPattern =
    /\b(?:i(?:'m| am| we are|'re)?|my country is|country:|country is|based (?:in|out of)|live in|from|use|set)\s+(?:the\s+)?([a-z][a-z ]{1,24}?)(?:\s*(?:news|headlines|country|edition))?\s*(?:[.!?,]|$)/i;
  const match = statementPattern.exec(lower);
  if (match) {
    const fragment = match[1].trim();
    const detected = detectCountryInText(fragment);
    if (detected) {
      return detected;
    }
  }
  // "india news", "japan headlines", "news in hindi for india"
  const before = /\b([a-z ]{2,20})\s+(?:news|headlines|samachar|khabar)\b/i.exec(lower);
  if (before) {
    const detected = detectCountryInText(before[1].trim());
    if (detected) {
      return detected;
    }
  }
  return detectCountryInText(lower.replace(/news|headlines/g, " "));
}
