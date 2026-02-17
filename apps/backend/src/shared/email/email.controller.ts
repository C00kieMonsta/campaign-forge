// Temporarily commented out due to missing dependencies and types
/*
import { UserId } from "@/decorators/user-id.decorator";
import {
  Body,
  Controller,
  Post,
  UploadedFiles,
  UseInterceptors,
} from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { EmailService } from "@/shared/emailemail.service";

@Controller("email")
export class EmailController {
  constructor(private readonly emailService: EmailService) {}

  @Post("send")
  @UseInterceptors(FilesInterceptor("attachments"))
  async sendEmail(
    @Body() emailData: any,
    @UserId() userId: string,
    @UploadedFiles() attachmentFiles: Express.Multer.File[],
  ) {
    return this.emailService.sendEmail(emailData, userId, attachmentFiles);
  }
}
*/
