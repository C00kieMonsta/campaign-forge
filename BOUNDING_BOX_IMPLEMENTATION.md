# Bounding Box Implementation Guide

> **Status:** Design document — not yet implemented.
> **Last updated:** February 2026

## Overview

This document describes how to add bounding box coordinates to extraction results, allowing the frontend to highlight exactly where extracted text appears on a PDF page.

Every extraction result's `evidence` object will include:

- **sourceText**: The text snippet the LLM extracted
- **pageNumber**: Which page it came from
- **boundingBox**: `{ x, y, width, height }` marking the text's location on the page

---

## Architecture

### High-Level Flow

```
PDF Document
    ↓
[LLM Extraction] → Gemini extracts data with sourceText + pageNumber
    ↓
[PDF Text Extraction] → pdfjs-dist extracts text items with coordinates
    ↓
[Fuzzy Match] → Find sourceText region in page text (language-agnostic)
    ↓
[Bounding Box] → Encompassing box from matched text items
    ↓
Evidence with coordinates → Frontend renders SVG overlay on page image
```

### Why This Approach

The previous design used Tesseract.js OCR to re-read rendered page images, then matched LLM output against OCR output using German-specific regex patterns. That approach had fundamental problems:

| Problem                                              | Impact                                               |
| ---------------------------------------------------- | ---------------------------------------------------- |
| OCR is slow (2-5s per page)                          | Unacceptable for 20+ page documents                  |
| Matching LLM text to OCR text is inherently fragile  | Two AI systems interpret the same text differently   |
| German position code regex (`\d{2}\.\d{2}\.\d{2,3}`) | Breaks on any non-German document                    |
| Tesseract accuracy varies by language                | Requires per-language trained data and normalization |
| Requires rendering PDF to images first               | Adds another slow step before OCR even starts        |

**The key insight:** Text-based PDFs already contain every character's exact position. There's no need to render to image, OCR the image, then match text. Just read the positions directly from the PDF.

### Key Components

1. **LLM Extraction** (existing — `pdf-extraction.service.ts`)
   - Gemini extracts structured data from PDF via File API
   - Returns `sourceText` and `pageNumber` per item
   - No changes needed

2. **PDF Text Position Extraction** (new — `pdf-text-position.service.ts`)
   - Uses `pdfjs-dist` to extract text items with coordinates from a given page
   - Returns `{ text, x, y, width, height }[]` per page
   - Pure PDF parsing — no image rendering, no OCR

3. **Fuzzy Text Matching** (new — `bounding-box.service.ts`)
   - Finds the best matching region for `sourceText` in the page's text items
   - Language-agnostic: works with any text, any document format
   - Computes encompassing bounding box from matched items

4. **Page Image Generation** (existing — `pdf-processing.service.ts`)
   - Converts specific pages to PNG using `pdftoppm` (poppler)
   - Only for pages that have extracted items
   - Images stored in S3 for frontend display

5. **Frontend Display** (changes to `ExtractionRow.tsx`)
   - Loads page image on-demand via presigned S3 URL
   - Renders SVG overlay with bounding box coordinates
   - Uses `viewBox` for automatic scaling across zoom levels

---

## Implementation Details

### 1. PDF Text Position Extraction with pdfjs-dist

PDFs store text as positioned glyphs. `pdfjs-dist` can extract these positions without rendering:

```typescript
// pdf-text-position.service.ts
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

interface TextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PageTextData {
  items: TextItem[];
  pageWidth: number;
  pageHeight: number;
}

async function extractTextPositions(
  pdfBuffer: Buffer,
  pageNumber: number
): Promise<PageTextData> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdfBuffer) })
    .promise;
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1.0 });
  const textContent = await page.getTextContent();

  const items: TextItem[] = textContent.items
    .filter(
      (item): item is pdfjs.TextItem =>
        "str" in item && item.str.trim().length > 0
    )
    .map((item) => {
      const [, , , , tx, ty] = item.transform;
      const itemHeight = item.height;
      // PDF coordinates are bottom-up, convert to top-down
      const yTopDown = viewport.height - ty;

      return {
        text: item.str,
        x: tx,
        y: yTopDown,
        width: item.width,
        height: itemHeight
      };
    });

  await doc.destroy();

  return {
    items,
    pageWidth: viewport.width,
    pageHeight: viewport.height
  };
}
```

**Why `pdfjs-dist`:**

