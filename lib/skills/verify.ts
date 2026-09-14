import { isRelayOk, relayText } from "@/lib/client/cors-fetch";
import { source } from "@/lib/net/http";
import { evidence } from "@/lib/skills/emit";
import type {
  AttachmentInput,
  NetContext,
  SkillDefinition,
  SkillOutcome,
} from "@/lib/types";
import { newId, truncate } from "@/lib/utils";
import {
  type ForwardCandidate,
  type ForwardFinding,
  GSTIN_PATTERN,
  verdictForForward,
} from "@/lib/verify-values";

/**
 * The honesty layer users can feel:
 *
 *  - `forward-check`: paste a WhatsApp forward, get "forward this" / "don't"
 *    from what the open web actually shows — first appearance, independent
 *    corroboration, fact-check signals. Never a gut feeling.
 *  - `receipt-scan`: a photo of a shop bill, read in the browser; GSTIN with
 *    its mod-36 checksum, amount, date. It says what the paper shows and
 *    explicitly does NOT claim a government database confirmed anything.
 */

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export const forwardCheck: SkillDefinition = {
  id: "forward-check",
  name: "Forward checker",
  short: "Forward",
  description:
    "Pastes a WhatsApp forward and answers the only question that matters: forward this, or don't. Finds the first appearance, counts independent outlets, checks fact-checkers.",
  category: "retrieval",
  runtime: "live",
  accepts: ["text"],
  produces: ["verdict", "first-appearance", "corroboration"],
  keywords: [
    "forward",
    "forwarded",
    "whatsapp",
    "fact check",
    "factcheck",
    "fake news",
    "is this true",
    "is this real",
    "is this fake",
    "viral message",
    "before you forward",
  ],
  clientFallback: true,
  async run(target, ctx) {
    const skill = "forward-check";
    const claim = target.value.trim();
    const originalMessage = target.raw ?? claim;

    // The claim, not the chain: forwarded-as-received noise is stripped before
    // anything is searched.
    const { claimQueryOf, cleanForwardText } = await import("@/lib/verify-values");
    const cleaned = cleanForwardText(claim || originalMessage);
    const query = claimQueryOf(cleaned);
    if (query.split(" ").length < 3) {
      return {
        status: "partial",
        summary:
          "That forward is too short or too generic to trace — give me a line or two with the actual claim in it.",
        evidence: [
          evidence(skill, "Claim", truncate(cleaned || claim, 200), {
            source: source("forward", "Forward checker", undefined, "local"),
            kind: "warning",
            confidence: "unknown",
            detail: "Fewer than three searchable words survived the noise stripping.",
          }),
        ],
        entities: [],
        sources: [source("forward", "Forward checker", undefined, "local")],
      };
    }

    ctx.log(`Tracing the claim: “${truncate(query, 80)}”`);
    const { webSearch } = await import("@/lib/client/web-search");
    const engineSource = source(
      "forward-web",
      "Open web (DuckDuckGo / Bing)",
      "https://duckduckgo.com",
      "dataset",
    );

    const primary = await webSearch(query, { limit: 20, signal: ctx.signal });
    const factcheck = await webSearch(`${query} fact check`, {
      limit: 14,
      signal: ctx.signal,
    });

    const candidates: ForwardCandidate[] = [...primary.results, ...factcheck.results]
      .filter((result) => result.host && !result.host.includes("duckduckgo"))
      .map((result) => ({
        title: result.title,
        url: result.url,
        snippet: result.snippet,
        host: result.host,
      }));

    const finding: ForwardFinding = verdictForForward(cleaned, candidates);

    if (candidates.length === 0) {
      return {
        status: "unreachable",
        summary:
          "The open web could not be reached from this browser, so the forward could not be traced — no verdict is offered, because none could be earned.",
        evidence: [
          evidence(skill, "Search", primary.error ?? "no results", {
            source: engineSource,
            kind: "warning",
            confidence: "unknown",
          }),
        ],
        entities: [],
        sources: [engineSource],
        error: { code: "egress_blocked", message: primary.error ?? "no candidates" },
      };
    }

    const verdictValue =
      finding.verdict === "forward"
        ? "FORWARD"
        : finding.verdict === "dont"
          ? "DON'T FORWARD"
          : "HOLD";
    const evidenceItems: SkillOutcome["evidence"] = [
      evidence(skill, "Verdict", verdictValue, {
        source: engineSource,
        confidence: "confirmed",
        kind: "record",
        detail: finding.headline,
      }),
      ...finding.reasons.map((reason, index) =>
        evidence(skill, `Why ${index + 1}`, reason, {
          source: engineSource,
          confidence: finding.verdict === "forward" ? "probable" : "possible",
          kind: "record",
        }),
      ),
      ...finding.factChecks.slice(0, 4).map((check) =>
        evidence(
          skill,
          check.negative ? "Fact-check: false" : "Fact-check",
          `${check.host} — ${truncate(check.snippet, 160)}`,
          {
            source: {
              ...engineSource,
              id: `fc-${check.host}`,
              url: check.url,
              label: check.host,
            } as typeof engineSource,
            confidence: "confirmed",
            kind: "reference",
          },
        ),
      ),
    ];

    const articles = candidates.slice(0, 14).map((candidate) => ({
      id: newId("fw"),
      title: candidate.title,
      url: candidate.url,
      domain: candidate.host,
      source: candidate.host,
      snippet: candidate.snippet || undefined,
      shelf: "forward" as const,
    }));

    const summaryLine =
      finding.verdict === "forward"
        ? `**Forward — but check the sources below.** ${finding.headline}. ${finding.reasons.join(" ")}`
        : finding.verdict === "dont"
          ? `**Don't forward.** ${finding.headline}. ${finding.reasons.join(" ")}`
          : `**Hold on — unverified.** ${finding.headline}. ${finding.reasons.join(" ")} Ask me again with more of the message if the claim is more specific.`;

    return {
      status: "ok",
      summary: summaryLine,
      evidence: evidenceItems,
      entities: [],
      sources: [engineSource],
      articles,
    };
  },
};

