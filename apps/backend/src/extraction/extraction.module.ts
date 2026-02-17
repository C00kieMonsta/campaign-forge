import { Module } from "@nestjs/common";
import { ConfigModule } from "@/config/config.module";
import { ExtractionController } from "@/extraction/extraction.controller";
import { ExtractionResultController } from "@/extraction/extraction-result.controller";
import { AgentDiagnosticsService } from "@/extraction/services/agent-diagnostics.service";
import { AgentExecutionService } from "@/extraction/services/agent-execution.service";
import { AgentInputValidatorService } from "@/extraction/services/agent-input-validator.service";
import { ExtractionResultService } from "@/extraction/services/extraction-result.service";
import { ExtractionSchemaService } from "@/extraction/services/extraction-schema.service";
import { ExtractionWorkflowService } from "@/extraction/services/extraction-workflow.service";
import { ExtractionService } from "@/extraction/services/extraction.service";
import { PDFExtractionService } from "@/extraction/services/pdf-extraction.service";
import { PDFProcessingService } from "@/extraction/services/pdf-processing.service";
import { SchemaCompilerService } from "@/extraction/services/schema-compiler.service";
import { ZipProcessingService } from "@/extraction/services/zip-processing.service";
import { DatabaseModule } from "@/shared/database/database.module";
import { SharedModule } from "@/shared/shared.module";
import { SuppliersModule } from "@/suppliers/suppliers.module";

@Module({
  imports: [ConfigModule, SharedModule, DatabaseModule, SuppliersModule],
  controllers: [ExtractionController, ExtractionResultController],
  providers: [
    ExtractionService,
    ExtractionResultService,
    PDFExtractionService,
    PDFProcessingService,
    ZipProcessingService,
    ExtractionWorkflowService,
    ExtractionSchemaService,
    SchemaCompilerService,
    AgentExecutionService,
    AgentDiagnosticsService,
    AgentInputValidatorService
  ],
  exports: [
    ExtractionService,
    ExtractionResultService,
    PDFExtractionService,
    PDFProcessingService,
    ZipProcessingService,
    ExtractionWorkflowService,
    ExtractionSchemaService,
    SchemaCompilerService,
    AgentExecutionService,
    AgentDiagnosticsService,
    AgentInputValidatorService
  ]
})
export class ExtractionModule {}
