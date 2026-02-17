import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Post,
  Request
} from "@nestjs/common";
import {
  DeleteResultsRequest,
  DeleteResultsRequestSchema
} from "@packages/types";
import { ExtractionResultService } from "@/extraction/services/extraction-result.service";
import { Audit } from "@/logger/audit.decorator";
import { AuthenticatedRequest } from "@/shared/types/request.types";

@Controller("extraction-results")
export class ExtractionResultController {
  constructor(private extractionResultService: ExtractionResultService) {}

  @Post("bulk-delete")
  @Audit({ action: "bulk_delete", resource: "extraction_result" })
  async bulkDeleteResults(
    @Body() body: DeleteResultsRequest,
    @Request() req: AuthenticatedRequest
  ): Promise<{ success: boolean; deletedCount: number }> {
    const user = req.user;
    if (!user) {
      throw new HttpException("User not found", HttpStatus.UNAUTHORIZED);
    }

    const validatedData = DeleteResultsRequestSchema.parse(body);

    const deletedCount =
      await this.extractionResultService.deleteExtractionResults(
        validatedData.resultIds
      );

    return { success: true, deletedCount };
  }
}
