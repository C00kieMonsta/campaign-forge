import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "../../config/config.service";

interface OcrPage {
  index?: number;
  markdown?: string;
  text?: string;
}
interface OcrResponse {
  pages?: OcrPage[];
}

const IMAGE_RE = /\.(jpe?g|png|webp|gif|tiff?|bmp)$/i;

// Backoff before each retry. Deterministic (no jitter) because a single EC2 with POOL_SIZE=3
// workers is not a thundering herd, and reproducible timings are easier to reason about in a log.
// A whole document was permanently failed by one upstream "Service unavailable" 500 during the
// first real bundle upload — the spend and the queue position are both wasted by not retrying.
const RETRY_DELAYS_MS = [1000, 3000, 9000];
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length;

/**
 * Mistral OCR for scanned/no-text-layer documents and images. Lazy (no client at boot); only
 * called from the ingestion worker when the parser reports needsOcr. Returns text per page.
 *
 * NOTE: the exact Mistral OCR request/response shape should be re-verified against the live
 * API before the first scanned-doc ingest; parsing is defensive (markdown ?? text).
 */
@Injectable()
export class MistralOcrService {
  private readonly logger = new Logger(MistralOcrService.name);

  constructor(private config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.config.get("MISTRAL_API_KEY"));
  }

  /**
   * Sleep between attempts. `protected` so a test can drive the retry path without waiting out
   * the real backoff.
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async ocr(
    buffer: Buffer,
    contentType: string,
    filename: string
  ): Promise<string[]> {
    const apiKey = this.config.get("MISTRAL_API_KEY");
    if (!apiKey)
      throw new Error("MISTRAL_API_KEY is not configured — OCR unavailable");

    const isImage =
      (contentType || "").toLowerCase().startsWith("image/") ||
      IMAGE_RE.test(filename);
    const mime = contentType || (isImage ? "image/png" : "application/pdf");
    const dataUrl = `data:${mime};base64,${buffer.toString("base64")}`;
    const document = isImage
      ? { type: "image_url", image_url: dataUrl }
      : { type: "document_url", document_url: dataUrl };
    const body = JSON.stringify({
      model: this.config.get("MISTRAL_OCR_MODEL"),
      document
    });

    let lastError = "";
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const outcome = await this.attempt(apiKey, body);
      if (outcome.kind === "ok") return outcome.pages;

      lastError = outcome.detail;
      // A 4xx other than 429 is our request being wrong (bad key, unsupported file, too large):
      // retrying it burns time and money to get the same answer, so it fails immediately.
      if (!outcome.retryable) {
        throw new Error(`Mistral OCR failed: ${outcome.detail}`);
      }
      if (attempt === MAX_ATTEMPTS) break;

      const delayMs = RETRY_DELAYS_MS[attempt - 1];
      this.logger.warn(
        JSON.stringify({
          level: "warn",
          action: "lexOcrRetry",
          filename,
          attempt,
          maxAttempts: MAX_ATTEMPTS,
          delayMs,
          error: outcome.detail
        })
      );
      await this.sleep(delayMs);
    }

    // The message says it was retried so a human reading the document's `error` column knows
    // this is a persistent upstream outage, not a one-off blip worth re-queueing by hand.
    throw new Error(
      `Mistral OCR failed after ${MAX_ATTEMPTS} attempts: ${lastError}`
    );
  }

  /**
   * One HTTP attempt. Transport errors (DNS, reset sockets, timeouts) are as transient as a 5xx
   * and are reported as retryable rather than thrown.
   */
  private async attempt(
    apiKey: string,
    body: string
  ): Promise<
    | { kind: "ok"; pages: string[] }
    | { kind: "error"; retryable: boolean; detail: string }
  > {
    let res: Response;
    try {
      res = await fetch("https://api.mistral.ai/v1/ocr", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body
      });
    } catch (err) {
      return {
        kind: "error",
        retryable: true,
        detail: `request failed: ${err instanceof Error ? err.message : String(err)}`
      };
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return {
        kind: "error",
        retryable: res.status === 429 || res.status >= 500,
        detail: `${res.status} ${detail.slice(0, 300)}`
      };
    }

    try {
      const data = (await res.json()) as OcrResponse;
      return {
        kind: "ok",
        pages: (data.pages ?? [])
          .map((p) => p.markdown ?? p.text ?? "")
          .filter((p) => p.trim().length > 0)
      };
    } catch (err) {
      // A 200 with a truncated body is a transport failure wearing a success code.
      return {
        kind: "error",
        retryable: true,
        detail: `unreadable response: ${err instanceof Error ? err.message : String(err)}`
      };
    }
  }
}
