/**
 * Shrinks a photo before it is sent to the contact assistant.
 *
 * Phones produce 5 to 10 MB HEIC or JPEG photos and the API body limit is 10 MB. A business card
 * or a handwritten list is readable at 1600 px on its longest edge, and re-encoding as JPEG also
 * turns a HEIC (which Safari decodes natively) into a type every server-side model accepts.
 *
 * Resolves with the ORIGINAL file when anything fails (undecodable file, no canvas), so the server
 * still gets a chance to read it.
 */

export interface DownscaleOptions {
  /** Longest edge after scaling, in px. Never upscales. */
  maxEdge?: number;
  /** JPEG quality between 0 and 1. */
  quality?: number;
}

const DEFAULT_MAX_EDGE = 1600;
const DEFAULT_QUALITY = 0.85;

/** Types the server reads as-is, so a re-encode that grew the file can be dropped. */
const SERVER_READABLE = new Set(["image/jpeg", "image/png", "image/webp"]);

/** The size to draw at: scaled so the longest edge is at most maxEdge, never larger than the source. */
export function targetSize(
  width: number,
  height: number,
  maxEdge: number
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge || longest <= 0 || maxEdge <= 0) {
    return { width, height };
  }
  const ratio = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio))
  };
}

/** The original name with its extension swapped for .jpg. */
export function jpegName(name: string): string {
  const base = name.replace(/\.[^./\\]+$/, "").trim() || "photo";
  return `${base}.jpg`;
}

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

/** Decodes with createImageBitmap, falling back to an <img> where that is missing or rejects. */
async function decode(file: File): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    try {
      // Honour the EXIF orientation so a portrait card is not drawn sideways.
      const bitmap = await createImageBitmap(file, {
        imageOrientation: "from-image"
      });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close()
      };
    } catch {
      // Safari rejects some types here that it still decodes in an <img>.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("undecodable image"));
      el.src = url;
    });
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      release: () => URL.revokeObjectURL(url)
    };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

export async function downscaleImage(
  file: File,
  opts: DownscaleOptions = {}
): Promise<File> {
  const maxEdge = opts.maxEdge ?? DEFAULT_MAX_EDGE;
  const quality = opts.quality ?? DEFAULT_QUALITY;
  let decoded: Decoded | null = null;
  try {
    decoded = await decode(file);
    const size = targetSize(decoded.width, decoded.height, maxEdge);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(decoded.source, 0, 0, size.width, size.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality)
    );
    if (!blob) return file;
    if (blob.size >= file.size && SERVER_READABLE.has(file.type)) return file;
    return new File([blob], jpegName(file.name), {
      type: "image/jpeg",
      lastModified: file.lastModified
    });
  } catch {
    return file;
  } finally {
    decoded?.release();
  }
}