- Extracts text with coordinates in milliseconds (vs seconds for OCR)
- Works for any language — it reads what's in the PDF, not what an AI thinks is there
- Battle-tested (powers Firefox's built-in PDF viewer)
- Already a JavaScript library — no system dependencies like poppler or Tesseract trained data
- Handles font encoding, ligatures, and Unicode automatically

---

### 2. Language-Agnostic Fuzzy Text Matching

Instead of German-specific regex patterns, use fuzzy substring matching that works with any text:

```typescript
// bounding-box.service.ts

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  pageWidth: number;
  pageHeight: number;
}

function findBoundingBoxForText(
  sourceText: string,
  pageTextData: PageTextData
): BoundingBox | null {
  const { items, pageWidth, pageHeight } = pageTextData;

  if (!sourceText || items.length === 0) return null;

  // Build a concatenated page text with item index tracking
  const indexedText = buildIndexedPageText(items);

  // Find the best matching region using token overlap
  const matchedRange = findBestMatchingRange(sourceText, indexedText);

  if (!matchedRange) return null;

  // Get the text items that fall within the matched range
  const matchedItems = items.slice(
    matchedRange.startIdx,
    matchedRange.endIdx + 1
  );

  return computeEncompassingBox(matchedItems, pageWidth, pageHeight);
}
```

#### Token-Based Matching (language-agnostic)

```typescript
interface IndexedPageText {
  fullText: string;
  // Maps character position in fullText → index in items array
  charToItemIndex: number[];
}

function buildIndexedPageText(items: TextItem[]): IndexedPageText {
  let fullText = "";
  const charToItemIndex: number[] = [];

  for (let i = 0; i < items.length; i++) {
    const text = items[i].text;
    for (let c = 0; c < text.length; c++) {
      charToItemIndex.push(i);
    }
    fullText += text;
    // Add space between items
    charToItemIndex.push(i);
    fullText += " ";
  }

  return { fullText, charToItemIndex };
}

function findBestMatchingRange(
  sourceText: string,
  indexedText: IndexedPageText
): { startIdx: number; endIdx: number } | null {
  const normalizedSource = normalize(sourceText);
  const normalizedPage = normalize(indexedText.fullText);

  // Step 1: Try exact substring match first (fastest)
  const exactIdx = normalizedPage.indexOf(normalizedSource);
  if (exactIdx !== -1) {
    return {
      startIdx: indexedText.charToItemIndex[exactIdx],
      endIdx:
        indexedText.charToItemIndex[
          Math.min(
            exactIdx + normalizedSource.length - 1,
            indexedText.charToItemIndex.length - 1
          )
        ]
    };
  }

  // Step 2: Sliding window with token overlap score
  const sourceTokens = new Set(normalizedSource.split(/\s+/).filter(Boolean));
  if (sourceTokens.size < 2) return null;

  const windowSize = normalizedSource.length;
  const step = Math.max(1, Math.floor(windowSize / 4));

  let bestScore = 0;
  let bestStart = -1;

  for (let i = 0; i <= normalizedPage.length - windowSize; i += step) {
    const window = normalizedPage.substring(i, i + windowSize);
    const windowTokens = new Set(window.split(/\s+/).filter(Boolean));

    // Jaccard-like overlap: intersection / sourceTokens.size
    let overlap = 0;
    for (const token of sourceTokens) {
      if (windowTokens.has(token)) overlap++;
    }
    const score = overlap / sourceTokens.size;

    if (score > bestScore) {
      bestScore = score;
      bestStart = i;
    }
  }

  // Require at least 50% token overlap
  if (bestScore < 0.5 || bestStart === -1) return null;

  return {
    startIdx: indexedText.charToItemIndex[bestStart],
    endIdx:
      indexedText.charToItemIndex[
        Math.min(
          bestStart + windowSize - 1,
          indexedText.charToItemIndex.length - 1
        )
      ]
  };
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}
```

#### Encompassing Box Calculation

```typescript
function computeEncompassingBox(
  items: TextItem[],
  pageWidth: number,
  pageHeight: number
): BoundingBox {
  const minX = Math.min(...items.map((i) => i.x));
  const minY = Math.min(...items.map((i) => i.y));
  const maxX = Math.max(...items.map((i) => i.x + i.width));
  const maxY = Math.max(...items.map((i) => i.y + i.height));

  // Add small padding
  const padding = 4;

  return {
    x: Math.max(0, minX - padding),
    y: Math.max(0, minY - padding),
    width: Math.min(pageWidth, maxX - minX + padding * 2),
    height: Math.min(pageHeight, maxY - minY + padding * 2),
    pageWidth,
    pageHeight
  };
}
```

**Why this matching approach works for any language/domain:**

- No regex patterns tied to specific document formats
- Token overlap naturally handles partial matches and slight text variations
- Exact substring match catches the easy cases instantly
- The 50% threshold prevents false positives ("better no box than wrong box")
- `normalize()` is simple lowercase + whitespace — no language-specific transforms

---

### 3. Scanned PDF Fallback (Gemini Vision)

For scanned PDFs where `pdfjs-dist` returns no text items, use Gemini Vision as a fallback. Since we already pay for Gemini, this adds no new vendor dependency:

```typescript
async function findBoundingBoxViaVision(
  pageImageBuffer: Buffer,
  sourceText: string,
  llmService: LLMService
): Promise<BoundingBox | null> {
  const systemPrompt = `You are a document analysis tool. Given an image of a document page, 
find the exact location of the specified text and return its bounding box coordinates.

Return ONLY a JSON object with this structure:
{ "x": number, "y": number, "width": number, "height": number }

Coordinates should be in pixels relative to the image dimensions.
If the text is not found on this page, return null.`;

  const userPrompt = `Find this text on the page and return its bounding box:\n\n"${sourceText}"`;

  const response = await llmService.generateWithBuffers(
    systemPrompt,
    userPrompt,
    pageImageBuffer,
    "image/png",
    undefined,
    TASK_CRITICALITY.LOW,
    { temperature: 0.1, maxOutputTokens: 256 }
  );

  try {
    const parsed = JSON.parse(response);
    if (!parsed || typeof parsed.x !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}
```

**When to use each path:**

| PDF Type                              | Detection                         | Bounding Box Method              |
| ------------------------------------- | --------------------------------- | -------------------------------- |
| Text-based (95% of construction docs) | `pdfjs-dist` returns text items   | PDF text positions + fuzzy match |
| Scanned / image-based                 | `pdfjs-dist` returns 0 text items | Gemini Vision (page image)       |

---

### 4. Integration into Extraction Pipeline

The bounding box step runs **after** the main extraction completes. It is non-blocking — if it fails, the extraction result is saved without a bounding box.

```typescript
// In extraction.service.ts — after LLM extraction and agent processing

async function enrichResultsWithBoundingBoxes(
  pdfBuffer: Buffer,
  results: MaterialExtractionResult[],
  pdfProcessingService: PDFProcessingService,
  llmService: LLMService
): Promise<MaterialExtractionResult[]> {
  // Group results by page number
  const resultsByPage = groupBy(results, (r) => r.pageNumber ?? 0);

  // Process each page
  for (const [pageNumber, pageResults] of Object.entries(resultsByPage)) {
    const page = Number(pageNumber);
    if (page < 1) continue;

    try {
      // Try PDF text extraction first (fast path)
      const pageTextData = await extractTextPositions(pdfBuffer, page);

      const isScannedPage = pageTextData.items.length < 5;

      for (const result of pageResults) {
        if (!result.sourceText) continue;

        try {
          let boundingBox: BoundingBox | null = null;

          if (!isScannedPage) {
            // Fast path: PDF text positions
            boundingBox = findBoundingBoxForText(
              result.sourceText,
              pageTextData
            );
          } else {
            // Fallback: Gemini Vision for scanned pages
            const images = await pdfProcessingService.pdfToImages(pdfBuffer);
            const pageImage = images[page - 1];
            if (pageImage) {
              boundingBox = await findBoundingBoxViaVision(
                pageImage,
                result.sourceText,
                llmService
              );
            }
          }

          if (boundingBox) {
            result.boundingBox = boundingBox;
          }
        } catch (error) {
          // Non-blocking: log and continue without bounding box
          console.error(
            JSON.stringify({
              level: "warn",
              action: "boundingBoxFailed",
              pageNumber: page,
              sourceText: result.sourceText?.substring(0, 100),
              error: error instanceof Error ? error.message : String(error)
            })
          );
        }
      }
    } catch (error) {
      // Non-blocking: skip entire page
      console.error(
        JSON.stringify({
          level: "warn",
          action: "pageTextExtractionFailed",
          pageNumber: page,
          error: error instanceof Error ? error.message : String(error)
        })
      );
    }
  }

  return results;
}
```

---

### 5. Page Number Fix (Bug — Exists Today)

The current `parseDynamicExtractionResponse` in `extraction-parsing.utils.ts` unconditionally overwrites the LLM's page number with the batch start page:

```typescript
// Current code (line 174) — BUG
return {
  ...item,
  pageNumber // Always overwrites LLM's value with batch start page
};
```

This must be fixed before bounding boxes can work. The LLM returns the actual page number, and the parsing code throws it away:

```typescript
// Fix: preserve LLM's page number when available
const llmPageNumber =
  typeof item.pageNumber === "number" && item.pageNumber > 0
    ? item.pageNumber
    : null;
const finalPageNumber = llmPageNumber ?? pageNumber;

return {
  ...item,
  pageNumber: finalPageNumber
};
```

This fix applies to both `parseDynamicExtractionResponse` and `parseExtractionResponse`.

---

### 6. Evidence Storage

Update `createResultsWithEvidence` in `extraction-result.service.ts` to include bounding box data:

```typescript
const evidence: Record<string, unknown> = {
  pageNumber: result.pageNumber,
  location: result.location || result.locationInDocument,
  sourceText: result.sourceText || result.originalSnippet,
  // New: bounding box coordinates
  ...(result.boundingBox && { boundingBox: result.boundingBox })
};
```

The `ExtractionResultWithEvidenceSchema` in `@packages/types` already supports the `boundingBox` field — no type changes needed.

---

### 7. Presigned URL Endpoint for Page Images

Frontend needs a way to load page images securely. Add an endpoint that generates fresh presigned URLs on demand:

```typescript
// In extraction.controller.ts
@Get("evidence/image-url")
@UseGuards(JwtAuthGuard)
async getEvidenceImageUrl(@Query("key") s3Key: string) {
  if (!s3Key) throw new BadRequestException("Missing key parameter");
  const downloadUrl = await this.storageService.getPresignedDownloadUrl(s3Key);
  return { downloadUrl };
}
```

---

### 8. Frontend SVG Overlay

Display the bounding box as an SVG overlay on top of the page image:

```tsx
function EvidenceWithBoundingBox({ evidence }: { evidence: Evidence }) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  // Load presigned URL on demand
  useEffect(() => {
    if (!evidence.snippetImageKey) return;
    loadImageUrl(evidence.snippetImageKey).then(setImageUrl);
  }, [evidence.snippetImageKey]);

  if (!imageUrl || !evidence.boundingBox) return null;

  const { x, y, width, height, pageWidth, pageHeight } = evidence.boundingBox;

  return (
    <div className="relative">
      <img src={imageUrl} alt="Document page" className="w-full" />
      <svg
        className="absolute inset-0 pointer-events-none"
        viewBox={`0 0 ${pageWidth} ${pageHeight}`}
        preserveAspectRatio="none"
        style={{ width: "100%", height: "100%" }}
      >
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          fill="rgba(239, 68, 68, 0.15)"
          stroke="rgb(239, 68, 68)"
          strokeWidth="3"
          rx="4"
        />
      </svg>
    </div>
  );
}
```

The `viewBox` ensures coordinates scale automatically — no manual math needed regardless of display size or zoom level.

---

## Implementation Order

| Step | What                                        | Where                          | Depends On               |
| ---- | ------------------------------------------- | ------------------------------ | ------------------------ |
| 1    | Fix page number overwrite bug               | `extraction-parsing.utils.ts`  | Nothing (standalone fix) |
| 2    | Add `pdfjs-dist` dependency                 | `apps/backend/package.json`    | Nothing                  |
| 3    | Create `PDFTextPositionService`             | New service file               | Step 2                   |
| 4    | Create `BoundingBoxService`                 | New service file               | Step 3                   |
| 5    | Integrate into extraction pipeline          | `extraction.service.ts`        | Steps 1, 3, 4            |
| 6    | Store bounding box in evidence              | `extraction-result.service.ts` | Step 5                   |
| 7    | Add page image generation + S3 upload       | `extraction.service.ts`        | Step 5                   |
| 8    | Add presigned URL endpoint                  | `extraction.controller.ts`     | Step 7                   |
| 9    | Build frontend SVG overlay                  | `ExtractionRow.tsx`            | Steps 6, 8               |
| 10   | Add Gemini Vision fallback for scanned PDFs | `bounding-box.service.ts`      | Step 4                   |

Steps 1 and 2 can be done immediately. Step 10 is optional — skip it if all your documents are text-based PDFs.

---

## Performance Comparison

| Metric              | Old approach (Tesseract OCR)    | New approach (pdfjs-dist)      |
| ------------------- | ------------------------------- | ------------------------------ |
| Time per page       | 2-5 seconds                     | 10-50 milliseconds             |
| System dependencies | poppler, Tesseract trained data | None (pure JS)                 |
| Language support    | Manual per-language config      | Automatic (reads PDF encoding) |
| Accuracy            | Depends on OCR quality          | Exact (reads source positions) |
| Docker image impact | +50MB for trained data          | +2MB for pdfjs-dist            |
| Scanned PDF support | Yes (OCR)                       | Fallback to Gemini Vision      |

For a 20-page PDF with items on 15 pages:

- **Old approach:** ~45-75 seconds of OCR processing
- **New approach:** ~0.5-1 second of PDF text extraction

---

## Gotchas

### 1. PDF Coordinate System Is Bottom-Up

PDF uses bottom-left origin (y increases upward). Browsers and SVG use top-left origin (y increases downward). The `extractTextPositions` function must convert:

```typescript
const yTopDown = viewport.height - ty;
```

Forgetting this will put bounding boxes in mirrored vertical positions.

### 2. pdfjs-dist Returns Empty for Scanned PDFs

If `pageTextData.items.length < 5`, the page is likely scanned. Don't treat this as a failure — fall back to Gemini Vision or skip bounding boxes for that page.

### 3. Bounding Boxes Must Be Non-Blocking

Never let a bounding box failure prevent the extraction result from being saved. Wrap all bounding box logic in try/catch and save the result regardless:

```typescript
try {
  result.boundingBox = await getBoundingBox(...);
} catch {
  // Save result without bounding box — extraction data is more important
}
```

### 4. Presigned URLs Expire

S3 presigned URLs have a TTL. If a user leaves a tab open and returns after expiry, images will 403. Handle this on the frontend:

```typescript
// Retry with fresh URL on image load failure
function onImageError() {
  loadImageUrl(s3Key).then(setImageUrl);
}
```

### 5. Batch Page Number Overwrite (Existing Bug)

Both `parseDynamicExtractionResponse` and `parseExtractionResponse` currently overwrite the LLM's page number with the batch start page. This must be fixed (Step 1) before bounding boxes make sense — otherwise boxes will appear on wrong pages.

### 6. Multi-Column Layouts

Construction documents often have multi-column tables. A single line item may span the full page width. The fuzzy matcher handles this naturally because it works on text items (which follow the PDF's reading order), not visual rows.

### 7. Page Image Generation Only for Relevant Pages

Don't render all pages to images. Only generate images for pages where at least one extraction result has a bounding box. This saves processing time and S3 storage.

---

## Files to Create/Modify

| File                           | Action | Purpose                                          |
| ------------------------------ | ------ | ------------------------------------------------ |
| `pdf-text-position.service.ts` | Create | Extract text with coordinates from PDF pages     |
| `bounding-box.service.ts`      | Create | Fuzzy matching + bounding box computation        |
| `extraction-parsing.utils.ts`  | Fix    | Preserve LLM page numbers instead of overwriting |
| `extraction.service.ts`        | Modify | Call bounding box enrichment after extraction    |
| `extraction-result.service.ts` | Modify | Store bounding box in evidence object            |
| `extraction.controller.ts`     | Modify | Add presigned URL endpoint                       |
| `extraction.module.ts`         | Modify | Register new services                            |
| `ExtractionRow.tsx`            | Modify | SVG overlay display                              |
| `apps/backend/package.json`    | Modify | Add `pdfjs-dist` dependency                      |

**Files NOT needed (eliminated from old approach):**

| File                             | Why Not Needed                            |
| -------------------------------- | ----------------------------------------- |
| `ocr-bounding-box.service.ts`    | No OCR — using PDF text positions instead |
| `eng.traineddata`                | No Tesseract                              |
| Dockerfile changes for Tesseract | No Tesseract                              |

---

## Dependencies

**Add:**

- `pdfjs-dist` — PDF text extraction with coordinates

**Remove (can be removed if not used elsewhere):**

- `tesseract.js` — replaced by `pdfjs-dist` for text-based PDFs and Gemini Vision for scanned PDFs

---

## References

- [pdfjs-dist API — getTextContent](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFPageProxy.html#getTextContent)
- [PDF coordinate system](https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute/viewBox)
- [SVG viewBox scaling](https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute/viewBox)
- [AWS presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html)
- [Gemini File API](https://ai.google.dev/gemini-api/docs/document-processing)
