import { request, source } from "@/lib/net/http";
import { attrs, entity, evidence as makeEvidence } from "@/lib/skills/emit";
import { maskDigits } from "@/lib/skills/validators";
import type { AttachmentInput, Evidence, SkillDefinition } from "@/lib/types";

/* ------------------------------ Hash intel ----------------------------- */

const HASH_FORMATS: Array<{ bits: number; regex: RegExp; note: string }> = [
  {
    bits: 32,
    regex: /^[a-f0-9]{32}$/,
    note: "MD5 — weak, collisions are practical. Legacy integrity only.",
  },
  {
    bits: 40,
    regex: /^[a-f0-9]{40}$/,
    note: "SHA-1 — deprecated for collision resistance (SHAttered).",
  },
  {
    bits: 64,
    regex: /^[a-f0-9]{64}$/,
    note: "SHA-256 — the current default for file integrity.",
  },
  { bits: 96, regex: /^[a-f0-9]{96}$/, note: "SHA-384." },
  { bits: 128, regex: /^[a-f0-9]{128}$/, note: "SHA-512." },
];

export const hashIntel: SkillDefinition = {
  id: "hash-intel",
  name: "Hash intelligence",
  short: "Hash",
  description:
    "Identifies a hash algorithm from its length and charset, explains its strength, and offers hash-corpus lookup when a VirusTotal key is configured.",
  category: "media",
  runtime: "local",
  accepts: ["hash"],
  produces: ["hash-type", "strength"],
  keywords: ["hash", "md5", "sha1", "sha256", "checksum", "digest", "file", "malware"],
  clientFallback: true,
  async run(target, ctx) {
    const skill = "hash-intel";
    const value = target.value.trim().toLowerCase();
    const localSrc = source(
      "local:hashformats",
      "Bundled hash-format reference (offline)",
      undefined,
      "local",
    );
    const format = HASH_FORMATS.find((item) => item.regex.test(value));

    if (!format) {
      return {
        status: "partial",
        summary: "Value does not match a known hexadecimal digest format.",
        evidence: [
          makeEvidence(skill, "Format", "unrecognised", {
            source: localSrc,
            confidence: "unknown",
            detail: "Checked MD5, SHA-1, SHA-256, SHA-384 and SHA-512 hexadecimal forms.",
          }),
        ],
        entities: [],
        sources: [localSrc],
      };
    }

    const evidenceItems = [
      makeEvidence(skill, "Algorithm", `${format.bits * 4}-bit digest`, {
        source: localSrc,
      }),
      makeEvidence(skill, "Strength", format.note, {
        source: localSrc,
        severity: format.bits < 128 ? "medium" : "info",
      }),
      makeEvidence(skill, "Normalised digest", value, {
        source: localSrc,
        kind: "metric",
      }),
    ];

    const vtKey = ctx.env("VIRUSTOTAL_API_KEY");
    if (vtKey) {
      const vtSrc = source(
        "hash:virustotal",
        "VirusTotal file report",
        `https://www.virustotal.com/api/v3/files/${value}`,
        "api",
      );
      const report = await request<{
        data?: {
          attributes?: {
            last_analysis_stats?: {
              malicious?: number;
              suspicious?: number;
              undetected?: number;
            };
            meaningful_name?: string;
            type_description?: string;
            times_submitted?: number;
          };
        };
      }>(`https://www.virustotal.com/api/v3/files/${encodeURIComponent(value)}`, ctx, {
        headers: { "x-apikey": vtKey },
        timeoutMs: 12000,
        retries: 0,
      });

      const vtData = report.ok ? report.data.data?.attributes : undefined;
      if (report.ok && vtData) {
        const stats = vtData.last_analysis_stats ?? {};
        evidenceItems.push(
          makeEvidence(
            skill,
            "VirusTotal detections",
            `${stats.malicious ?? 0} malicious / ${stats.suspicious ?? 0} suspicious / ${stats.undetected ?? 0} clean`,
            {
              source: vtSrc,
              severity: (stats.malicious ?? 0) > 0 ? "critical" : "info",
            },
          ),
          makeEvidence(skill, "Sample name", vtData.meaningful_name ?? "unknown", {
            source: vtSrc,
          }),
          makeEvidence(skill, "File type", vtData.type_description ?? "unknown", {
            source: vtSrc,
          }),
        );
      } else {
        const notFound = !report.ok && report.error.status === 404;
        evidenceItems.push(
          makeEvidence(
            skill,
            "Corpus lookup",
            notFound ? "hash unknown to the corpus" : "lookup unavailable this run",
            {
              source: vtSrc,
              confidence: notFound ? "confirmed" : "unknown",
              kind: "warning",
            },
          ),
        );
      }
    } else {
      evidenceItems.push(
        makeEvidence(
          skill,
          "Corpus lookup",
          "not performed — VIRUSTOTAL_API_KEY not configured",
          {
            source: localSrc,
            kind: "warning",
            confidence: "unknown",
            detail:
              "Without a corpus key this skill stays local and says so, rather than implying the sample is clean.",
          },
        ),
      );
    }

    return {
      status: "ok",
      summary: `${format.bits * 4}-bit digest identified. ${format.note}`,
      evidence: evidenceItems,
      entities: [entity(skill, "hash", value, `${format.bits * 4}-bit digest`)],
      sources: [localSrc],
    };
  },
};

