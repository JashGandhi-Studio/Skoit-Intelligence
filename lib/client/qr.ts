import QRCode from "qrcode";

/**
 * QR Studio engine. The matrix comes from the `qrcode` library; the *design*
 * is drawn by SkOiT: module shapes (square, rounded, dot, diamond), shaped
 * finder eyes, solid or gradient ink, and an export to both PNG (canvas) and
 * SVG (true vector). A QR that cannot be scanned is a failure, so the module
 * geometry keeps the quiet zone and never overlaps the function patterns.
 */

export type QrModuleStyle = "square" | "rounded" | "dot" | "diamond";
export type QrFinderStyle = "square" | "rounded" | "circle";

export interface QrDesign {
  text: string;
  ecc: "L" | "M" | "Q" | "H";
  moduleStyle: QrModuleStyle;
  finderStyle: QrFinderStyle;
  fg: string;
  bg: string;
  gradient?: string | null;
  margin: number;
}

export const QR_PRESETS: Array<{ name: string; design: Partial<QrDesign> }> = [
  {
    name: "Classic ink",
    design: {
      fg: "#16181d",
      bg: "#ffffff",
      gradient: null,
      moduleStyle: "square",
      finderStyle: "square",
    },
  },
  {
    name: "Saffron",
    design: {
      fg: "#e5732a",
      bg: "#fffaf4",
      gradient: "#f2b23e",
      moduleStyle: "rounded",
      finderStyle: "rounded",
    },
  },
  {
    name: "Midnight",
    design: {
      fg: "#f5f7fa",
      bg: "#16181d",
      gradient: null,
      moduleStyle: "rounded",
      finderStyle: "circle",
    },
  },
  {
    name: "Ocean",
    design: {
      fg: "#1173b8",
      bg: "#f2f9ff",
      gradient: "#12b3a8",
      moduleStyle: "dot",
      finderStyle: "circle",
    },
  },
  {
    name: "Forest",
    design: {
      fg: "#1d7a45",
      bg: "#f4fbf6",
      gradient: "#79c26e",
      moduleStyle: "rounded",
      finderStyle: "rounded",
    },
  },
  {
    name: "Grape",
    design: {
      fg: "#6d28d9",
      bg: "#faf7ff",
      gradient: "#c026d3",
      moduleStyle: "rounded",
      finderStyle: "rounded",
    },
  },
  {
    name: "Rose",
    design: {
      fg: "#be123c",
      bg: "#fff5f7",
      gradient: "#fb7185",
      moduleStyle: "diamond",
      finderStyle: "circle",
    },
  },
  {
    name: "Steel",
    design: {
      fg: "#334155",
      bg: "#f8fafc",
      gradient: null,
      moduleStyle: "square",
      finderStyle: "square",
    },
  },
  {
    name: "Mint",
    design: {
      fg: "#0f766e",
      bg: "#f0fdfa",
      gradient: "#34d399",
      moduleStyle: "dot",
      finderStyle: "rounded",
    },
  },
  {
    name: "Sunset",
    design: {
      fg: "#c7348c",
      bg: "#fff5fb",
      gradient: "#f2643c",
      moduleStyle: "diamond",
      finderStyle: "rounded",
    },
  },
];

export const DEFAULT_QR_DESIGN: QrDesign = {
  text: "",
  ecc: "M",
  moduleStyle: "rounded",
  finderStyle: "rounded",
  fg: "#16181d",
  bg: "#ffffff",
  gradient: null,
  margin: 3,
};

interface QrMatrix {
  size: number;
  get: (row: number, col: number) => boolean;
  isFinder: (row: number, col: number) => boolean;
}

