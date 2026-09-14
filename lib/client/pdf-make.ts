import { jsPDF } from "jspdf";
import { decodeEntities } from "@/lib/client/reader";

/**
 * The document builder behind "make this a proper PDF".
 *
 * Not a raw copy-paste: text is structured into a title block, real headings,
 * wrapped paragraphs, bullet lists and a final **Links** appendix — every link
 * found inline is numbered in the text (`… [3]`) and listed, clickable, at the
 * back of the document, the way a report cites its sources.
 *
 * Latin text uses the built-in Helvetica. When the content is not Latin
 * (Devanagari, CJK…), a Noto font for the script is fetched once from the CDN
 * and embedded; if that fetch is impossible the document is still built and
 * the caller is told the limitation, and the print path (perfect Unicode via
 * the browser's own engine) remains available in the UI.
 */

export interface PdfSection {
  heading?: string;
  paragraphs?: string[];
  bullets?: string[];
  quote?: string;
}

export interface PdfLink {
  label: string;
  url: string;
}

export interface PdfDocInput {
  title: string;
  subtitle?: string;
  meta?: string;
  sections: PdfSection[];
  links?: PdfLink[];
  footerNote?: string;
}

export interface BuiltPdf {
  blob: Blob;
  filename: string;
  pages: number;
  unicodeNote?: string;
}

const FONT_LATIN =
  "https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/NotoSans/hinted/ttf/NotoSans-Regular.ttf";
const FONT_LATIN_BOLD =
  "https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/NotoSans/hinted/ttf/NotoSans-Bold.ttf";
const FONT_DEVA =
  "https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/NotoSansDevanagari/hinted/ttf/NotoSansDevanagari-Regular.ttf";
const FONT_DEVA_BOLD =
  "https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/NotoSansDevanagari/hinted/ttf/NotoSansDevanagari-Bold.ttf";

const fontCache = new Map<string, Promise<string | null>>();

function fetchFontAsBase64(url: string): Promise<string | null> {
  const cached = fontCache.get(url);
  if (cached) {
    return cached;
  }
  const promise = (async () => {
    try {
      const response = await fetch(url, { cache: "force-cache" });
      if (!response.ok) {
        return null;
      }
      const buffer = await response.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      const chunk = 0x8000;
      for (let index = 0; index < bytes.length; index += chunk) {
        binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
      }
      return btoa(binary);
    } catch {
      return null;
    }
  })();
  fontCache.set(url, promise);
  return promise;
}

function hasDevanagari(text: string): boolean {
  return /[\u0900-\u097F]/.test(text);
}

function needsUnicodeFont(text: string): boolean {
  // Anything beyond Latin-Extended-A/B — ignoring the typographic punctuation
  // the built-in fonts handle — needs an embedded font to survive into the PDF.
  for (const char of text.replace(/[\u2018\u2019\u201C\u201D\u2013\u2014\u2026]/g, "")) {
    const code = char.codePointAt(0) ?? 0;
    if (code > 0x24f && !(code >= 0x2000 && code <= 0x206f)) {
      return true;
    }
  }
  return false;
}

async function prepareFonts(text: string): Promise<{ family: string; note?: string }> {
  const doc = new jsPDF();
  const unicode = needsUnicodeFont(text);
  if (!unicode) {
    return { family: "helvetica" };
  }
  const deva = hasDevanagari(text);
  const regularUrl = deva ? FONT_DEVA : FONT_LATIN;
  const boldUrl = deva ? FONT_DEVA_BOLD : FONT_LATIN_BOLD;
  const family = deva ? "NotoDeva" : "NotoSans";

  const regular = await fetchFontAsBase64(regularUrl);
  if (!regular) {
    return {
      family: "helvetica",
      note: "the Unicode font could not be fetched, so non-Latin characters may not render in this file — use “Print / Save as PDF” for full script support",
    };
  }
  doc.addFileToVFS(`${family}-Regular.ttf`, regular);
  doc.addFont(`${family}-Regular.ttf`, family, "normal");
  const bold = await fetchFontAsBase64(boldUrl);
  if (bold) {
    doc.addFileToVFS(`${family}-Bold.ttf`, bold);
    doc.addFont(`${family}-Bold.ttf`, family, "bold");
    return { family };
  }
  doc.addFont(`${family}-Regular.ttf`, family, "bold");
  return { family };
}

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN = 18;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const INK = "#1d2025";
const MUTED = "#5a6070";
const FAINT = "#8a90a0";
const ACCENT = "#e5732a";

export function slugFilename(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "document"
  );
}

