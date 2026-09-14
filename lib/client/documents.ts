import type { DocumentInfo } from "@/lib/types";

/**
 * Container-level document forensics, done on the raw bytes in the browser.
 *
 * Only documented structures are read (header, Info dictionary, XMP packet,
 * object markers). Nothing is decompressed and nothing is guessed: when the
 * metadata sits inside a compressed object stream the reader says so instead of
 * inventing a value.
 */

const PDF_HEADER = /^%PDF-(\d\.\d)/;

function decodeLatin1(bytes: Uint8Array): string {
  // Chunked to stay well inside the argument limit for large files.
  let out = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return out;
}

/** PDF text strings: literal `(...)` with escapes, or hex `<...>`. */
function readPdfString(raw: string, from: number): { value: string; end: number } | null {
  const opener = raw[from];
  if (opener === "(") {
    let depth = 0;
    let value = "";
    for (let i = from; i < raw.length; i += 1) {
      const char = raw[i];
      if (char === "\\") {
        const next = raw[i + 1];
        if (next >= "0" && next <= "7") {
          const octal = raw.slice(i + 1, i + 4).match(/^[0-7]{1,3}/)?.[0] ?? "";
          value += String.fromCharCode(Number.parseInt(octal, 8) & 0xff);
          i += octal.length;
        } else {
          value += next === "n" ? "\n" : next === "r" ? "\r" : next === "t" ? "\t" : next;
          i += 1;
        }
        continue;
      }
      if (char === "(") {
        depth += 1;
        if (depth === 1) {
          continue;
        }
      }
      if (char === ")") {
        depth -= 1;
        if (depth === 0) {
          return { value, end: i + 1 };
        }
      }
      value += char;
    }
    return null;
  }
  if (opener === "<") {
    const close = raw.indexOf(">", from);
    if (close === -1) {
      return null;
    }
    const hex = raw.slice(from + 1, close).replace(/[^0-9a-f]/gi, "");
    const pairs = hex.match(/.{2}/g) ?? [];
    const values = pairs.map((pair) => Number.parseInt(pair, 16));
    let text: string;
    if (values[0] === 0xfe && values[1] === 0xff) {
      // BOM-prefixed UTF-16BE is common in these dictionaries.
      const units: number[] = [];
      for (let i = 2; i + 1 < values.length; i += 2) {
        units.push((values[i] << 8) | values[i + 1]);
      }
      text = String.fromCharCode(...units);
    } else {
      text = values.map((code) => String.fromCharCode(code)).join("");
    }
    return { value: text, end: close + 1 };
  }
  return null;
}

function infoValue(raw: string, key: string): string | undefined {
  const pattern = new RegExp(`/${key}\\s*(?=[(<])`, "g");
  for (const match of raw.matchAll(pattern)) {
    const start = match.index + match[0].length;
    const parsed = readPdfString(raw, start);
    if (parsed?.value.trim()) {
      return parsed.value.trim().slice(0, 400);
    }
  }
  return undefined;
}

function infoNumber(raw: string, key: string): number | undefined {
  const match = raw.match(new RegExp(`/${key}\\s+(\\d{1,3})\\b`));
  return match ? Number.parseInt(match[1], 10) : undefined;
}

/** D:YYYYMMDDHHmmSS(+HH'mm') → ISO 8601, when the string is complete enough. */
function pdfDate(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const match = value
    .replace(/^D:/, "")
    .match(
      /^(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\s*([Z+-])(\d{2})?'?(\d{2})?)?/,
    );
  if (!match) {
    return undefined;
  }
  const [, year, month, day, hour, minute, second, , sign, offHour, offMinute] = match;
  if (!year) {
    return undefined;
  }
  const parts = [
    year,
    month ?? "01",
    day ?? "01",
    hour ?? "00",
    minute ?? "00",
    second ?? "00",
  ];
  const offset =
    sign === "Z" ? "Z" : sign ? `${sign}${offHour ?? "00"}:${offMinute ?? "00"}` : "";
  const iso = `${parts[0]}-${parts[1]}-${parts[2]}T${parts[3]}:${parts[4]}:${parts[5]}${offset}`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function xmpValue(raw: string, tag: string): string | undefined {
  const direct = raw.match(new RegExp(`<${tag}>([^<]{1,400})</${tag}>`));
  if (direct) {
    return direct[1].trim();
  }
  const listed = raw.match(
    new RegExp(`<${tag}>[^]*?<rdf:li[^>]*>([^<]{1,400})</rdf:li>`),
  );
  return listed ? listed[1].trim() : undefined;
}

export function analyseDocument(bytes: Uint8Array): DocumentInfo | null {
  const head = decodeLatin1(bytes.subarray(0, 1024));
  const header = head.match(PDF_HEADER);
  if (!header) {
    return null;
  }

  const raw = decodeLatin1(bytes);
  const info: DocumentInfo = { format: `PDF ${header[1]}`, notes: [] };
  const notes = info.notes as string[];

  info.title = infoValue(raw, "Title");
  info.author = infoValue(raw, "Author");
  info.creator = infoValue(raw, "Creator");
  info.producer = infoValue(raw, "Producer");
  info.createdAt = pdfDate(infoValue(raw, "CreationDate"));
  info.modifiedAt = pdfDate(infoValue(raw, "ModDate"));

  if (raw.includes("x:xmpmeta") || raw.includes("/Type /Metadata")) {
    info.creator ||= xmpValue(raw, "xmp:CreatorTool");
    info.producer ||= xmpValue(raw, "pdf:Producer");
    info.createdAt ||= pdfDate(xmpValue(raw, "xmp:CreateDate"));
    info.modifiedAt ||= pdfDate(xmpValue(raw, "xmp:ModifyDate"));
    info.author ||= xmpValue(raw, "dc:creator");
    info.title ||= xmpValue(raw, "dc:title");
  }

  const isEncrypted = /\/Encrypt\b/.test(raw);
  info.encrypted = isEncrypted;

  const pages = (raw.match(/\/Type\s*\/Page(?![s])/g) ?? []).length;
  const pageCount = pages > 0 ? pages : infoNumber(raw, "Count");
  if (pageCount) {
    info.pages = pageCount;
  }

  info.signed = /\/Type\s*\/Sig\b/.test(raw);
  info.scripting = /\/(JavaScript|JS)\b/.test(raw);

  const embedded = (raw.match(/\/EmbeddedFile\b/g) ?? []).length;
  if (embedded > 0) {
    info.embeddedFiles = embedded;
  }

  const eofs = (raw.match(/%%EOF/g) ?? []).length;
  if (eofs > 1) {
    info.incrementalUpdates = eofs - 1;
  }

  if (isEncrypted) {
    notes.push(
      "The file is encrypted, so dictionary values recovered here may be incomplete or absent.",
    );
  }
  if (info.incrementalUpdates) {
    notes.push(
      `${info.incrementalUpdates} incremental update(s) after the first save — the document was edited without being rewritten from scratch.`,
    );
  }
  if (info.producer && info.creator && info.producer !== info.creator) {
    notes.push(
      `Created in “${info.creator}” and last produced by “${info.producer}” — the file passed through another tool.`,
    );
  }
  if (!info.title && !info.author && !info.producer && !info.creator) {
    notes.push(
      raw.includes("/ObjStm")
        ? "No document properties in the clear — they are held in a compressed object stream."
        : "No document properties present: the metadata was stripped before the file reached you.",
    );
  }
  if (info.modifiedAt && info.createdAt && info.modifiedAt !== info.createdAt) {
    notes.push(`Modified ${info.modifiedAt} after being created ${info.createdAt}.`);
  }

  return info;
}
