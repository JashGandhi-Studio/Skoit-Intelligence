import {
  degrees,
  PDFDocument,
  type PDFFont,
  type PDFPage,
  rgb,
  StandardFonts,
} from "pdf-lib";

/**
 * The Document Workshop engine — every tool runs entirely in the browser with
 * pdf-lib; files never leave the machine. Tools that are honestly impossible
 * client-side (Word/Excel/PPT conversion, password cracking) are simply not
 * offered rather than faked.
 */

export interface NamedBytes {
  name: string;
  bytes: Uint8Array;
}

export class PdfToolError extends Error {}

function parsePageSpec(spec: string, pageCount: number, what: string): number[] {
  const cleaned = spec.trim().toLowerCase();
  if (!cleaned) {
    throw new PdfToolError(`Give a page range for “${what}” — for example 1-3, 5`);
  }
  const pages = new Set<number>();
  for (const part of cleaned.split(",")) {
    const chunk = part.trim();
    if (!chunk) {
      continue;
    }
    const range = /^(\d+)\s*[-–]\s*(\d+)$/.exec(chunk);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (start < 1 || end > pageCount || start > end) {
        throw new PdfToolError(
          `Range ${chunk} is outside this document (1–${pageCount}).`,
        );
      }
      for (let page = start; page <= end; page += 1) {
        pages.add(page);
      }
      continue;
    }
    const single = /^(\d+)$/.exec(chunk);
    if (single) {
      const page = Number(single[1]);
      if (page < 1 || page > pageCount) {
        throw new PdfToolError(`Page ${page} does not exist (1–${pageCount}).`);
      }
      pages.add(page);
      continue;
    }
    if (chunk === "all" || chunk === "*") {
      for (let page = 1; page <= pageCount; page += 1) {
        pages.add(page);
      }
      continue;
    }
    throw new PdfToolError(`“${chunk}” is not a page or range like 2 or 1-3.`);
  }
  const ordered = [...pages].sort((a, b) => a - b);
  if (ordered.length === 0) {
    throw new PdfToolError("No pages selected.");
  }
  return ordered;
}

async function load(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
  } catch {
    throw new PdfToolError("That file does not look like a readable PDF.");
  }
}

async function save(doc: PDFDocument): Promise<Uint8Array> {
  return doc.save({ useObjectStreams: true });
}

export function baseName(name: string): string {
  return name.replace(/\.pdf$/i, "");
}

/* --------------------------------------------------------------- merge ---- */

export async function mergePdfs(files: NamedBytes[]): Promise<Uint8Array> {
  if (files.length < 2) {
    throw new PdfToolError("Pick at least two PDFs to merge.");
  }
  const out = await PDFDocument.create();
  out.setTitle(files.map((file) => baseName(file.name)).join(" + "));
  out.setProducer("SkOiT Document Workshop");
  for (const file of files) {
    const doc = await load(file.bytes);
    const pages = await out.copyPages(doc, doc.getPageIndices());
    for (const page of pages) {
      out.addPage(page);
    }
  }
  return save(out);
}

/* --------------------------------------------------------------- split ---- */

export interface SplitResult {
  name: string;
  bytes: Uint8Array;
}

export async function splitPdf(file: NamedBytes, spec: string): Promise<SplitResult[]> {
  const doc = await load(file.bytes);
  const pageCount = doc.getPageCount();
  const base = baseName(file.name);

  if (/^(all|every|each)\b/.test(spec.trim().toLowerCase())) {
    const results: SplitResult[] = [];
    for (let index = 0; index < pageCount; index += 1) {
      const single = await PDFDocument.create();
      const [copied] = await single.copyPages(doc, [index]);
      single.addPage(copied);
      results.push({
        name: `${base}-page-${String(index + 1).padStart(2, "0")}.pdf`,
        bytes: await save(single),
      });
    }
    return results;
  }

  const pages = parsePageSpec(spec, pageCount, "extract");
  const out = await PDFDocument.create();
  out.setTitle(`${base} (pages ${pages[0]}–${pages[pages.length - 1]})`);
  out.setProducer("SkOiT Document Workshop");
  const copied = await out.copyPages(
    doc,
    pages.map((page) => page - 1),
  );
  for (const page of copied) {
    out.addPage(page);
  }
  return [
    {
      name: `${base}-p${pages[0]}${pages.length > 1 ? `-p${pages[pages.length - 1]}` : ""}.pdf`,
      bytes: await save(out),
    },
  ];
}

/* -------------------------------------------------------------- rotate ---- */

