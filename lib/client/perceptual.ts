"use client";

export interface PerceptualHashes {
  ahash: string;
  dhash: string;
  width: number;
  height: number;
}

type Canvas2D = {
  width: number;
  height: number;
  getContext: (id: "2d") => CanvasRenderingContext2D | null;
};

function makeCanvas(width: number, height: number): Canvas2D | null {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height) as unknown as Canvas2D;
  }
  if (typeof document === "undefined") {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function bitsToHex(bits: boolean[]): string {
  let hex = "";
  for (let index = 0; index < bits.length; index += 4) {
    const nibble =
      (bits[index] ? 8 : 0) +
      (bits[index + 1] ? 4 : 0) +
      (bits[index + 2] ? 2 : 0) +
      (bits[index + 3] ? 1 : 0);
    hex += nibble.toString(16);
  }
  return hex;
}

function greyPixels(
  bitmap: ImageBitmap,
  width: number,
  height: number,
): Uint8ClampedArray | null {
  const canvas = makeCanvas(width, height);
  const context = canvas?.getContext("2d");
  if (!canvas || !context) {
    return null;
  }
  context.drawImage(bitmap, 0, 0, width, height);
  const { data } = context.getImageData(0, 0, width, height);
  const grey = new Uint8ClampedArray(width * height);
  for (let index = 0; index < grey.length; index += 1) {
    const offset = index * 4;
    grey[index] = (data[offset] * 299 + data[offset + 1] * 587 + data[offset + 2] * 114) / 1000;
  }
  return grey;
}

/**
 * Perceptual hashes of an image, computed in the browser from the exact bytes
 * the analyst supplied. Average hash answers "is this the same picture", the
 * difference hash survives re-encoding and resizing — together they let a match
 * be checked against Commons' content hashes without uploading anything.
 */
export async function perceptualHashes(file: Blob): Promise<PerceptualHashes | undefined> {
  if (typeof createImageBitmap !== "function") {
    return undefined;
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return undefined;
  }

  try {
    const average = greyPixels(bitmap, 8, 8);
    const difference = greyPixels(bitmap, 9, 8);
    if (!average || !difference) {
      return undefined;
    }

    const mean = average.reduce((sum, value) => sum + value, 0) / average.length;
    const ahashBits: boolean[] = [];
    for (const value of average) {
      ahashBits.push(value > mean);
    }

    const dhashBits: boolean[] = [];
    for (let row = 0; row < 8; row += 1) {
      for (let column = 0; column < 8; column += 1) {
        const left = difference[row * 9 + column];
        const right = difference[row * 9 + column + 1];
        dhashBits.push(left > right);
      }
    }

    return {
      ahash: bitsToHex(ahashBits),
      dhash: bitsToHex(dhashBits),
      width: bitmap.width,
      height: bitmap.height,
    };
  } catch {
    return undefined;
  } finally {
    bitmap.close?.();
  }
}
