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
  contactAssistantExtractFieldsSchema,
  MAX_ASSISTANT_UPLOAD_BYTES
} from "@packages/types";
import { AdminGuard } from "../auth/admin.guard";
import { formatZodError } from "../shared/validation";
import { ContactAssistantService } from "./contact-assistant.service";
import { toHttpException } from "./http-errors";

/** Contacts out of a photo, a recording or a pasted text. One multipart request, one model call. */
@UseGuards(AdminGuard)
@Controller("admin/contacts/assistant")
export class ContactAssistantController {
  private readonly logger = new Logger(ContactAssistantController.name);

  constructor(private assistant: ContactAssistantService) {}

  @Post("extract")
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
  async extract(
    @Body() body: unknown,
    @UploadedFile() file?: Express.Multer.File
  ) {
    const parsed = contactAssistantExtractFieldsSchema.safeParse(body ?? {});
    if (!parsed.success)
      throw new BadRequestException(formatZodError(parsed.error));
    try {
      return await this.assistant.extract({
        file: file
          ? {
              buffer: file.buffer,
              mimetype: file.mimetype,
              originalname: file.originalname,
              size: file.size
            }
          : undefined,
        text: parsed.data.text,
        language: parsed.data.language
      });
    } catch (err) {
      this.logger.error(
        JSON.stringify({
          action: "contactAssistantExtractFailed",
          error: err instanceof Error ? err.message : String(err)
        })
      );
      throw toHttpException(err);
    }
  }
}
