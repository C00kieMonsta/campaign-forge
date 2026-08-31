import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards
} from "@nestjs/common";
import {
  createConversationRequestSchema,
  presignVoiceRequestSchema,
  renameConversationRequestSchema,
  sendMessageRequestSchema,
  type LexStreamEvent
} from "@packages/types";
import type { Response } from "express";
import { AdminGuard } from "../../auth/admin.guard";
import type { AuthUser } from "../../auth/admin.guard";
import { CurrentUser } from "../../auth/current-user.decorator";
import { formatZodError } from "../../shared/validation";
import { RagService } from "../ai/rag.service";
import { ConversationsService } from "./conversations.service";
import { VoiceService } from "./voice.service";

@UseGuards(AdminGuard)
@Controller("admin/lex")
export class ConversationsController {
  constructor(
    private conversations: ConversationsService,
    private rag: RagService,
    private voice: VoiceService
  ) {}

  @Get("workspaces/:workspaceId/conversations")
  async list(
    @CurrentUser() user: AuthUser,
    @Param("workspaceId") workspaceId: string
  ) {
    const items = await this.conversations.list(user.email, workspaceId);
    return { items };
  }

  @Post("workspaces/:workspaceId/conversations")
  async create(
    @CurrentUser() user: AuthUser,
    @Param("workspaceId") workspaceId: string,
    @Body() body: unknown
  ) {
    const parsed = createConversationRequestSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException(formatZodError(parsed.error));
    const conversation = await this.conversations.create(
      user.email,
      workspaceId,
      parsed.data
    );
    return { conversation };
  }

  @Get("conversations/:id")
  async get(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    const conversation = await this.conversations.getOrFail(user.email, id);
    return { conversation };
  }

  @Patch("conversations/:id")
  async rename(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() body: unknown
  ) {
    const parsed = renameConversationRequestSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException(formatZodError(parsed.error));
    const conversation = await this.conversations.rename(
      user.email,
      id,
      parsed.data.title
    );
    return { conversation };
  }

  @Delete("conversations/:id")
  async delete(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    await this.conversations.delete(user.email, id);
    return { ok: true as const };
  }

  /**
   * A page of messages. Without params it returns the newest page; pass `beforeSeq` to walk
   * backwards. A years-long thread is never sent in one response.
   */
  @Get("conversations/:id/messages")
  async messages(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Query("beforeSeq") beforeSeq?: string,
    @Query("limit") limit?: string
  ) {
    const parsedBefore = beforeSeq ? Number(beforeSeq) : undefined;
    const parsedLimit = limit ? Number(limit) : undefined;
    if (
      (parsedBefore !== undefined && !Number.isFinite(parsedBefore)) ||
      (parsedLimit !== undefined && !Number.isFinite(parsedLimit))
    ) {
      throw new BadRequestException("beforeSeq and limit must be numbers");
    }
    return this.conversations.messages(user.email, id, {
      beforeSeq: parsedBefore,
      limit: parsedLimit
    });
  }

  /** SSE endpoint: streams the assistant reply as `token` events, then `citations`, then `done`. */
  @Post("conversations/:id/messages/stream")
  async stream(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() body: unknown,
    @Res() res: Response
  ) {
    const parsed = sendMessageRequestSchema.safeParse(body);
    if (!parsed.success) {
      res.status(400).json({ message: formatZodError(parsed.error) });
      return;
    }

    // Checked BEFORE the SSE headers, so a bad recording id is an ordinary HTTP error the composer
    // can act on. Once the stream is open every failure is an error frame inside a 200, and the
    // client cannot tell "nothing was written" from "the reply died halfway".
    if (parsed.data.audioId) {
      try {
        await this.voice.assertBindable(user.email, id, parsed.data.audioId);
      } catch (err) {
        res.status(err instanceof HttpException ? err.getStatus() : 400).json({
          message: err instanceof Error ? err.message : String(err)
        });
        return;
      }
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const send = (event: LexStreamEvent) =>
      res.write(`data: ${JSON.stringify(event)}\n\n`);

    try {
      const { messageId, citations } = await this.conversations.streamReply(
        user.email,
        id,
        parsed.data.content,
        (delta) => send({ type: "token", delta }),
        parsed.data.pins ?? [],
        parsed.data.depth,
        parsed.data.audioId
      );
      send({ type: "citations", citations });
      send({ type: "done", messageId });
    } catch (err) {
      send({
        type: "error",
        message: err instanceof Error ? err.message : String(err)
      });
    } finally {
      res.end();
    }
  }

  // ── Voice messages ──────────────────────────────────────────────────────────────────
  // The literal `voice/` first segment keeps these clear of the `conversations/:id` routes above,
  // so no path can be swallowed by a bare parameter.

  /**
   * A slot for a recording made in the composer. Same route as a document upload: the bytes go
   * browser to S3 and never through this API, which nginx caps at 10 MB in production.
   */
  @Post("conversations/:id/voice/presign")
  async presignVoice(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() body: unknown
  ) {
    const parsed = presignVoiceRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(formatZodError(parsed.error));
    }
    return this.voice.presign(user.email, id, parsed.data);
  }

  /**
   * Speech-to-text on an uploaded recording, synchronously, so the transcript can BE the message.
   *
   * Not the ingestion queue: its workers poll every five seconds and may each be halfway through
   * OCR of a 200-page scan, so a spoken question would wait an unbounded time to become a turn.
   * Needs its own nginx location with a raised proxy_read_timeout — see scripts/ec2-bootstrap.sh.
   */
  @Post("voice/:audioId/transcribe")
  async transcribeVoice(
    @CurrentUser() user: AuthUser,
    @Param("audioId") audioId: string
  ) {
    return this.voice.transcribe(user.email, audioId);
  }

  /** A short-lived presigned GET so a spoken turn's bubble can be played back. */
  @Get("voice/:audioId/url")
  async voiceUrl(
    @CurrentUser() user: AuthUser,
    @Param("audioId") audioId: string
  ) {
    return this.voice.urlFor(user.email, audioId);
  }

  /** Files a sent recording as a pièce, so a dictated fact becomes retrievable and citable. */
  @Post("voice/:audioId/document")
  async fileVoiceAsDocument(
    @CurrentUser() user: AuthUser,
    @Param("audioId") audioId: string
  ) {
    return { document: await this.voice.fileAsDocument(user.email, audioId) };
  }

  /** Releases an unsent recording, object included. */
  @Delete("voice/:audioId")
  async discardVoice(
    @CurrentUser() user: AuthUser,
    @Param("audioId") audioId: string
  ) {
    await this.voice.discard(user.email, audioId);
    return { ok: true as const };
  }

  /** Debug aid: inspect what retrieval returns for a query in a workspace. */
  @Get("workspaces/:workspaceId/search")
  async search(
    @CurrentUser() user: AuthUser,
    @Param("workspaceId") workspaceId: string,
    @Query("q") q: string
  ) {
    if (!q) throw new BadRequestException("Missing query parameter 'q'");
    const chunks = await this.rag.retrieve(user.email, workspaceId, q);
    return { chunks };
  }
}
