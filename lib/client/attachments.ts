"use client";

import exifr from "exifr";
import { analyseDocument } from "@/lib/client/documents";
import { md5, sha1, sha256, shannonEntropy } from "@/lib/crypto/digest";
import type { AttachmentPayload, Evidence } from "@/lib/types";
import { newId } from "@/lib/utils";

export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

const TEXT_TYPES = /^(text\/|application\/(json|xml|x-yaml|javascript|sql|csv))/;

const EXIF_KEYS = [
  "Make",
  "Model",
  "Software",
  "SerialNumber",
  "LensModel",
  "LensSerialNumber",
  "DateTimeOriginal",
  "CreateDate",
  "ModifyDate",
  "Artist",
  "Copyright",
  "Orientation",
  "ExposureTime",
  "FNumber",
  "ISO",
  "FocalLength",
  "ImageWidth",
  "ImageHeight",
  "UserComment",
] as const;

/**
 * Files never leave the browser: EXIF, hashing and entropy all happen here, and
 * only the derived findings travel with the request.
 */
export async function analyseAttachment(
  file: File,
): Promise<AttachmentPayload & { previewUrl?: string }> {
  const evidence: Evidence[] = [];
  const skillId = "attachment-review";

  if (file.size > MAX_ATTACHMENT_BYTES) {
    return {
      name: file.name,
      type: file.type,
      sizeBytes: file.size,
      hasExif: false,
      summary: `Skipped: ${(file.size / 1024 / 1024).toFixed(1)} MB exceeds the 8 MB analysis limit.`,
      evidence: [
        {
          id: newId("ev"),
          skillId,
          kind: "warning",
          label: "File too large",
          value: `${(file.size / 1024 / 1024).toFixed(1)} MB`,
          confidence: "confirmed",
          observedAt: Date.now(),
        },
      ],
    };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const [digest256, digest1, digestMd5] = await Promise.all([
    sha256(bytes),
    sha1(bytes),
    Promise.resolve(md5(bytes)),
  ]);
  const entropyBits = shannonEntropy(bytes);

  evidence.push(
    {
      id: newId("ev"),
      skillId,
      kind: "metric",
      label: "SHA-256",
      value: digest256,
      confidence: "confirmed",
      observedAt: Date.now(),
    },
    {
      id: newId("ev"),
      skillId,
      kind: "metric",
      label: "MD5 / SHA-1",
      value: `${digestMd5} · ${digest1}`,
      confidence: "confirmed",
      observedAt: Date.now(),
    },
    {
      id: newId("ev"),
      skillId,
      kind: "metric",
      label: "Size & entropy",
      value: `${(bytes.length / 1024).toFixed(1)} KiB · ${entropyBits.toFixed(2)} bits/byte`,
      confidence: "confirmed",
      observedAt: Date.now(),
    },
  );

  const payload: AttachmentPayload & { previewUrl?: string } = {
    name: file.name,
    type: file.type || "unknown",
    sizeBytes: file.size,
    sha256: digest256,
    md5: digestMd5,
    entropyBits,
    hasExif: false,
    summary: `${file.type || "unknown type"}, ${(bytes.length / 1024).toFixed(1)} KiB`,
    evidence,
  };

  if (file.type.startsWith("image/")) {
    payload.previewUrl = URL.createObjectURL(file);
    try {
      const parsed = (await exifr.parse(bytes, {
        tiff: true,
        exif: true,
        gps: true,
        translateKeys: true,
        translateValues: true,
        reviveValues: true,
        pick: [...EXIF_KEYS, "latitude", "longitude", "GPSLatitude", "GPSLongitude"],
      })) as Record<string, unknown> | undefined;

      if (parsed && Object.keys(parsed).length > 0) {
        payload.hasExif = true;
        const exif: Record<string, string | number | boolean> = {};
        for (const [key, value] of Object.entries(parsed)) {
          if (value === undefined || value === null || value === "") {
            continue;
          }
          if (value instanceof Date) {
            exif[key] = value.toISOString();
          } else if (
            typeof value === "number" ||
            typeof value === "string" ||
            typeof value === "boolean"
          ) {
            exif[key] = value;
          }
        }
        payload.exif = exif;

        const lat = typeof parsed.latitude === "number" ? parsed.latitude : undefined;
        const lon = typeof parsed.longitude === "number" ? parsed.longitude : undefined;
        if (lat !== undefined && lon !== undefined) {
          payload.coordinates = { lat, lon };
        }
        payload.summary = `Image${exif.Make || exif.Model ? ` from ${[exif.Make, exif.Model].filter(Boolean).join(" ")}` : ""}${
          payload.coordinates ? ", GPS embedded" : ""
        }`;
      } else {
        payload.exifErrors = [
          "No EXIF block found — the file was stripped or re-encoded before it reached you.",
        ];
      }
    } catch (error) {
      payload.exifErrors = [
        error instanceof Error
          ? `EXIF parse failed: ${error.message}`
          : "EXIF parse failed.",
      ];
    }
    return payload;
  }

  const document = analyseDocument(bytes);
  if (document) {
    payload.document = document;
    payload.summary = [
      document.format,
      document.pages ? `${document.pages} page(s)` : undefined,
      document.producer ? `produced by ${document.producer}` : undefined,
      document.author ? `author ${document.author}` : undefined,
    ]
      .filter(Boolean)
      .join(", ");
    evidence.push({
      id: newId("ev"),
      skillId,
      kind: "artifact",
      label: "Document metadata",
      value: payload.summary,
      confidence: "confirmed",
      observedAt: Date.now(),
      detail: document.notes?.join(" "),
    });
  } else if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
    evidence.push({
      id: newId("ev"),
      skillId: "attachment-review",
      kind: "warning",
      label: "PDF header missing",
      value: "the file is named/typed as PDF but does not begin with %PDF-",
      confidence: "confirmed",
      observedAt: Date.now(),
      severity: "medium",
    });
    payload.document = { format: "not a valid PDF", notes: [] };
    payload.summary = "Claimed to be a PDF but the %PDF- header is absent.";
  }

  if (
    TEXT_TYPES.test(file.type) ||
    /\.(txt|json|csv|log|md|eml|xml|yaml|yml)$/i.test(file.name)
  ) {
    payload.textPreview = new TextDecoder().decode(bytes.slice(0, 6000));
    payload.summary = `Text document, ${(bytes.length / 1024).toFixed(1)} KiB previewed locally`;
  }

  return payload;
}

export function releasePreview(url?: string) {
  if (url?.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
}
