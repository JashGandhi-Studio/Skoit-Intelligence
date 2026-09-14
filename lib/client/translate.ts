import { isRelayOk, relayJson } from "@/lib/client/cors-fetch";

/**
 * Instant translation for headlines and short text, via Google's public
 * translate endpoint (the same one the web translate widget uses) through the
 * relay chain. Machine translation is labelled as machine translation where
 * it is shown — it is a comprehension aid, never presented as the publisher's
 * own words.
 */

export interface TranslatedText {
  text: string;
  from?: string;
}

/** gtx returns [["translated", ...], ...]; flatten the segments. */
export async function translateText(
  text: string,
  targetLang: string,
  options: { sourceLang?: string; signal?: AbortSignal } = {},
): Promise<TranslatedText> {
  const clean = text.trim();
  if (!clean) {
    return { text: "" };
  }
  const url =
    "https://translate.googleapis.com/translate_a/single" +
    `?client=gtx&sl=${options.sourceLang || "auto"}&tl=${encodeURIComponent(targetLang)}` +
    `&dt=t&q=${encodeURIComponent(clean.slice(0, 1800))}`;
  const fetched = await relayJson<unknown>(url, {
    timeoutMs: 12_000,
    skipDirect: false,
    signal: options.signal,
  });
  if (!isRelayOk(fetched)) {
    throw new Error(fetched.error);
  }
  const payload = fetched.data as [
    Array<[string | null, string | null]>,
    unknown,
    string | undefined,
  ];
  if (!Array.isArray(payload?.[0])) {
    throw new Error("the translation service answered in an unexpected shape");
  }
  const translated = payload[0]
    .map((segment) => segment?.[0] ?? "")
    .join("")
    .trim();
  return { text: translated, from: payload[2] };
}

export interface NewsTranslation {
  /** keyed by article url → translated title */
  titles: Map<string, string>;
  snippets: Map<string, string>;
  to: string;
  partial: number;
}

/** Translate a page of headlines at once, tolerating individual failures. */
export async function translateArticles(
  articles: Array<{ url: string; title: string; snippet?: string }>,
  targetLang: string,
  options: { signal?: AbortSignal; max?: number } = {},
): Promise<NewsTranslation> {
  const titles = new Map<string, string>();
  const snippets = new Map<string, string>();
  const page = articles.slice(0, options.max ?? 12);
  let partial = 0;

  const chunk = 6;
  for (let index = 0; index < page.length; index += chunk) {
    const batch = page.slice(index, index + chunk);
    const results = await Promise.allSettled(
      batch.map(async (article) => {
        const title = await translateText(article.title, targetLang, {
          signal: options.signal,
        });
        let snippet: string | undefined;
        if (article.snippet && article.snippet.length > 24) {
          snippet = await translateText(article.snippet.slice(0, 300), targetLang, {
            signal: options.signal,
          })
            .then((result) => result.text)
            .catch(() => undefined);
        }
        return { url: article.url, title: title.text, snippet };
      }),
    );
    for (const result of results) {
      if (result.status === "fulfilled" && result.value.title) {
        titles.set(result.value.url, result.value.title);
        if (result.value.snippet) {
          snippets.set(result.value.url, result.value.snippet);
        }
      } else {
        partial += 1;
      }
    }
  }
  return { titles, snippets, to: targetLang, partial };
}

/** The languages the translate strip offers — Indian audience first. */
export const TRANSLATE_LANGUAGES: Array<{ code: string; label: string }> = [
  { code: "en", label: "English" },
  { code: "hi", label: "हिंदी Hindi" },
  { code: "mr", label: "मराठी Marathi" },
  { code: "ta", label: "தமிழ் Tamil" },
  { code: "te", label: "తెలుగు Telugu" },
  { code: "bn", label: "বাংলা Bengali" },
  { code: "gu", label: "ગુજરાતી Gujarati" },
  { code: "kn", label: "ಕನ್ನಡ Kannada" },
  { code: "ml", label: "മലയാളം Malayalam" },
  { code: "pa", label: "ਪੰਜਾਬੀ Punjabi" },
  { code: "ur", label: "اردو Urdu" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "ar", label: "العربية" },
];

/** Very rough script sniff: does the text look like Devanagari etc.? */
export function scriptOf(text: string): string {
  if (/[\u0900-\u097F]/.test(text)) {
    return "hi";
  }
  if (/[\u0980-\u09FF]/.test(text)) {
    return "bn";
  }
  if (/[\u0A00-\u0A7F]/.test(text)) {
    return "pa";
  }
  if (/[\u0A80-\u0AFF]/.test(text)) {
    return "gu";
  }
  if (/[\u0B80-\u0BFF]/.test(text)) {
    return "ta";
  }
  if (/[\u0C00-\u0C7F]/.test(text)) {
    return "te";
  }
  if (/[\u0C80-\u0CFF]/.test(text)) {
    return "kn";
  }
  if (/[\u0D00-\u0D7F]/.test(text)) {
    return "ml";
  }
  if (/[\u0600-\u06FF]/.test(text)) {
    return "ar";
  }
  return "en";
}