export async function rotatePdf(
  file: NamedBytes,
  spec: string,
  angle: 90 | 180 | 270,
): Promise<Uint8Array> {
  const doc = await load(file.bytes);
  const pageCount = doc.getPageCount();
  const targets = spec.trim()
    ? parsePageSpec(spec, pageCount, "rotate")
    : doc.getPageIndices().map((index) => index + 1);
  for (const pageNumber of targets) {
    const page = doc.getPage(pageNumber - 1);
    const current = page.getRotation().angle ?? 0;
    page.setRotation(degrees((current + angle) % 360));
  }
  doc.setProducer("SkOiT Document Workshop");
  return save(doc);
}

/* -------------------------------------------------------------- remove ---- */

export async function removePages(file: NamedBytes, spec: string): Promise<Uint8Array> {
  const doc = await load(file.bytes);
  const pageCount = doc.getPageCount();
  const remove = new Set(parsePageSpec(spec, pageCount, "delete"));
  if (remove.size >= pageCount) {
    throw new PdfToolError("That would delete every page.");
  }
  for (let index = pageCount; index >= 1; index -= 1) {
    if (remove.has(index)) {
      doc.removePage(index - 1);
    }
  }
  doc.setProducer("SkOiT Document Workshop");
  return save(doc);
}

/* ----------------------------------------------------------- watermark ---- */

export async function watermarkPdf(
  file: NamedBytes,
  text: string,
  opacity = 0.14,
): Promise<Uint8Array> {
  const clean = text.trim().slice(0, 60);
  if (!clean) {
    throw new PdfToolError("Type the watermark text first.");
  }
  const doc = await load(file.bytes);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  for (const page of doc.getPages()) {
    drawDiagonal(page, font, clean, opacity);
  }
  doc.setProducer("SkOiT Document Workshop");
  return save(doc);
}

function drawDiagonal(page: PDFPage, font: PDFFont, text: string, opacity: number): void {
  const { width, height } = page.getSize();
  const size = Math.min(52, Math.max(24, width / (text.length * 0.42)));
  const textWidth = font.widthOfTextAtSize(text, size);
  const angle = Math.atan2(height, width) * (180 / Math.PI);
  page.drawText(text, {
    x: width / 2 - (textWidth / 2) * 0.82,
    y: height / 2 - (size / 2) * 0.82,
    size,
    font,
    color: rgb(0.16, 0.18, 0.22),
    opacity,
    rotate: degrees(angle),
  });
}

/* -------------------------------------------------------- page numbers ---- */

export async function numberPdf(
  file: NamedBytes,
  options: { format?: "x-of-y" | "plain" } = {},
): Promise<Uint8Array> {
  const doc = await load(file.bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  pages.forEach((page, index) => {
    const { width } = page.getSize();
    const label =
      options.format === "plain"
        ? `${index + 1}`
        : `Page ${index + 1} of ${pages.length}`;
    const size = 9;
    const textWidth = font.widthOfTextAtSize(label, size);
    page.drawText(label, {
      x: width / 2 - textWidth / 2,
      y: 14,
      size,
      font,
      color: rgb(0.35, 0.37, 0.42),
    });
  });
  doc.setProducer("SkOiT Document Workshop");
  return save(doc);
}

/* ---------------------------------------------------------- images → pdf -- */

const IMAGE_TYPES = ["image/jpeg", "image/png"];

export async function imagesToPdf(
  files: Array<{ name: string; bytes: Uint8Array; mime: string }>,
): Promise<Uint8Array> {
  const usable = files.filter((file) => IMAGE_TYPES.includes(file.mime));
  if (usable.length === 0) {
    throw new PdfToolError(
      "Pick JPG or PNG images — other formats are not embeddable in a PDF.",
    );
  }
  const doc = await PDFDocument.create();
  doc.setTitle("Images");
  doc.setProducer("SkOiT Document Workshop");
  for (const file of usable) {
    try {
      const image =
        file.mime === "image/png"
          ? await doc.embedPng(file.bytes)
          : await doc.embedJpg(file.bytes);
      const maxwidth = 560;
      const scale = Math.min(1, maxwidth / image.width);
      const page = doc.addPage([image.width * scale + 36, image.height * scale + 36]);
      page.drawImage(image, {
        x: 18,
        y: 18,
        width: image.width * scale,
        height: image.height * scale,
      });
    } catch {
      throw new PdfToolError(
        `“${file.name}” could not be embedded — try re-saving it as JPG or PNG.`,
      );
    }
  }
  return save(doc);
}

/* -------------------------------------------------------- page count ------ */

export async function countPages(bytes: Uint8Array): Promise<number> {
  const doc = await load(bytes);
  return doc.getPageCount();
}

/* ---------------------------------------------------------------- n-up ---- */

/** Embed 2 or 4 source pages per A4 sheet (handout style). */
export async function nUpPdf(file: NamedBytes, perSheet: 2 | 4): Promise<Uint8Array> {
  const src = await load(file.bytes);
  const out = await PDFDocument.create();
  out.setTitle(`${baseName(file.name)} (${perSheet}-up)`);
  out.setProducer("SkOiT Document Workshop");
  const a4width = 595.28;
  const a4height = 841.89;

  const embedded = await out.embedPages(src.getPages());
  const cols = perSheet === 2 ? 1 : 2;
  const rows = perSheet === 2 ? 2 : 2;
  const cellWidth = (a4width - 24) / cols;
  const cellHeight = (a4height - 24) / rows;

  for (let index = 0; index < embedded.length; index += perSheet) {
    const page = out.addPage([a4width, a4height]);
    const batch = embedded.slice(index, index + perSheet);
    batch.forEach((cell, position) => {
      const col = position % cols;
      const row = Math.floor(position / cols);
      const scale = Math.min(cellWidth / cell.width, cellHeight / cell.height);
      const width = cell.width * scale;
      const height = cell.height * scale;
      const x = 12 + col * cellWidth + (cellWidth - width) / 2;
      const y = a4height - 12 - (row + 1) * cellHeight + (cellHeight - height) / 2;
      page.drawPage(cell, { x, y, width, height });
    });
  }
  return save(out);
}

/* ------------------------------------------------------- normalize A4 ----- */

/** Scale every page onto exact A4 — mixed-size scans become one clean stack. */
export async function normalizeA4Pdf(file: NamedBytes): Promise<Uint8Array> {
  const doc = await load(file.bytes);
  const a4width = 595.28;
  const a4height = 841.89;
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    const alreadyA4 = Math.abs(width - a4width) < 1 && Math.abs(height - a4height) < 1;
    if (alreadyA4) {
      continue;
    }
    const scale = Math.min(a4width / width, a4height / height) * 0.98;
    page.scaleContent(scale, scale);
    page.setSize(a4width, a4height);
    page.translateContent((a4width - width * scale) / 2, (a4height - height * scale) / 2);
  }
  doc.setProducer("SkOiT Document Workshop");
  return save(doc);
}

