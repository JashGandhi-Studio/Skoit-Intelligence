import type { SkillDefinition, TargetKind } from "@/lib/types";
import { domainSkills } from "./domain";
import { identitySkills } from "./identity";
import { indiaSkills } from "./india";
import { ipSkills } from "./ip";
import { knowledgeSkills } from "./knowledge";
import { mediaSkills } from "./media";
import { retrievalSkills } from "./retrieval";

export const allSkills: SkillDefinition[] = [
  ...domainSkills,
  ...ipSkills,
  ...identitySkills,
  ...indiaSkills,
  ...mediaSkills,
  ...retrievalSkills,
  ...knowledgeSkills,
];

export const skillById = new Map(allSkills.map((skill) => [skill.id, skill]));

export function getSkill(id: string): SkillDefinition | undefined {
  return skillById.get(id);
}

export function skillsAccepting(
  kind: TargetKind,
  runtime?: "local" | "live",
): SkillDefinition[] {
  return allSkills.filter(
    (skill) => skill.accepts.includes(kind) && (!runtime || skill.runtime === runtime),
  );
}

export interface SkillManifestEntry {
  id: string;
  name: string;
  short: string;
  description: string;
  category: SkillDefinition["category"];
  runtime: SkillDefinition["runtime"];
  accepts: TargetKind[];
  produces: string[];
  requiresKey?: string[];
}

export function manifest(): SkillManifestEntry[] {
  return allSkills.map((skill) => ({
    id: skill.id,
    name: skill.name,
    short: skill.short,
    description: skill.description,
    category: skill.category,
    runtime: skill.runtime,
    accepts: skill.accepts,
    produces: skill.produces,
    requiresKey: skill.requiresKey,
  }));
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Keyword matching has to be word-aware: a plain substring test makes “recipe”
 * match the keyword “ip” and sends a cooking question to a geolocation skill.
 * Short keywords must stand alone; longer ones may take an English plural.
 */
export function skillsMatchingText(text: string): SkillDefinition[] {
  const lower = text.toLowerCase();
  return allSkills.filter((skill) =>
    skill.keywords.some((keyword) => {
      const needle = keyword.trim().toLowerCase();
      if (!needle) {
        return false;
      }
      if (!/^[a-z0-9][a-z0-9\s.'&/-]*$/.test(needle)) {
        return lower.includes(needle);
      }
      const suffix = needle.length >= 4 ? "(?:s|es)?" : "";
      return new RegExp(
        `(?:^|[^a-z0-9])${escapeForRegex(needle)}${suffix}(?:[^a-z0-9]|$)`,
        "i",
      ).test(lower);
    }),
  );
}

export function describeSkillCoverage(): { live: number; local: number; keyed: number } {
  return {
    live: allSkills.filter((skill) => skill.runtime === "live").length,
    local: allSkills.filter((skill) => skill.runtime === "local").length,
    keyed: allSkills.filter((skill) => (skill.requiresKey ?? []).length > 0).length,
  };
}

export function clientRunnableSkills(): SkillDefinition[] {
  return allSkills.filter((skill) => skill.clientFallback);
}
