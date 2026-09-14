import type { AnswerPreferences } from "@/lib/types";
import { DEFAULT_ANSWER_PREFERENCES } from "@/lib/types";

/**
 * Answer settings decide how wide a question is answered: focused answers only
 * what was asked, standard adds background, deep sweeps everything relevant.
 * The same rules are applied on the server and in the browser so both passes
 * plan identically. Every field is clamped to a sane range — a stored value can
 * never widen a sweep beyond what the console is willing to run.
 */
export function sanitizePreferences(input: unknown): AnswerPreferences {
  const raw = (input ?? {}) as Partial<AnswerPreferences> & {
    media?: Partial<AnswerPreferences["media"]>;
  };

  const focus =
    raw.focus === "standard" || raw.focus === "deep" ? raw.focus : ("focused" as const);
  const licence = raw.licence === "any" ? ("any" as const) : ("reusable" as const);
  const perSourceRaw = Number(raw.perSource);
  const perSource = Number.isFinite(perSourceRaw)
    ? Math.min(24, Math.max(3, Math.round(perSourceRaw)))
    : DEFAULT_ANSWER_PREFERENCES.perSource;

  return {
    focus,
    licence,
    perSource,
    media: {
      images: raw.media?.images !== false,
      videos: raw.media?.videos !== false,
      articles: raw.media?.articles !== false,
      news: raw.media?.news !== false,
    },
    language:
      typeof raw.language === "string" && /^[a-z]{2}$/i.test(raw.language)
        ? raw.language.toLowerCase()
        : undefined,
    region:
      typeof raw.region === "string" && /^[A-Za-z]{2}$/.test(raw.region)
        ? raw.region.toUpperCase()
        : undefined,
  };
}

export function mergePreferences(
  base: AnswerPreferences,
  patch: Partial<AnswerPreferences>,
): AnswerPreferences {
  return sanitizePreferences({
    ...base,
    ...patch,
    media: { ...base.media, ...(patch.media ?? {}) },
  });
}