/* --------------------------------------------------------- metadata edit -- */

export async function editMetadataPdf(
  file: NamedBytes,
  meta: { title?: string; author?: string; subject?: string },
): Promise<Uint8Array> {
  const doc = await load(file.bytes);
  if (meta.title?.trim()) {
    doc.setTitle(meta.title.trim());
  }
  if (meta.author?.trim()) {
    doc.setAuthor(meta.author.trim());
  }
  if (meta.subject?.trim()) {
    doc.setSubject(meta.subject.trim());
  }
  doc.setModificationDate(new Date());
  doc.setProducer("SkOiT Document Workshop");
  return save(doc);
}

/* ---------------------------------------------------------- cover page ---- */

export async function coverPagePdf(
  file: NamedBytes,
  options: { title: string; subtitle?: string; author?: string },
): Promise<Uint8Array> {
  const cleanTitle = options.title.trim().slice(0, 90);
  if (!cleanTitle) {
    throw new PdfToolError("Type a title for the cover page.");
  }
  const src = await load(file.bytes);
  const out = await PDFDocument.create();
  out.setProducer("SkOiT Document Workshop");
  out.setTitle(cleanTitle);

  const font = await out.embedFont(StandardFonts.HelveticaBold);
  const regular = await out.embedFont(StandardFonts.Helvetica);
  const page = out.addPage([595.28, 841.89]);

  page.drawRectangle({
    x: 64,
    y: 640,
    width: 72,
    height: 5,
    color: rgb(0.9, 0.45, 0.16),
  });
  const words = cleanTitle.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, 30) > 460) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) {
    lines.push(current);
  }
  let y = 590;
  for (const line of lines) {
    page.drawText(line, { x: 64, y, size: 30, font, color: rgb(0.11, 0.13, 0.16) });
    y -= 38;
  }
  if (options.subtitle?.trim()) {
    page.drawText(options.subtitle.trim().slice(0, 120), {
      x: 64,
      y: y - 8,
      size: 13,
      font: regular,
      color: rgb(0.35, 0.37, 0.42),
    });
  }
  if (options.author?.trim()) {
    page.drawText(options.author.trim().slice(0, 80), {
      x: 64,
      y: 96,
      size: 11,
      font: regular,
      color: rgb(0.35, 0.37, 0.42),
    });
  }
  page.drawText(new Date().toLocaleDateString(), {
    x: 64,
    y: 76,
    size: 10,
    font: regular,
    color: rgb(0.55, 0.57, 0.62),
  });

  const pages = await out.copyPages(src, src.getPageIndices());
  for (const copied of pages) {
    out.addPage(copied);
  }
  return save(out);
}
