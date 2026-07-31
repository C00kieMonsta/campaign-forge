import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards
} from "@nestjs/common";
import {
  createConversationRequestSchema,
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

@UseGuards(AdminGuard)
@Controller("admin/lex")
export class ConversationsController {
  constructor(
    private conversations: ConversationsService,
    private rag: RagService
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
        parsed.data.pins ?? []
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