/* --------------------------- Attachment review ------------------------- */

export type { AttachmentInput } from "@/lib/types";

export const attachmentReview: SkillDefinition = {
  id: "attachment-review",
  name: "Attachment forensics",
  short: "File",
  description:
    "Interprets file metadata extracted in the browser — camera and software fingerprint, GPS position, timestamp consistency and metadata stripping — and hashes the file locally.",
  category: "media",
  runtime: "local",
  accepts: ["text", "url"],
  produces: ["exif", "device-fingerprint", "timestamps", "gps"],
  keywords: [
    "image",
    "photo",
    "exif",
    "metadata",
    "file",
    "gps",
    "camera",
    "screenshot",
    "attachment",
  ],
  clientFallback: true,
  async run(target, _ctx) {
    const skill = "attachment-review";
    const localSrc = source(
      "local:exif",
      "In-browser EXIF extraction (exifr)",
      "https://github.com/MikeKovarik/exifr",
      "local",
    );
    const attachments = readAttachments(target.meta);

    if (attachments.length === 0) {
      return {
        status: "partial",
        summary: "No file attached to this request — nothing to inspect.",
        evidence: [
          makeEvidence(skill, "Attachment review", "no file supplied", {
            source: localSrc,
            kind: "warning",
            confidence: "confirmed",
          }),
        ],
        entities: [],
        sources: [localSrc],
      };
    }

    const evidenceItems: Evidence[] = [];
    const entities = [];

    for (const file of attachments) {
      evidenceItems.push(
        makeEvidence(skill, `File — ${file.name}`, describeFile(file), {
          source: localSrc,
          kind: "artifact",
          raw: file.exif,
        }),
      );

      if (file.sha256) {
        evidenceItems.push(
          makeEvidence(skill, "SHA-256", file.sha256, {
            source: localSrc,
            detail: `Computed locally in the browser from the exact bytes supplied. MD5 ${file.md5 ?? "n/a"}.`,
            kind: "metric",
          }),
        );
      }

      if (typeof file.entropyBits === "number") {
        evidenceItems.push(
          makeEvidence(
            skill,
            "Byte entropy",
            `${file.entropyBits.toFixed(2)} bits/byte`,
            {
              source: localSrc,
              severity: file.entropyBits > 7.5 ? "low" : "info",
              detail:
                file.entropyBits > 7.5
                  ? "Near-maximum entropy: encrypted, compressed or packed container."
                  : "Ordinary entropy for a media/document container.",
              kind: "metric",
            },
          ),
        );
      }

      if (!file.hasExif) {
        evidenceItems.push(
          makeEvidence(skill, "Metadata state", "EXIF stripped or never present", {
            source: localSrc,
            severity: "medium",
            detail:
              "Screenshots, chat-app resends and social platforms strip EXIF. Stripping is normal for messengers but is also the standard way to launder provenance from a photo.",
          }),
        );
      }

      const exif = file.exif ?? {};
      const camera = [asString(exif.Make), asString(exif.Model)]
        .filter(Boolean)
        .join(" ");
      if (camera) {
        evidenceItems.push(
          makeEvidence(skill, "Capture device", camera, { source: localSrc, raw: exif }),
        );
        entities.push(
          entity(
            skill,
            "text",
            camera,
            "Capture device",
            attrs({ software: asString(exif.Software) }),
            "confirmed",
          ),
        );
      }
      if (exif.SerialNumber || exif.LensSerialNumber) {
        evidenceItems.push(
          makeEvidence(
            skill,
            "Body / lens serial",
            [asString(exif.SerialNumber), asString(exif.LensSerialNumber)]
              .filter(Boolean)
              .join(" · "),
            {
              source: localSrc,
              severity: "medium",
              detail:
                "Serials uniquely identify one camera body — a strong link between multiple photographs.",
            },
          ),
        );
      }
      if (exif.Software) {
        evidenceItems.push(
          makeEvidence(
            skill,
            "Processing software",
            asString(exif.Software) ?? "unknown",
            {
              source: localSrc,
            },
          ),
        );
      }

      const created = exif.DateTimeOriginal ?? exif.CreateDate;
      const modified = exif.ModifyDate;
      if (created) {
        evidenceItems.push(
          makeEvidence(skill, "Original timestamp", asString(created) ?? "unknown", {
            source: localSrc,
          }),
        );
      }
      if (modified && created && String(modified) !== String(created)) {
        evidenceItems.push(
          makeEvidence(skill, "Modified after capture", asString(modified) ?? "unknown", {
            source: localSrc,
            severity: "medium",
            detail: `Captured ${asString(created)}, modified ${asString(modified)} — the file was edited after leaving the camera.`,
          }),
        );
      }

      if (file.coordinates) {
        evidenceItems.push(
          makeEvidence(
            skill,
            "GPS position",
            `${file.coordinates.lat.toFixed(6)}, ${file.coordinates.lon.toFixed(6)}`,
            {
              source: localSrc,
              severity: "high",
              detail:
                "The file carries the device's position at capture time. Treat this as the person's location — handle accordingly and never publish it unmasked.",
            },
          ),
        );
        entities.push(
          entity(
            skill,
            "coordinate",
            `${file.coordinates.lat},${file.coordinates.lon}`,
            "Capture location",
            [],
            "confirmed",
          ),
        );
      } else {
        evidenceItems.push(
          makeEvidence(skill, "GPS position", "not present in metadata", {
            source: localSrc,
            confidence: "probable",
          }),
        );
      }

      if (file.exifErrors?.length) {
        evidenceItems.push(
          makeEvidence(skill, "Extraction notes", file.exifErrors.join(" · "), {
            source: localSrc,
            kind: "warning",
            confidence: "unknown",
          }),
        );
      }
    }

    return {
      status: "ok",
      summary: `${attachments.length} file(s) reviewed: ${attachments
        .map(
          (file) =>
            `${file.name}${file.hasExif ? " (metadata present)" : " (metadata stripped)"}`,
        )
        .join(", ")}.`,
      evidence: evidenceItems,
      entities,
      sources: [localSrc],
    };
  },
};

function describeFile(file: AttachmentInput): string {
  const size = file.sizeBytes
    ? `${(file.sizeBytes / 1024).toFixed(1)} KiB`
    : "size unknown";
  return `${file.type || "unknown type"} · ${size}${file.hasExif ? " · EXIF present" : " · no EXIF"}`;
}

function asString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

function readAttachments(meta: Record<string, string> | undefined): AttachmentInput[] {
  if (!meta?.attachments) {
    return [];
  }
  try {
    const parsed = JSON.parse(meta.attachments) as AttachmentInput[];
    return Array.isArray(parsed) ? parsed.slice(0, 6) : [];
  } catch {
    return [];
  }
}

export const mediaSkills: SkillDefinition[] = [attachmentReview, hashIntel];
export const maskDocumentNumber = maskDigits;