/** Prepare inline text: [label](url) and bare URLs become `label [n]` refs. */
function prepareInline(
  text: string,
  links: PdfLink[],
  seenUrls: Map<string, number>,
): string {
  const refFor = (url: string, label?: string): string => {
    const existing = seenUrls.get(url);
    if (existing) {
      return `[${existing}]`;
    }
    links.push({ label: label ?? url, url });
    const number = links.length;
    seenUrls.set(url, number);
    return `[${number}]`;
  };

  let out = text;
  out = out.replace(
    /\[([^\]]{1,120})\]\((https?:\/\/[^)\s]+)\)/g,
    (_, label: string, url: string) => `${label} ${refFor(url, label)}`,
  );
  out = out.replace(
    /(?:^|[\s(])((?:https?:\/\/)[^\s<)"']+[^\s<)"'.,;])(?=$|[\s).,;])/g,
    (match, url: string) =>
      match.replace(
        url,
        `${url.replace(/^https?:\/\//, "").slice(0, 46)} ${refFor(url)}`,
      ),
  );
  return out;
}

export async function buildStyledPdf(input: PdfDocInput): Promise<BuiltPdf> {
  const flatText = [
    input.title,
    input.subtitle ?? "",
    ...input.sections.flatMap((section) => [
      section.heading ?? "",
      ...(section.paragraphs ?? []),
      ...(section.bullets ?? []),
    ]),
  ].join("\n");

  const { family, note } = await prepareFonts(flatText);
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });

  const links: PdfLink[] = [];
  const seenUrls = new Map<string, number>();
  void links;

  let y = MARGIN;

  const setFont = (style: "normal" | "bold", size: number, color = INK) => {
    doc.setFont(family, style);
    doc.setFontSize(size);
    doc.setTextColor(color);
  };

  const newPageIfNeeded = (needed: number) => {
    if (y + needed > PAGE_HEIGHT - MARGIN - 8) {
      doc.addPage();
      y = MARGIN;
    }
  };

  const paragraph = (
    text: string,
    options: { size?: number; color?: string; indent?: number; gap?: number } = {},
  ) => {
    const size = options.size ?? 10.5;
    const indent = options.indent ?? 0;
    setFont("normal", size, options.color ?? INK);
    const wrapped = doc.splitTextToSize(text, CONTENT_WIDTH - indent);
    const lineheight = size * 0.52;
    for (const line of wrapped) {
      newPageIfNeeded(lineheight + 1);
      doc.text(line, MARGIN + indent, y);
      y += lineheight;
    }
    y += options.gap ?? 1.8;
  };

  // ---- Title block -------------------------------------------------------
  setFont("bold", 19);
  const titleLines = doc.splitTextToSize(input.title, CONTENT_WIDTH);
  for (const line of titleLines) {
    doc.text(line, MARGIN, y);
    y += 8.4;
  }
  if (input.subtitle) {
    paragraph(input.subtitle, { size: 11, color: MUTED, gap: 1 });
  }
  y += 1;
  doc.setDrawColor(ACCENT);
  doc.setLineWidth(0.9);
  doc.line(MARGIN, y, MARGIN + 34, y);
  y += 4.5;
  if (input.meta) {
    paragraph(input.meta, { size: 8.5, color: FAINT, gap: 2.5 });
  } else {
    y += 1.5;
  }

  // ---- Sections ----------------------------------------------------------
  for (const section of input.sections) {
    if (section.heading) {
      newPageIfNeeded(14);
      y += 2.2;
      doc.setFillColor(ACCENT);
      doc.rect(MARGIN, y - 3.1, 1.7, 4.4, "F");
      setFont("bold", 13);
      const headingLines = doc.splitTextToSize(section.heading, CONTENT_WIDTH - 5);
      doc.text(headingLines[0], MARGIN + 4.5, y);
      y += 7;
    }
    if (section.quote) {
      const size = 10.5;
      setFont("normal", size, MUTED);
      const wrapped = doc.splitTextToSize(section.quote, CONTENT_WIDTH - 8);
      const blockheight = wrapped.length * size * 0.52 + 4;
      newPageIfNeeded(blockheight);
      doc.setFillColor("#f4f1ec");
      doc.rect(MARGIN, y - 3.6, CONTENT_WIDTH, blockheight, "F");
      doc.setDrawColor(ACCENT);
      doc.setLineWidth(0.7);
      doc.line(MARGIN, y - 3.6, MARGIN, y - 3.6 + blockheight);
      let quoteY = y;
      for (const line of wrapped) {
        doc.text(line, MARGIN + 4, quoteY);
        quoteY += size * 0.52;
      }
      y = quoteY + 2.4;
    }
    for (const text of section.paragraphs ?? []) {
      paragraph(prepareInline(decodeEntities(text), links, seenUrls));
    }
    for (const bullet of section.bullets ?? []) {
      const text = prepareInline(decodeEntities(bullet), links, seenUrls);
      setFont("normal", 10.5);
      const wrapped = doc.splitTextToSize(text, CONTENT_WIDTH - 6);
      newPageIfNeeded(wrapped.length * 5.5 + 1);
      doc.setFillColor(ACCENT);
      doc.circle(MARGIN + 1.4, y - 1.3, 0.75, "F");
      doc.text(wrapped[0], MARGIN + 5.5, y);
      y += 5.5;
      for (const line of wrapped.slice(1)) {
        newPageIfNeeded(5.5);
        doc.text(line, MARGIN + 5.5, y);
        y += 5.5;
      }
      y += 1.2;
    }
  }

  // ---- Links appendix ----------------------------------------------------
  if (links.length > 0) {
    doc.addPage();
    y = MARGIN;
    doc.setFillColor(ACCENT);
    doc.rect(MARGIN, y - 3.4, 1.7, 4.8, "F");
    setFont("bold", 13);
    doc.text("Links in this document", MARGIN + 4.5, y);
    y += 8;
    paragraph(
      "Every reference number in the text resolves here, in order of first appearance. Each line below is clickable.",
      { size: 9, color: MUTED, gap: 3 },
    );
    links.forEach((link, index) => {
      newPageIfNeeded(12);
      setFont("bold", 9.5);
      const label = doc.splitTextToSize(
        `[${index + 1}] ${link.label}`.slice(0, 160),
        CONTENT_WIDTH,
      );
      doc.text(label[0], MARGIN, y);
      y += 4.6;
      setFont("normal", 8.6, "#3b62a8");
      const urlLines = doc.splitTextToSize(link.url, CONTENT_WIDTH);
      for (const line of urlLines) {
        newPageIfNeeded(4.6);
        doc.textWithLink(line, MARGIN + 2, y, { url: link.url });
        y += 4.2;
      }
      y += 1.8;
    });
  }

  // ---- Footers -----------------------------------------------------------
  const total = doc.getNumberOfPages();
  const stamp = new Date().toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  for (let index = 1; index <= total; index += 1) {
    doc.setPage(index);
    doc.setDrawColor("#d8d3ca");
    doc.setLineWidth(0.3);
    doc.line(MARGIN, PAGE_HEIGHT - 12, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 12);
    setFont("normal", 8, FAINT);
    doc.text(input.footerNote ?? `SkOiT · generated ${stamp}`, MARGIN, PAGE_HEIGHT - 7.5);
    doc.text(`Page ${index} of ${total}`, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 7.5, {
      align: "right",
    });
  }

  const blob = doc.output("blob");
  return {
    blob,
    filename: `${slugFilename(input.title)}.pdf`,
    pages: total,
    unicodeNote: note,
  };
}

