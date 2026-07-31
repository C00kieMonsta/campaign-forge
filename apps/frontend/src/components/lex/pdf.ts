// pdf.js setup, isolated so the (large) library and its worker are imported from exactly one
// place. The worker is referenced with Vite's `?url` so it is emitted as a real asset and served
// with the right MIME type — importing it as a module instead breaks the production build.
import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type PdfDocument = PDFDocumentProxy;

export interface LoadedPdf {
  doc: PdfDocument;
  /**
   * Tears down the worker and aborts in-flight requests. It lives on the LOADING TASK, not on
   * the document proxy, so the task has to be kept around to clean up properly — otherwise a
   * closed 200-page viewer leaves its worker and rasterised pages in memory.
   */
  destroy: () => Promise<void>;
}

/**
 * Loads a PDF from a presigned S3 URL.
 *
 * pdf.js fetches the bytes itself, so this is a cross-origin XHR — it works only because the
 * documents bucket allows GET from this origin (the CORS rule on the bucket). An <iframe> would
 * not have needed that, but it also could not report a page count or render pages for selection.
 */
export async function loadPdf(url: string): Promise<LoadedPdf> {
  const task = pdfjs.getDocument({ url });
  const doc = await task.promise;
  return { doc, destroy: () => task.destroy() };
}
