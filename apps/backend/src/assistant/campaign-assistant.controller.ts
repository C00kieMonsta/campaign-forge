import {
  BadRequestException,
  Body,
  Controller,
  Logger,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  campaignAssistantTurnRequestSchema,
  MAX_ASSISTANT_UPLOAD_BYTES,
  type AssistantTranscribeResponse
} from "@packages/types";
import { AdminGuard } from "../auth/admin.guard";
import { audioExtension } from "../shared/audio";
import { OpenAiService } from "../shared/openai.service";
import { formatZodError } from "../shared/validation";
import { CampaignAssistantService } from "./campaign-assistant.service";
import { toHttpException } from "./http-errors";

/**
 * The chat that writes a campaign. Both routes are slow (one model call each) and have their own
 * nginx location with a long read timeout; see scripts/ec2-bootstrap.sh.
 */
@UseGuards(AdminGuard)
@Controller("admin/campaigns/assistant")
export class CampaignAssistantController {
  private readonly logger = new Logger(CampaignAssistantController.name);

  constructor(
    private assistant: CampaignAssistantService,
    private openai: OpenAiService
  ) {}

  @Post("turn")
  async turn(@Body() body: unknown) {
    const parsed = campaignAssistantTurnRequestSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException(formatZodError(parsed.error));
    try {
      return await this.assistant.turn(parsed.data);
    } catch (err) {
      this.logger.error(
        JSON.stringify({
          action: "campaignAssistantTurnFailed",
          error: err instanceof Error ? err.message : String(err)
        })
      );
      throw toHttpException(err);
    }
  }

  /** A dictated brief. The audio travels in the request body, not via S3: it is a few hundred KB. */
  @Post("transcribe")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: {
        fileSize: MAX_ASSISTANT_UPLOAD_BYTES,
        files: 1,
        fields: 4,
        fieldSize: 64 * 1024
      }
    })
  )
  async transcribe(
    @UploadedFile() file?: Express.Multer.File
  ): Promise<AssistantTranscribeResponse> {
    if (!file) throw new BadRequestException("No recording provided");
    if (!file.mimetype.toLowerCase().startsWith("audio/")) {
      throw new BadRequestException("The file is not an audio recording");
    }
    try {
      const out = await this.openai.transcribe(
        file.buffer,
        `brief.${audioExtension(file.mimetype)}`,
        file.mimetype,
        // A person is waiting; the SDK's ten minutes and two retries are for background jobs.
        { timeoutMs: 60_000, maxRetries: 0 }
      );
      return { text: out.text.trim(), durationSeconds: out.durationSeconds };
    } catch (err) {
      throw toHttpException(err);
    }
  }
}
