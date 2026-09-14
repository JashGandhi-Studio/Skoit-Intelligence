import { getSkill, skillsMatchingText } from "@/lib/skills";
import {
  detectTargets,
  looksLikeDomain,
  normalizeDomain,
  targetLabel,
} from "@/lib/skills/identify";
import type {
  AgentRequest,
  DetectedTarget,
  PlannedStep,
  SkillDefinition,
  TargetKind,
} from "@/lib/types";

const TYPO_KEYWORDS =
  /(typo|lookalike|look-alike|phish|spoof|fake|impersonat|clone|squat|brand)/i;
const SEARCH_KEYWORDS =
  /(news|search|google|find|mention|press|article|reported|coverage)/i;
const FULL_SWEEP =
  /(full|deep|everything|all skills|complete|exhaustive|sweep everything)/i;

const BASE_PLAN: Partial<Record<TargetKind, string[]>> = {
  domain: ["dns-intel", "domain-registration", "certificate-transparency", "dns-posture"],
  url: ["url-structure", "archive-history"],
  ip: ["ip-geolocation", "ip-services", "reverse-dns", "ip-registry"],
  email: ["email-intelligence", "breach-exposure"],
  phone: ["phone-intelligence"],
  username: ["username-footprint"],
  hash: ["hash-intel", "reference-lab"],
  "crypto-address": ["crypto-address"],
  coordinate: ["coordinate-intelligence"],
  person: ["name-conventions", "sanctions-screening"],
  text: ["text-intelligence"],
};

const REASONS: Record<string, string> = {
  "dns-intel":
    "Establish what the name actually resolves to before trusting anything else.",
  "domain-registration": "Registry record gives ownership, age and lifecycle signals.",
  "certificate-transparency":
    "CT logs are the cheapest real subdomain enumeration available.",
  "dns-posture": "Mail and CAA posture shows how easily the domain can be spoofed.",
  "typosquat-watch": "Brand-abuse indicators were requested or implied by the phrasing.",
  "url-structure": "Dissect the link before any request goes near the destination.",
  "archive-history": "Archived captures date the page and reveal content changes.",
  "ip-geolocation": "Geolocation, ISP and hosting flags for the address.",
  "ip-services": "Passive scan noise shows what is actually exposed to the internet.",
  "reverse-dns": "PTR naming conventions expose the provider and naming scheme.",
  "ip-registry": "Authoritative RIR record for the containing block.",
  "email-intelligence": "Confirm the mailbox is real and classify its operator.",
  "breach-exposure": "Credential exposure changes the whole risk picture for an address.",
  "username-footprint": "Public profiles tie a handle to names, places and dates.",
  "hash-intel": "Identify algorithm and strength, then check corpus coverage.",
  "reference-lab": "Decode any identifier embedded in the string.",
  "crypto-address": "Validate the address checksum before any attribution attempt.",
  "phone-intelligence": "Offline numbering-plan analysis: country, line type, validity.",
  "pincode-intelligence": "Postal prefix and delivery data for the PIN code.",
  "vehicle-registration": "Decode the plate's state, RTO zone and series structure.",
  "identity-documents": "Validate Indian document formats with real checksums.",
  "coordinate-intelligence":
    "Normalise the position and place it against reference cities.",
  "name-conventions": "Plan transliteration variants for searching a name.",
  "sanctions-screening":
    "Screening is mandatory before any adverse statement about a person.",
  "attachment-review":
    "Extract and interpret file metadata before reporting on the file.",
  "host-resolution-sweep": "Triage the host list down to what is actually live.",
  "web-search": "Broaden beyond link-level sources with indexed search.",
};

function stepFor(
  skill: SkillDefinition,
  target: DetectedTarget,
  index: number,
): PlannedStep {
  return {
    id: `step_${index}_${skill.id}`,
    skillId: skill.id,
    label: `${skill.short} · ${targetLabel(target)}`,
    targetKind: target.kind,
    target: target.value,
    reason: REASONS[skill.id] ?? skill.description,
    status: "queued",
  };
}

function textDerivedTargets(message: string): DetectedTarget[] {
  const extra: DetectedTarget[] = [];
  const pin = message.match(/\b([1-9]\d{5})\b/);
  if (pin) {
    extra.push({
      kind: "text",
      value: pin[1],
      raw: pin[1],
      confidence: "probable",
      meta: { hint: "pincode" },
    });
  }
  const plate = message
    .toUpperCase()
    .match(/\b([A-Z]{2}[\s-]?\d{1,2}[\s-]?[A-Z]{0,3}[\s-]?\d{1,4})\b/);
  if (plate && /(vehicle|car|bike|plate|registration|rto)/i.test(message)) {
    extra.push({
      kind: "text",
      value: plate[1].replace(/\s/g, ""),
      raw: plate[1],
      confidence: "probable",
      meta: { hint: "vehicle" },
    });
  }
  const person = message.match(
    /\b(?:mr|mrs|ms|dr|shri|smt)\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/,
  );
  if (person) {
    extra.push({
      kind: "person",
      value: person[1],
      raw: person[1],
      confidence: "probable",
    });
  }
  return extra;
}

export interface Plan {
  targets: DetectedTarget[];
  steps: PlannedStep[];
  rationale: string;
  mode: "deep" | "focused";
}

