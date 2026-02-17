import { Injectable } from "@nestjs/common";
import { Supplier } from "@packages/types";
import { ConfigService } from "@/config/config.service";
import { BaseDatabaseService } from "@/shared/database/base-database.service";
import { PrismaService } from "@/shared/prisma/prisma.service";

export interface SupplierEmailText {
  supplier: Supplier;
  emailText: string;
  extractionResults: Array<{
    id: string;
    data: any;
    jobId?: string;
  }>;
}

export interface GenerateSupplierEmailsResponse {
  emails: SupplierEmailText[];
}

interface FormatOptions {
  dataFields?: string[];
  metaFields?: string[];
}

@Injectable()
export class SupplierEmailService extends BaseDatabaseService {
  constructor(prismaService: PrismaService, configService: ConfigService) {
    super(prismaService, configService);
  }

  /**
   * Generate an email payload for a single supplier with provided extraction results.
   */
  generateEmailForSupplier(
    supplier: Supplier,
    extractionResults: Array<{ id: string; data: any; jobId?: string }>,
    options?: FormatOptions
  ): SupplierEmailText {
    const emailText = this.formatSupplierEmail(
      supplier,
      extractionResults,
      options
    );

    return {
      supplier,
      emailText,
      extractionResults
    };
  }

  /**
   * Generate plain text emails grouped by supplier for an extraction job
   * Only includes suppliers with selected matches
   */
  async generateSupplierEmailText(
    extractionJobId: string
  ): Promise<GenerateSupplierEmailsResponse> {
    this.logger.info(
      `Generating supplier emails for extraction job: ${extractionJobId}`,
      this.context
    );

    try {
      // Get all selected supplier matches for this extraction job
      const selectedMatches = await this.prisma.supplierMatch.findMany({
        where: {
          extractionResult: {
            extractionJobId: extractionJobId
          },
          isSelected: true
        },
        include: {
          supplier: true,
          extractionResult: {
            select: {
              id: true,
              extractionJobId: true,
              verifiedData: true,
              rawExtraction: true
            }
          }
        }
      });

      if (selectedMatches.length === 0) {
        this.logger.warn(
          `No selected supplier matches found for job: ${extractionJobId}`,
          this.context
        );
        return { emails: [] };
      }

      // Group extraction results by supplier
      const supplierGroups = this.groupResultsBySupplier(selectedMatches);

      // Generate email text for each supplier
      const emails: SupplierEmailText[] = [];

      for (const [supplierId, matches] of supplierGroups.entries()) {
        const supplier = matches[0].supplier;
        const extractionResults = matches.map((match) => ({
          id: match.extractionResult.id,
          jobId: match.extractionResult.extractionJobId,
          data:
            match.extractionResult.verifiedData ||
            match.extractionResult.rawExtraction
        }));

        const emailText = this.formatSupplierEmail(supplier, extractionResults);

        emails.push({
          supplier,
          emailText,
          extractionResults
        });
      }

      this.logger.info(
        `Generated ${emails.length} supplier emails for job: ${extractionJobId}`,
        this.context
      );

      return { emails };
    } catch (error) {
      this.logger.error("Failed to generate supplier emails", {
        ...this.context,
        error: error instanceof Error ? error.message : String(error),
        extractionJobId
      });
      throw new Error(
        `Failed to generate supplier emails: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Group supplier matches by supplier ID
   */
  private groupResultsBySupplier(
    matches: Array<{
      supplierId: string;
      supplier: Supplier;
      extractionResult: {
        id: string;
        extractionJobId?: string;
        verifiedData: any;
        rawExtraction: any;
      };
    }>
  ): Map<
    string,
    Array<{
      supplierId: string;
      supplier: Supplier;
      extractionResult: {
        id: string;
        extractionJobId?: string;
        verifiedData: any;
        rawExtraction: any;
      };
    }>
  > {
    const groups = new Map<string, typeof matches>();

    for (const match of matches) {
      const existing = groups.get(match.supplierId) || [];
      existing.push(match);
      groups.set(match.supplierId, existing);
    }

    return groups;
  }

  /**
   * Format a plain text email for a supplier with their matched extraction results
   */
  private formatSupplierEmail(
    supplier: Supplier,
    extractionResults: Array<{ id: string; jobId?: string; data: any }>,
    options?: FormatOptions
  ): string {
    const lines: string[] = [];

    // Email header
    lines.push(`To: ${supplier.contactEmail}`);
    if (supplier.contactName) {
      lines.push(`Attention: ${supplier.contactName}`);
    }
    lines.push(`Subject: Material Request - ${extractionResults.length} Items`);
    lines.push("");
    lines.push("---");
    lines.push("");

    // Email body
    lines.push(`Dear ${supplier.contactName || supplier.name},`);
    lines.push("");
    lines.push(
      `We are reaching out to request a quote for the following materials that we believe you can supply:`
    );
    lines.push("");

    // List of items
    lines.push("REQUESTED MATERIALS:");
    lines.push("=".repeat(60));
    lines.push("");

    extractionResults.forEach((result, index) => {
      const data = result.data || {};

      lines.push(`Item ${index + 1}:`);

      const selectedDataFields = options?.dataFields || [];
      const selectedMetaFields = options?.metaFields || [];

      const renderMetaField = (label: string, value: unknown) => {
        const formatted = this.formatFieldValue(value);
        if (formatted) {
          lines.push(`  ${label}: ${formatted}`);
        }
      };

      const renderDataField = (fieldKey: string) => {
        const value = data[fieldKey];
        const formatted = this.formatFieldValue(value);
        if (!formatted) {
          return;
        }
        lines.push(`  ${this.formatFieldLabel(fieldKey)}: ${formatted}`);
      };

      if (selectedMetaFields.includes("resultId")) {
        renderMetaField("Extraction Result ID", result.id);
      }

      if (selectedMetaFields.includes("jobId") && result.jobId) {
        renderMetaField("Extraction Job ID", result.jobId);
      }

      if (selectedDataFields.length > 0) {
        selectedDataFields.forEach(renderDataField);
      } else {
        // Fallback to default rendering if no fields selected
        if (data.itemCode || data.item_code) {
          lines.push(
            `  Code: ${this.formatFieldValue(data.itemCode || data.item_code)}`
          );
        }

        if (data.itemName || data.item_name || data.description) {
          lines.push(
            `  Name: ${this.formatFieldValue(
              data.itemName || data.item_name || data.description
            )}`
          );
        }

        if (data.quantity) {
          const unit = data.unit || "";
          lines.push(
            `  Quantity: ${this.formatFieldValue(data.quantity)} ${unit}`.trim()
          );
        }

        const excludeFields = [
          "itemCode",
          "item_code",
          "itemName",
          "item_name",
          "description",
          "quantity",
          "unit",
          "id"
        ];

        Object.entries(data).forEach(([key, value]) => {
          const formatted = this.formatFieldValue(value);
          if (!excludeFields.includes(key) && formatted) {
            lines.push(`  ${this.formatFieldLabel(key)}: ${formatted}`);
          }
        });
      }

      lines.push("");
    });

    lines.push("=".repeat(60));
    lines.push("");

    // Closing
    lines.push(
      "Please provide your best quote for these materials, including:"
    );
    lines.push("- Unit pricing");
    lines.push("- Availability and lead time");
    lines.push("- Minimum order quantities (if applicable)");
    lines.push("- Delivery terms");
    lines.push("");
    lines.push(
      "We look forward to your response. Please feel free to contact us if you need any clarification."
    );
    lines.push("");
    lines.push("Best regards");
    lines.push("");

    // Supplier contact info footer
    lines.push("---");
    lines.push("");
    lines.push("SUPPLIER INFORMATION:");
    lines.push(`Name: ${supplier.name}`);
    lines.push(`Email: ${supplier.contactEmail}`);
    if (supplier.contactPhone) {
      lines.push(`Phone: ${supplier.contactPhone}`);
    }
    if (supplier.address) {
      const addr = supplier.address as any;
      if (addr.street || addr.city || addr.state || addr.country) {
        lines.push("Address:");
        if (addr.street) lines.push(`  ${addr.street}`);
        if (addr.city || addr.state) {
          lines.push(`  ${[addr.city, addr.state].filter(Boolean).join(", ")}`);
        }
        if (addr.postalCode) lines.push(`  ${addr.postalCode}`);
        if (addr.country) lines.push(`  ${addr.country}`);
      }
    }

    return lines.join("\n");
  }

  private formatFieldLabel(field: string): string {
    const withSpaces = field
      .replace(/[_-]+/g, " ")
      .replace(/([a-z\d])([A-Z])/g, "$1 $2")
      .toLowerCase();

    return withSpaces
      .split(" ")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  private formatFieldValue(value: unknown): string {
    if (value === null || value === undefined) {
      return "";
    }

    if (typeof value === "object") {
      try {
        return JSON.stringify(value);
      } catch {
        return "";
      }
    }

    return String(value);
  }
}
