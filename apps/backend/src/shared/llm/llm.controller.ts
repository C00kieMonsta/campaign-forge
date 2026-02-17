import {
  Body,
  Controller,
  Logger,
  Post,
  Query,
  Response,
  UploadedFile,
  UploadedFiles,
  UseInterceptors
} from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { TaskCriticality } from "@packages/types";
import { ZodSchema } from "zod";
import { BlobStorageService } from "@/shared/blob-storage/blob-storage.service";
import { LLMService } from "@/shared/llm/llm.service";
import { ChatRequest } from "@/shared/llm/schemas/request";
import { ChatResponse } from "@/shared/llm/schemas/response";

interface GenerateRequest<T = any> {
  system: string;
  prompt: string;
  schema?: ZodSchema<T>;
  criticality?: TaskCriticality;
}

export interface Context {
  uid: string;
  organization_uid: string;
  client_uid: string;
  asset_uid: string;
  created_at: string;
  context_type: string;
  context_subtype: string;
  mime_type: string;
  extracted_fields: Record<string, any>;
  s3_uri?: string;
  blob: Buffer; // diff to FE where this is a blob
}

interface GenerateReportRequest {
  contexts: Context[];
  current_data: any;
  systemPrompt: string;
  organization_uid: string;
  client_uid: string;
}

interface GenerateReportResponse {
  result_id: string;
}

interface GenerateWithImageRequest<T = any> {
  systemMessage: string;
  prompt: string;
  imageBuffer?: Buffer;
  imageBuffers?: Buffer[];
  mediaType?: string;
  mediaTypes?: string[];
  schema?: ZodSchema<T>;
  criticality?: TaskCriticality;
}

@Controller("llm")
export class LLMController {
  private readonly logger = new Logger(LLMController.name);
  constructor(
    private readonly llmService: LLMService,
    private readonly blobStorageService: BlobStorageService
  ) {}

  @Post("generate")
  async generate<T = any>(
    @Body() request: GenerateRequest<T>,
    @Response() res: any
  ): Promise<void> {
    const { system, prompt, schema, criticality } = request;
    const result = await this.llmService.ask<T>({
      systemPrompt: system,
      userPrompt: prompt,
      schema,
      criticality
    });
    res.json({ result: result, error: null });
  }

  @Post("chat")
  async chat(
    @Body() request: ChatRequest,
    @Query("criticality") criticality?: TaskCriticality
  ): Promise<ChatResponse> {
    return this.llmService.chat(request, criticality);
  }

  @Post("generate_with_image")
  @UseInterceptors(FilesInterceptor("images"))
  async generateWithImage(
    @Body() request: GenerateWithImageRequest,
    @UploadedFile() file?: Express.Multer.File,
    @UploadedFiles() files?: Express.Multer.File[]
  ): Promise<{ result: string | Record<string, any> }> {
    try {
      const { systemMessage, prompt, mediaType, criticality } = request;

      // Handle both single file and multiple files for backward compatibility
      let imageBuffers: Buffer[] = [];
      let mediaTypes: string[] = [];

      // Check if we got files array from FilesInterceptor
      if (files && files.length > 0) {
        imageBuffers = files.map((f) => f.buffer);
        mediaTypes = files.map((f) => f.mimetype);
      }
      // Fallback to single file for backward compatibility
      else if (file && file.buffer) {
        imageBuffers = [file.buffer];
        mediaTypes = [mediaType || file.mimetype];
      }

      const result = await this.llmService.generateWithBuffers(
        systemMessage,
        prompt,
        imageBuffers,
        mediaTypes,
        undefined, // schema
        criticality
      );

      return { result };
    } catch (error: any) {
      this.logger.error("Error in generateWithImage:", error);
      throw error;
    }
  }
}