/** Turn pasted text (markdown-ish or plain) into structured PDF input. */
export function markdownishToInput(
  raw: string,
  fallbackTitle: string,
  subtitle?: string,
): PdfDocInput {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  const sections: PdfSection[] = [];
  let current: PdfSection = {};
  let title = fallbackTitle;

  const flush = () => {
    if (
      current.heading ||
      (current.paragraphs ?? []).length ||
      (current.bullets ?? []).length ||
      current.quote
    ) {
      sections.push(current);
    }
    current = {};
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flush();
      continue;
    }
    const h1 = /^#\s+(.*)$/.exec(line);
    const h2 = /^#{2,4}\s+(.*)$/.exec(line);
    const bullet = /^(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (h1 && sections.length === 0 && !current.heading && title === fallbackTitle) {
      title = h1[1].trim().slice(0, 120);
      continue;
    }
    if (h1 || h2) {
      flush();
      current.heading = (h1 ?? h2)?.[1].trim().slice(0, 160);
      continue;
    }
    if (bullet) {
      if (current.bullets === undefined) {
        current.bullets = [];
      }
      current.bullets.push(bullet[1].trim());
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quotePart = line.replace(/^>\s?/, "");
      current.quote = current.quote ? `${current.quote} ${quotePart}` : quotePart;
      continue;
    }
    if (current.paragraphs === undefined) {
      current.paragraphs = [];
    }
    current.paragraphs.push(line);
  }
  flush();

  if (sections.length === 0) {
    sections.push({ paragraphs: [raw.trim().slice(0, 8000)] });
  }
  return { title, subtitle, sections };
}
