import { exec } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import { promisify } from "util";
import { Injectable, Logger } from "@nestjs/common";
import { PDFDocument } from "pdf-lib";

const execAsync = promisify(exec);

@Injectable()
export class PDFProcessingService {
  private logger = new Logger(PDFProcessingService.name);

  async pdfToImages(pdfBuffer: Buffer, dpi: number = 150): Promise<Buffer[]> {
    const tempDir = `/tmp/pdf-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const pdfPath = path.join(tempDir, "input.pdf");

    try {
      // Validate PDF buffer
      if (!pdfBuffer || pdfBuffer.length === 0) {
        throw new Error("Invalid PDF buffer: empty or null");
      }

      // Check if buffer looks like a PDF
      const pdfHeader = pdfBuffer.subarray(0, 4).toString();
      if (pdfHeader !== "%PDF") {
        throw new Error("Invalid PDF buffer: missing PDF header");
      }

      // Create temp directory
      await fs.mkdir(tempDir, { recursive: true });

      // Write PDF to temp file
      await fs.writeFile(pdfPath, new Uint8Array(pdfBuffer));

      this.logger.log(`Converting PDF to images at ${dpi} DPI`, {
        tempDir,
        pdfSize: pdfBuffer.length
      });

      // First, validate PDF with pdfinfo
      try {
        await execAsync(`pdfinfo "${pdfPath}"`);
      } catch (pdfinfoError) {
        const errorMessage =
          pdfinfoError instanceof Error
            ? pdfinfoError.message
            : String(pdfinfoError);
        this.logger.error(
          `PDF validation failed with pdfinfo: ${errorMessage}`
        );

        if (
          errorMessage.includes("not found") ||
          errorMessage.includes("command not found")
        ) {
          throw new Error(
            "PDF processing tools not available. Please ensure poppler-utils is installed."
          );
        }

        throw new Error(`Invalid PDF file: ${errorMessage}`);
      }

      // Convert PDF to images using pdftoppm
      const outputPrefix = path.join(tempDir, "page");
      const command = `pdftoppm -png -r ${dpi} "${pdfPath}" "${outputPrefix}"`;

      try {
        await execAsync(command);
      } catch (pdftoppmError) {
        const errorMessage =
          pdftoppmError instanceof Error
            ? pdftoppmError.message
            : String(pdftoppmError);
        this.logger.error(`pdftoppm conversion failed: ${errorMessage}`);

        if (
          errorMessage.includes("not found") ||
          errorMessage.includes("command not found")
        ) {
          throw new Error(
            "PDF processing tools not available. Please ensure poppler-utils is installed."
          );
        }

        throw new Error(`PDF conversion failed: ${errorMessage}`);
      }

      // Read generated images
      const files = await fs.readdir(tempDir);
      const imageFiles = files
        .filter((f) => f.endsWith(".png"))
        .sort((a, b) => {
          // Sort by page number (e.g., page-001.png, page-002.png)
          const aNum = parseInt(a.match(/\d+/)?.[0] || "0");
          const bNum = parseInt(b.match(/\d+/)?.[0] || "0");
          return aNum - bNum;
        });

      if (imageFiles.length === 0) {
        throw new Error(
          "No images were generated from PDF. The PDF may be corrupted or password-protected."
        );
      }

      this.logger.log(`Generated ${imageFiles.length} images from PDF`);

      const images: Buffer[] = [];
      for (const file of imageFiles) {
        const imagePath = path.join(tempDir, file);
        const imageBuffer = await fs.readFile(imagePath);
        images.push(imageBuffer);
      }

      return images;
    } catch (error) {
      this.logger.error("Failed to convert PDF to images", {
        error: error instanceof Error ? error.message : String(error),
        tempDir
      });
      throw new Error(
        `PDF processing failed: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      // Cleanup temp directory
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
        this.logger.debug(`Cleaned up temp directory: ${tempDir}`);
      } catch (error) {
        this.logger.warn(`Failed to cleanup temp directory: ${tempDir}`, {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  async getPageCount(pdfBuffer: Buffer): Promise<number> {
    const tempDir = `/tmp/pdf-info-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const pdfPath = path.join(tempDir, "input.pdf");

    try {
      // Create temp directory and write PDF
      await fs.mkdir(tempDir, { recursive: true });
      await fs.writeFile(pdfPath, new Uint8Array(pdfBuffer));

      // Use pdfinfo to get page count
      const { stdout } = await execAsync(`pdfinfo "${pdfPath}"`);
      const pageMatch = stdout.match(/Pages:\s+(\d+)/);

      if (!pageMatch) {
        throw new Error("Could not determine page count from PDF");
      }

      return parseInt(pageMatch[1]);
    } catch (error) {
      this.logger.error("Failed to get PDF page count", {
        error: error instanceof Error ? error.message : String(error)
      });
      throw new Error(
        `Failed to get PDF page count: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      // Cleanup
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (error) {
        this.logger.warn(`Failed to cleanup temp directory: ${tempDir}`);
      }
    }
  }

  async validatePDF(pdfBuffer: Buffer): Promise<boolean> {
    try {
      // Check if buffer starts with PDF signature
      const pdfSignature = pdfBuffer.subarray(0, 4).toString();
      if (pdfSignature !== "%PDF") {
        return false;
      }

      // Try to get page count - if this succeeds, PDF is valid
      await this.getPageCount(pdfBuffer);
      return true;
    } catch (error) {
      this.logger.warn("PDF validation failed", {
        error: error instanceof Error ? error.message : String(error),
        bufferSize: pdfBuffer.length
      });
      return false;
    }
  }

  /**
   * Extract a range of pages from a PDF and return as a new PDF buffer
   * Uses pdf-lib for pure Node.js PDF manipulation (no system dependencies)
   * @param pdfBuffer - The original PDF buffer
   * @param startPage - First page to extract (1-indexed)
   * @param endPage - Last page to extract (1-indexed, inclusive)
   * @returns Buffer containing the extracted pages as a new PDF
   */
  async extractPageRange(
    pdfBuffer: Buffer,
    startPage: number,
    endPage: number
  ): Promise<Buffer> {
    try {
      // Validate pdfBuffer
      if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer) || pdfBuffer.length === 0) {
        throw new Error(
          "Invalid PDF buffer: buffer is empty or not a valid Buffer"
        );
      }

      this.logger.log(
        `Extracting pages ${startPage}-${endPage} from PDF (buffer size: ${Math.round(pdfBuffer.length / 1024)} KB)`
      );

      // Load the source PDF with error handling
      // Convert Buffer to Uint8Array for pdf-lib compatibility
      let sourcePdf: PDFDocument;
      try {
        sourcePdf = await PDFDocument.load(new Uint8Array(pdfBuffer), {
          ignoreEncryption: true
        });
      } catch (loadError) {
        throw new Error(
          `Failed to load PDF buffer: ${loadError instanceof Error ? loadError.message : String(loadError)}`
        );
      }

      const totalPages = sourcePdf.getPageCount();

      // Validate page range
      if (startPage < 1 || endPage > totalPages || startPage > endPage) {
        throw new Error(
          `Invalid page range ${startPage}-${endPage} for PDF with ${totalPages} pages`
        );
      }

      // Create a new PDF document
      const newPdf = await PDFDocument.create();

      // Copy pages (convert from 1-indexed to 0-indexed)
      const pageIndices = Array.from(
        { length: endPage - startPage + 1 },
        (_, i) => startPage - 1 + i
      );

      const copiedPages = await newPdf.copyPages(sourcePdf, pageIndices);

      // Add copied pages to new PDF
      copiedPages.forEach((page) => newPdf.addPage(page));

      // Save to buffer
      const pdfBytes = await newPdf.save();
      const extractedBuffer = Buffer.from(pdfBytes);

      this.logger.log(
        `Successfully extracted pages ${startPage}-${endPage} (${Math.round(extractedBuffer.length / 1024)} KB)`
      );

      return extractedBuffer;
    } catch (error) {
      this.logger.error(
        `Failed to extract pages ${startPage}-${endPage} from PDF`,
        {
          error: error instanceof Error ? error.message : String(error),
          bufferSize: pdfBuffer ? pdfBuffer.length : 0
        }
      );
      throw new Error(
        `PDF page extraction failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