export function buildPlan(request: AgentRequest): Plan {
  const message = request.message ?? "";
  const attachments = request.attachments ?? [];
  const detected = detectTargets(message);
  const extras = textDerivedTargets(message);
  const targets = [...detected, ...extras];

  const wantsDeep = FULL_SWEEP.test(message);
  const wantsTyposquat = TYPO_KEYWORDS.test(message);
  const wantsSearch = SEARCH_KEYWORDS.test(message);

  const requested = new Set(request.skillIds ?? []);
  const steps: PlannedStep[] = [];
  let counter = 0;

  const addStep = (skill: SkillDefinition, target: DetectedTarget) => {
    const key = `${skill.id}::${target.value}`;
    if (steps.some((step) => `${step.skillId}::${step.target}` === key)) {
      return;
    }
    steps.push(stepFor(skill, target, counter));
    counter += 1;
  };

  const addSkillChain = (kind: TargetKind, target: DetectedTarget) => {
    for (const skillId of BASE_PLAN[kind] ?? []) {
      const skill = getSkill(skillId);
      if (skill) {
        addStep(skill, target);
      }
    }
  };

  for (const target of targets) {
    addSkillChain(target.kind, target);

    if (target.kind === "url" || target.kind === "domain" || target.kind === "email") {
      const host = normalizeDomain(
        target.kind === "email" ? (target.value.split("@")[1] ?? "") : target.value,
      );
      if (looksLikeDomain(host)) {
        const domainTarget: DetectedTarget = {
          kind: "domain",
          value: host,
          raw: host,
          confidence: "confirmed",
        };
        if (target.kind === "url") {
          addSkillChain("domain", domainTarget);
        }
        if (target.kind === "email") {
          const dnsPosture = getSkill("dns-posture");
          if (dnsPosture) {
            addStep(dnsPosture, domainTarget);
          }
        }
      }
    }

    if (target.kind === "text") {
      if (target.meta?.hint === "pincode") {
        const skill = getSkill("pincode-intelligence");
        if (skill) {
          addStep(skill, target);
        }
      }
      if (target.meta?.hint === "vehicle") {
        const skill = getSkill("vehicle-registration");
        if (skill) {
          addStep(skill, target);
        }
      }
    }
  }

  // Keyword-driven additions: the analyst asked for something specific.
  for (const skill of skillsMatchingText(message)) {
    if (skill.id === "typosquat-watch" && !wantsTyposquat) {
      continue;
    }
    if (skill.id === "web-search" && !wantsSearch) {
      continue;
    }
    const target = targets.find((candidate) =>
      skill.accepts.includes(candidate.kind),
    ) ?? {
      kind: "text" as TargetKind,
      value: message.slice(0, 200),
      raw: message.slice(0, 200),
      confidence: "possible" as const,
    };
    addStep(skill, target);
  }

  if (wantsTyposquat) {
    for (const target of targets.filter(
      (item) => item.kind === "domain" || item.kind === "url",
    )) {
      const skill = getSkill("typosquat-watch");
      const host = normalizeDomain(target.value);
      if (skill && looksLikeDomain(host)) {
        addStep(skill, {
          kind: "domain",
          value: host,
          raw: host,
          confidence: "confirmed",
        });
      }
    }
  }

  if (wantsSearch && !request.skillIds?.length) {
    const search = getSkill("web-search");
    if (search) {
      addStep(search, targetLike(message));
    }
  }

  if (attachments.length > 0) {
    const skill = getSkill("attachment-review");
    if (skill) {
      addStep(skill, {
        kind: "text",
        value: attachments.map((item) => item.name).join(", "),
        raw: message || attachments.map((item) => item.name).join(", "),
        confidence: "confirmed",
        meta: { attachments: JSON.stringify(attachments) },
      });
    }
  }

  if (wantsDeep) {
    const multiHostSkill = getSkill("host-resolution-sweep");
    if (multiHostSkill) {
      addStep(multiHostSkill, targetLike(message));
    }
    const documents = getSkill("identity-documents");
    if (documents) {
      addStep(documents, targetLike(message));
    }
  }

  if (steps.length === 0) {
    const fallback = getSkill("text-intelligence");
    if (fallback) {
      addStep(fallback, targetLike(message));
    }
    const reference = getSkill("reference-lab");
    if (reference) {
      addStep(reference, targetLike(message));
    }
  }

  if (request.skillIds?.length) {
    const filtered = steps.filter((step) => requested.has(step.skillId));
    if (filtered.length > 0) {
      return {
        targets,
        steps: filtered,
        rationale: buildRationale(targets, filtered, "focused"),
        mode: "focused",
      };
    }
  }

  const mode: Plan["mode"] = wantsDeep ? "deep" : "focused";
  return { targets, steps, rationale: buildRationale(targets, steps, mode), mode };
}

function targetLike(value: string): DetectedTarget {
  return {
    kind: "text",
    value: value.slice(0, 200),
    raw: value.slice(0, 1000),
    confidence: "possible",
  };
}

function buildRationale(
  targets: DetectedTarget[],
  steps: PlannedStep[],
  mode: Plan["mode"],
): string {
  if (targets.length === 0) {
    return `No identifiers found in the request, so the plan runs ${steps.length} text-level skill(s) to extract any that are hidden in prose.`;
  }
  const kinds = Array.from(new Set(targets.map((target) => targetLabel(target)))).join(
    ", ",
  );
  return `Detected ${targets.length} identifier(s): ${kinds}. Selected ${steps.length} skill(s) — ${
    mode === "deep"
      ? "full sweep including batch and document checks"
      : "a focused pass on the identifier types present"
  }. Sources that need a key are still listed; they report themselves as unavailable instead of guessing.`;
}