export function qrMatrix(text: string, ecc: QrDesign["ecc"]): QrMatrix {
  const qr = QRCode.create(text || " ", { errorCorrectionLevel: ecc });
  const size = qr.modules.size;
  const data = qr.modules.data;
  const finderZones: Array<[number, number]> = [
    [0, 0],
    [0, size - 7],
    [size - 7, 0],
  ];
  return {
    size,
    get: (row, col) =>
      row >= 0 && col >= 0 && row < size && col < size && data[row * size + col] === 1,
    isFinder: (row, col) =>
      finderZones.some(
        ([top, left]) =>
          row >= top - 1 && row < top + 8 && col >= left - 1 && col < left + 8,
      ),
  };
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function inkStyle(
  ctx: CanvasRenderingContext2D,
  design: QrDesign,
  pixelSize: number,
): string | CanvasGradient {
  if (!design.gradient) {
    return design.fg;
  }
  const gradient = ctx.createLinearGradient(0, 0, pixelSize, pixelSize);
  gradient.addColorStop(0, design.fg);
  gradient.addColorStop(1, design.gradient);
  return gradient;
}

export function drawQrToCanvas(
  canvas: HTMLCanvasElement,
  design: QrDesign,
): { size: number } {
  const matrix = qrMatrix(design.text || "https://skoit.app", design.ecc);
  const cells = matrix.size + design.margin * 2;
  const pixelSize = Math.max(320, Math.min(1024, cells * 12));
  canvas.width = pixelSize;
  canvas.height = pixelSize;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return { size: matrix.size };
  }
  ctx.fillStyle = design.bg;
  ctx.fillRect(0, 0, pixelSize, pixelSize);

  const quiet = (design.margin * pixelSize) / cells;
  const module = (pixelSize - quiet * 2) / matrix.size;
  const ink = inkStyle(ctx, design, pixelSize);
  ctx.fillStyle = ink;

  const drawModule = (row: number, col: number) => {
    const x = quiet + col * module;
    const y = quiet + row * module;
    switch (design.moduleStyle) {
      case "dot": {
        ctx.beginPath();
        ctx.arc(x + module / 2, y + module / 2, module * 0.46, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case "rounded": {
        roundRectPath(
          ctx,
          x + module * 0.06,
          y + module * 0.06,
          module * 0.88,
          module * 0.88,
          module * 0.34,
        );
        ctx.fill();
        break;
      }
      case "diamond": {
        ctx.beginPath();
        ctx.moveTo(x + module / 2, y + module * 0.04);
        ctx.lineTo(x + module * 0.96, y + module / 2);
        ctx.lineTo(x + module / 2, y + module * 0.96);
        ctx.lineTo(x + module * 0.04, y + module / 2);
        ctx.closePath();
        ctx.fill();
        break;
      }
      default: {
        ctx.fillRect(x, y, module + 0.5, module + 0.5);
      }
    }
  };

  for (let row = 0; row < matrix.size; row += 1) {
    for (let col = 0; col < matrix.size; col += 1) {
      if (matrix.get(row, col) && !matrix.isFinder(row, col)) {
        drawModule(row, col);
      }
    }
  }

  // Finder eyes: 7×7 ring + 3×3 core, drawn as one shape each.
  const eyes: Array<[number, number]> = [
    [0, 0],
    [0, matrix.size - 7],
    [matrix.size - 7, 0],
  ];
  for (const [top, left] of eyes) {
    const x = quiet + left * module;
    const y = quiet + top * module;
    const outer = module * 7;
    const ring = module;
    const radius =
      design.finderStyle === "square"
        ? 0
        : design.finderStyle === "rounded"
          ? outer * 0.32
          : outer / 2;
    ctx.fillStyle = ink;
    roundRectPath(ctx, x, y, outer, outer, radius);
    ctx.fill();
    ctx.fillStyle = design.bg;
    const innerRadius =
      design.finderStyle === "square"
        ? 0
        : design.finderStyle === "rounded"
          ? (outer - ring * 2) * 0.3
          : (outer - ring * 2) / 2;
    roundRectPath(
      ctx,
      x + ring,
      y + ring,
      outer - ring * 2,
      outer - ring * 2,
      innerRadius,
    );
    ctx.fill();
    ctx.fillStyle = ink;
    const coreSize = module * 3;
    const coreRadius =
      design.finderStyle === "square"
        ? 0
        : design.finderStyle === "rounded"
          ? coreSize * 0.32
          : coreSize / 2;
    roundRectPath(ctx, x + ring * 2, y + ring * 2, coreSize, coreSize, coreRadius);
    ctx.fill();
  }

  return { size: matrix.size };
}

function svgPathForModules(
  matrix: QrMatrix,
  module: number,
  offset: number,
  design: QrDesign,
): string {
  const parts: string[] = [];
  for (let row = 0; row < matrix.size; row += 1) {
    for (let col = 0; col < matrix.size; col += 1) {
      if (!matrix.get(row, col) || matrix.isFinder(row, col)) {
        continue;
      }
      const x = offset + col * module;
      const y = offset + row * module;
      switch (design.moduleStyle) {
        case "dot":
          parts.push(
            `<circle cx="${(x + module / 2).toFixed(2)}" cy="${(y + module / 2).toFixed(2)}" r="${(module * 0.46).toFixed(2)}"/>`,
          );
          break;
        case "rounded":
          parts.push(
            `<rect x="${(x + module * 0.06).toFixed(2)}" y="${(y + module * 0.06).toFixed(2)}" width="${(module * 0.88).toFixed(2)}" height="${(module * 0.88).toFixed(2)}" rx="${(module * 0.34).toFixed(2)}"/>`,
          );
          break;
        case "diamond":
          parts.push(
            `<path d="M${(x + module / 2).toFixed(2)} ${(y + module * 0.04).toFixed(2)} L${(x + module * 0.96).toFixed(2)} ${(y + module / 2).toFixed(2)} L${(x + module / 2).toFixed(2)} ${(y + module * 0.96).toFixed(2)} L${(x + module * 0.04).toFixed(2)} ${(y + module / 2).toFixed(2)} Z"/>`,
          );
          break;
        default:
          parts.push(
            `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${module.toFixed(2)}" height="${module.toFixed(2)}"/>`,
          );
      }
    }
  }
  return parts.join("");
}

function svgEye(
  top: number,
  left: number,
  module: number,
  offset: number,
  design: QrDesign,
): string {
  const x = offset + left * module;
  const y = offset + top * module;
  const outer = module * 7;
  const ring = module;
  const radiusFor = (size: number) =>
    design.finderStyle === "square"
      ? 0
      : design.finderStyle === "rounded"
        ? size * 0.32
        : size / 2;
  const core = module * 3;
  return [
    `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${outer.toFixed(2)}" height="${outer.toFixed(2)}" rx="${radiusFor(outer).toFixed(2)}" fill="${design.fg}"/>`,
    `<rect x="${(x + ring).toFixed(2)}" y="${(y + ring).toFixed(2)}" width="${(outer - ring * 2).toFixed(2)}" height="${(outer - ring * 2).toFixed(2)}" rx="${radiusFor(outer - ring * 2).toFixed(2)}" fill="${design.bg}"/>`,
    `<rect x="${(x + ring * 2).toFixed(2)}" y="${(y + ring * 2).toFixed(2)}" width="${core.toFixed(2)}" height="${core.toFixed(2)}" rx="${radiusFor(core).toFixed(2)}" fill="${design.fg}"/>`,
  ].join("");
}

/** True-vector export: crisp at any size, ideal for print. */
export function qrToSvg(design: QrDesign, pixelSize = 1024): string {
  const matrix = qrMatrix(design.text || "https://skoit.app", design.ecc);
  const cells = matrix.size + design.margin * 2;
  const module = pixelSize / cells;
  const offset = design.margin * module;
  const gradientId = "skoit-qr-ink";
  const fill = design.gradient ? `url(#${gradientId})` : design.fg;
  const gradientDef = design.gradient
    ? `<defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${design.fg}"/><stop offset="1" stop-color="${design.gradient}"/></linearGradient></defs>`
    : "";
  const eyes: Array<[number, number]> = [
    [0, 0],
    [0, matrix.size - 7],
    [matrix.size - 7, 0],
  ];
  const eyeSvg = eyes
    .map(([top, left]) => svgEye(top, left, module, offset, design))
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${pixelSize}" height="${pixelSize}" viewBox="0 0 ${pixelSize} ${pixelSize}">${gradientDef}<rect width="${pixelSize}" height="${pixelSize}" fill="${design.bg}"/><g fill="${fill}">${svgPathForModules(matrix, module, offset, design)}</g>${eyeSvg}</svg>`;
}