/* ------------------------------------------------------- receipt scan ----- */

interface TesseractWorker {
  recognize: (image: File | string) => Promise<{ data: { text: string } }>;
  terminate: () => Promise<unknown>;
}

interface TesseractModule {
  createWorker: (
    lang: string,
    oem?: number,
    options?: Record<string, unknown>,
  ) => Promise<TesseractWorker>;
}

/** Browser-side cache of the exact attached files, for skills that need bytes. */
const bytesCache: Map<string, File> =
  (globalThis as { __skoitAttachmentBytes?: Map<string, File> }).__skoitAttachmentBytes ??
  new Map();
(globalThis as { __skoitAttachmentBytes?: Map<string, File> }).__skoitAttachmentBytes =
  bytesCache;

export function cacheAttachmentBytes(file: File): void {
  bytesCache.set(file.name, file);
  if (bytesCache.size > 6) {
    const oldest = bytesCache.keys().next().value;
    if (oldest) {
      bytesCache.delete(oldest);
    }
  }
}

async function ocrInBrowser(file: File): Promise<string> {
  const tesseract = (await import("tesseract.js")) as unknown as TesseractModule;
  const worker = await tesseract.createWorker("eng+hin", 1, {
    logger: () => undefined,
  });
  try {
    const result = await worker.recognize(file);
    return result.data.text ?? "";
  } finally {
    void worker.terminate();
  }
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

export const receiptScan: SkillDefinition = {
  id: "receipt-scan",
  name: "Receipt scanner",
  short: "Receipt",
  description:
    "Reads a photo of a shop bill in this browser: GSTIN with its mod-36 checksum, the payable amount, the date. It states exactly what the paper shows and never claims a government database confirmed anything.",
  category: "media",
  runtime: "local",
  accepts: ["text"],
  produces: ["gstin", "amount", "date", "ocr-text"],
  keywords: [
    "receipt",
    "bill",
    "invoice",
    "gst",
    "gstin",
    "shop bill",
    "scan bill",
    "raashan",
    "billa",
    "receipt scan",
  ],
  clientFallback: true,
  async run(target, ctx) {
    const skill = "receipt-scan";
    const localSource = source(
      "receipt-ocr",
      "On-device OCR (Tesseract) + GSTIN checksum arithmetic",
      "https://github.com/naptha/tesseract.js",
      "local",
    );
    const attachments = readAttachments(target.meta);
    const wantsOcr = attachments.some(
      (attachment) =>
        attachment.type?.startsWith("image/") ||
        /\.(jpe?g|png|webp)$/i.test(attachment.name),
    );

    let text = attachments
      .map((attachment) => attachment.textPreview ?? "")
      .join("\n")
      .trim();

    if (!text && wantsOcr && typeof window !== "undefined") {
      const imageAttachment = attachments.find((attachment) =>
        bytesCache.has(attachment.name),
      );
      const file = imageAttachment ? bytesCache.get(imageAttachment.name) : undefined;
      if (file) {
        ctx.log(`Running on-device OCR over ${file.name}`);
        try {
          text = await ocrInBrowser(file);
        } catch (error) {
          return {
            status: "error",
            summary:
              "The on-device OCR engine could not start — the language data may be blocked on this network. Nothing was invented to fill the gap.",
            evidence: [
              evidence(skill, "OCR", "engine unavailable", {
                source: localSource,
                kind: "warning",
                confidence: "unknown",
                detail: error instanceof Error ? error.message : "unknown OCR failure",
              }),
            ],
            entities: [],
            sources: [localSource],
          };
        }
      }
    }

    if (!text) {
      return {
        status: "partial",
        summary: wantsOcr
          ? "The bill photo did not reach the reader — attach the image in this browser and run again."
          : "Attach a photo of the bill and ask again — nothing was supplied to read.",
        evidence: [
          evidence(skill, "Input", "no readable bill text", {
            source: localSource,
            kind: "warning",
            confidence: "unknown",
          }),
        ],
        entities: [],
        sources: [localSource],
      };
    }

    const { readReceiptText } = await import("@/lib/verify-values");
    const finding = readReceiptText(text);
    const evidenceItems: SkillOutcome["evidence"] = [];

    if (finding.gstin) {
      evidenceItems.push(
        evidence(
          skill,
          "GSTIN",
          `${finding.gstin.value} — checksum ${finding.gstin.checksumValid ? "valid" : "INVALID"}`,
          {
            source: localSource,
            confidence: "confirmed",
            kind: "record",
            severity: finding.gstin.checksumValid ? "info" : "high",
            detail: `${finding.gstin.stateCode}. The checksum proves the number is well-formed — this console does not and cannot claim the department's registry verified it.`,
          },
        ),
      );
    } else {
      evidenceItems.push(
        evidence(skill, "GSTIN", "no GSTIN found on the bill", {
          source: localSource,
          kind: "warning",
          confidence: "unknown",
          detail:
            "Either the print is too faint for the reader, or the shop did not print one. Composition-scheme shops often display none.",
        }),
      );
    }
    if (finding.amount) {
      evidenceItems.push(
        evidence(skill, "Amount", `₹${finding.amount.value.toFixed(2)}`, {
          source: localSource,
          confidence: "probable",
          detail: `Read from “${finding.amount.source}” on the bill.`,
        }),
      );
    }
    if (finding.date) {
      evidenceItems.push(
        evidence(skill, "Date", finding.date.iso, {
          source: localSource,
          confidence: "probable",
          detail: `Read as “${finding.date.source}”.`,
        }),
      );
    }
    if (finding.invoiceNo) {
      evidenceItems.push(
        evidence(skill, "Invoice no", finding.invoiceNo, { source: localSource }),
      );
    }
    if (finding.vendorGuess) {
      evidenceItems.push(
        evidence(skill, "Vendor", finding.vendorGuess, {
          source: localSource,
          confidence: "possible",
          detail: "First plausible letterhead line on the bill.",
        }),
      );
    }

    const summaryBits = [
      finding.gstin
        ? `GSTIN ${finding.gstin.value} (checksum ${finding.gstin.checksumValid ? "valid" : "invalid"})`
        : "no GSTIN found",
      finding.amount ? `amount ₹${finding.amount.value.toFixed(2)}` : undefined,
      finding.date ? `dated ${finding.date.iso}` : undefined,
    ].filter(Boolean);

    return {
      status: finding.gstin || finding.amount ? "ok" : "partial",
      summary: `Bill read on this device — ${summaryBits.join(", ")}. Pattern-level checks only; no department verification is claimed.`,
      evidence: evidenceItems,
      entities: finding.gstin
        ? [
            {
              id: newId("en"),
              type: "text" as const,
              value: finding.gstin.value,
              label: "GSTIN",
              skillId: skill,
              confidence: "confirmed" as const,
              attributes: [
                {
                  key: "checksum",
                  value: finding.gstin.checksumValid ? "valid" : "invalid",
                },
                { key: "state", value: finding.gstin.stateCode },
              ],
            },
          ]
        : [],
      sources: [localSource],
    };
  },
};

export const verifySkills: SkillDefinition[] = [forwardCheck, receiptScan];

// re-exported for the UI's quick cards
export { GSTIN_PATTERN };
