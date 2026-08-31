import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException
} from "@nestjs/common";
import type {
  LexDocument,
  LexMessageAudio,
  LexVoiceUploadSlot,
  PresignVoiceRequest
} from "@packages/types";
import type { PoolClient } from "pg";
import { LexS3Service } from "../../shared/lex-s3.service";
import {
  MAX_TRANSCRIBE_BYTES,
  OpenAiService
} from "../../shared/openai.service";
import { PgService } from "../../shared/pg.service";
import { sanitizeForStorage } from "../documents/chunker";
import { mapDocument } from "../documents/documents.service";

/**
 * Recordings made in the chat composer.
 *
 * A voice note used to become a DOCUMENT: it was uploaded, queued, transcribed minutes later by the
 * ingestion pool, and the chat thread never mentioned it. That is the wrong shape for talking to the
 * agent. Here the transcript becomes the message's own content, so a dictated question reaches the
 * model exactly as a typed one does, and the audio is kept beside it for playback.
 *
 * Two consequences worth stating, because they are the trade:
 *
 *  - A spoken turn is NOT retrievable and NOT citable. A question is not evidence, and 200 rows
 *    named "Voice note 2026-08-31 14h32" in the documents panel is not a case file. fileAsDocument
 *    is the explicit path for a recording that dictated a fact rather than asked a question.
 *  - Transcription is SYNCHRONOUS, not queued. The ingestion pool polls every five seconds with
 *    three workers that may each be halfway through OCR of a 200-page scan, so a spoken question
 *    would wait an unbounded time to become a message.
 *
 * Its own service rather than part of ConversationsService because it owns S3 and speech-to-text,
 * which that service does not touch. It deliberately does not inject ConversationsService: that
 * would be circular, and ownership is checked here with its own owner-scoped SQL.
 */

const AUDIO_COLUMNS = `id, owner_email, workspace_id, conversation_id, message_id, s3_key,
  s3_version_id, content_type, size_bytes, duration_seconds, transcript, transcribe_error,
  document_id, created_at`;

/**
 * Concurrent transcriptions allowed on this box.
 *
 * Mirrors the ingestion pool's POOL_SIZE, and for the same reason stated there: a Lex feature must
 * never starve the Campaigns API sharing this process. Each in-flight call buffers the whole object
 * in memory to hand it to the API, so the ceiling here is 3 x 25 MB = 75 MB, which a t3.medium can
 * absorb. The retry button makes repeat presses cheap for the user and expensive for the process,
 * which is exactly why this is a hard limit and not a hope.
 */
const MAX_CONCURRENT_TRANSCRIBE = 3;

interface MessageAudioRow {
  id: string;
  owner_email: string;
  workspace_id: string;
  conversation_id: string;
  message_id: string | null;
  s3_key: string;
  s3_version_id: string | null;
  content_type: string;
  size_bytes: string | number | null;
  duration_seconds: number | null;
  transcript: string | null;
  transcribe_error: string | null;
  document_id: string | null;
  created_at: Date;
}

/**
 * The extension the transcription API dispatches on. It reads the FILENAME, not the mime type, so a
 * Safari recording sent as `message.webm` is rejected even though the bytes are valid mp4.
 *
 * Mirrors extensionFor() in the frontend's use-voice-recorder. The two must agree.
 */
export function audioExtension(contentType: string): string {
  const type = (contentType || "").toLowerCase();
  if (type.includes("mp4") || type.includes("m4a")) return "m4a";
  if (type.includes("ogg")) return "ogg";
  if (type.includes("mpeg") || type.includes("mp3")) return "mp3";
  if (type.includes("wav")) return "wav";
  return "webm";
}

function mapMessageAudio(r: MessageAudioRow): LexMessageAudio {
  return {
    id: r.id,
    messageId: r.message_id,
    contentType: r.content_type,
    durationSeconds: r.duration_seconds,
    transcript: r.transcript,
    documentId: r.document_id,
    createdAt:
      r.created_at instanceof Date
        ? r.created_at.toISOString()
        : String(r.created_at)
  };
}

/** `Voice note 2026-08-31 14h32.webm`, derived server-side because the promote path has no locale. */
function voiceFilename(createdAt: Date, ext: string): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${createdAt.getFullYear()}-${pad(createdAt.getMonth() + 1)}-${pad(createdAt.getDate())} ` +
    `${pad(createdAt.getHours())}h${pad(createdAt.getMinutes())}`;
  return `Voice note ${stamp}.${ext}`;
}

@Injectable()
export class VoiceService {
  private readonly logger = new Logger(VoiceService.name);
  private inFlight = 0;

  constructor(
    private pg: PgService,
    private s3: LexS3Service,
    private openai: OpenAiService
  ) {}

  /**
   * Step 1: reserve a row and a presigned PUT. The bytes never traverse this API.
   *
   * Same route as a document upload, and for the same reason: nginx caps request bodies at 10 MB in
   * production, and thirty minutes of opus is comfortably past that.
   */
  async presign(
    ownerEmail: string,
    conversationId: string,
    req: PresignVoiceRequest
  ): Promise<LexVoiceUploadSlot> {
    const conv = await this.pg.query<{ workspace_id: string }>(
      `SELECT workspace_id FROM lex_conversations WHERE id = $1 AND owner_email = $2`,
      [conversationId, ownerEmail]
    );
    if (conv.rows.length === 0) {
      throw new NotFoundException("Conversation not found");
    }

    const id = randomUUID();
    const ext = audioExtension(req.contentType);
    // Under the workspace prefix like a document, but in its own voice/ segment: these objects are
    // chat turns, not pièces, and a later retention rule has to be able to tell them apart.
    const key = `lex/${ownerEmail}/${conv.rows[0].workspace_id}/voice/${id}/message.${ext}`;

    const res = await this.pg.query<MessageAudioRow>(
      `INSERT INTO lex_message_audio
         (id, owner_email, workspace_id, conversation_id, s3_key, content_type, size_bytes,
          duration_seconds)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${AUDIO_COLUMNS}`,
      [
        id,
        ownerEmail,
        conv.rows[0].workspace_id,
        conversationId,
        key,
        req.contentType,
        req.size,
        req.durationSeconds ?? null
      ]
    );

    return {
      audio: mapMessageAudio(res.rows[0]),
      // Signed for the exact Content-Type the browser must send, or S3 rejects the signature. The
      // codecs parameter stays: MediaRecorder reports "audio/webm;codecs=opus" and the PUT echoes
      // back what this returns, so neither side normalises it alone.
      uploadUrl: await this.s3.presignedPutUrl(key, req.contentType),
      contentType: req.contentType
    };
  }

  /**
   * Step 2: speech-to-text on the uploaded object.
   *
   * An empty result is a success with an empty transcript, NOT an error. The ingestion worker throws
   * on an empty transcription because a document with no text is not indexable; here the recording
   * is still worth keeping and the user can type the message with the audio attached.
   */
  async transcribe(
    ownerEmail: string,
    audioId: string
  ): Promise<{ transcript: string; durationSeconds: number | null }> {
    const row = await this.loadUnbound(ownerEmail, audioId);

    const head = await this.s3.head(row.s3_key);
    if (!head) {
      throw new BadRequestException("The recording was not uploaded");
    }
    if (head.size > MAX_TRANSCRIBE_BYTES) {
      throw new BadRequestException(
        `Recording is too long to transcribe (${Math.round(head.size / 1024 / 1024)} MB, max 25 MB)`
      );
    }
    // Bounded before the object is fetched, so a rejected request costs nothing. See
    // MAX_CONCURRENT_TRANSCRIBE: the memory this holds is the reason.
    if (this.inFlight >= MAX_CONCURRENT_TRANSCRIBE) {
      throw new HttpException("Too many recordings being transcribed", 429);
    }

    this.inFlight += 1;
    let text = "";
    let measured: number | null = null;
    try {
      const { body } = await this.s3.get(row.s3_key, head.versionId);
      const out = await this.openai.transcribe(
        body,
        `message.${audioExtension(row.content_type)}`,
        row.content_type
      );
      // Sanitised on the way in: this is a text column and the text becomes a message.
      text = sanitizeForStorage(out.text).trim();
      measured = out.durationSeconds;
    } catch (err) {
      await this.pg.query(
        `UPDATE lex_message_audio SET transcribe_error = $2 WHERE id = $1`,
        [audioId, String(err).slice(0, 500)]
      );
      // Rethrown, not swallowed: the recording stays in S3 and the client offers a retry against
      // the object already there, rather than losing the dictation.
      throw err;
    } finally {
      this.inFlight -= 1;
    }

    await this.pg.query(
      `UPDATE lex_message_audio
          SET transcript = $2,
              -- Whisper's measurement beats the recorder's timer, which counts wall-clock seconds
              -- including the moment between pressing stop and the recorder flushing.
              duration_seconds = COALESCE($3, duration_seconds),
              s3_version_id = $4,
              size_bytes = $5,
              transcribe_error = NULL
        WHERE id = $1`,
      [audioId, text, measured, head.versionId ?? null, head.size]
    );

    this.logger.log(
      JSON.stringify({
        action: "lexVoiceTranscribed",
        audioId,
        chars: text.length,
        durationSeconds: measured ?? row.duration_seconds,
        // Zero means whisper heard nothing. Worth a number rather than a guess, because a muted mic
        // and a silent room are indistinguishable to the user.
        empty: text.length === 0
      })
    );

    return {
      transcript: text,
      durationSeconds: measured ?? row.duration_seconds
    };
  }

  /** Playback: a short-lived presigned GET, fetched when a bubble is first played. */
  async urlFor(
    ownerEmail: string,
    audioId: string
  ): Promise<{ url: string; expiresIn: number }> {
    const row = await this.load(ownerEmail, audioId);
    const expiresIn = 900;
    return {
      url: await this.s3.presignedGetUrl(
        row.s3_key,
        row.s3_version_id ?? undefined,
        expiresIn
      ),
      expiresIn
    };
  }

  /**
   * Releases an unsent recording: the chip was removed, the PUT failed, or the turn went to a
   * background run that writes its own synthetic user turn.
   *
   * Deletes the OBJECT as well as the row. This path is fully under our control, so leaving the
   * bytes behind would be a guaranteed leak per use in a versioned bucket holding legal audio, not
   * the background "no sweeper exists" gap.
   */
  async discard(ownerEmail: string, audioId: string): Promise<void> {
    const res = await this.pg.query<MessageAudioRow>(
      `DELETE FROM lex_message_audio
        WHERE id = $1 AND owner_email = $2 AND message_id IS NULL
        RETURNING ${AUDIO_COLUMNS}`,
      [audioId, ownerEmail]
    );
    const row = res.rows[0];
    if (!row) return;
    // Best-effort: the row is already gone, and failing the request would tell the user their
    // discard did not work when the only thing left is an object no path can reach.
    await this.s3.delete(row.s3_key).catch((err) => {
      this.logger.warn(
        JSON.stringify({
          level: "warn",
          action: "lexVoiceDiscardObjectFailed",
          audioId,
          error: String(err)
        })
      );
    });
  }

  /**
   * Rejects a wrong recording id BEFORE the SSE headers go out, so the client gets a real HTTP
   * error instead of an error frame inside a 200 stream. bindToMessage checks again inside the
   * transaction, authoritatively.
   */
  async assertBindable(
    ownerEmail: string,
    conversationId: string,
    audioId: string
  ): Promise<void> {
    const res = await this.pg.query<{ id: string }>(
      `SELECT id FROM lex_message_audio
        WHERE id = $1 AND owner_email = $2 AND conversation_id = $3 AND message_id IS NULL`,
      [audioId, ownerEmail, conversationId]
    );
    if (res.rows.length === 0) {
      throw new BadRequestException(
        "This recording cannot be attached to the message"
      );
    }
  }

  /**
   * Binds the recording to the user turn, inside the CALLER'S transaction.
   *
   * Atomic on purpose: a rejected id must leave nothing behind, not a message whose bubble offers a
   * player that plays nothing. The `message_id IS NULL` predicate plus the UNIQUE constraint make a
   * second bind impossible, so a double-tapped send cannot attach one recording to two turns.
   */
  async bindToMessage(
    client: PoolClient,
    ownerEmail: string,
    audioId: string,
    conversationId: string,
    messageId: string
  ): Promise<void> {
    const res = await client.query(
      `UPDATE lex_message_audio SET message_id = $1
        WHERE id = $2 AND owner_email = $3 AND conversation_id = $4 AND message_id IS NULL`,
      [messageId, audioId, ownerEmail, conversationId]
    );
    if ((res.rowCount ?? 0) === 0) {
      throw new BadRequestException(
        "This recording cannot be attached to the message"
      );
    }
  }

  /**
   * The audio for a page of messages, keyed by message id. Mirrors
   * ConversationsService.citationsFor: one query for the page, not one per row.
   */
  async audioForMessages(
    ownerEmail: string,
    messageIds: readonly string[]
  ): Promise<Record<string, LexMessageAudio>> {
    if (messageIds.length === 0) return {};
    const res = await this.pg.query<MessageAudioRow>(
      `SELECT ${AUDIO_COLUMNS} FROM lex_message_audio
        WHERE owner_email = $1 AND message_id = ANY($2::uuid[])`,
      [ownerEmail, messageIds]
    );
    const byMessage: Record<string, LexMessageAudio> = {};
    for (const r of res.rows) {
      if (r.message_id) byMessage[r.message_id] = mapMessageAudio(r);
    }
    return byMessage;
  }

  /**
   * Files a sent recording as a pièce, so a dictated FACT becomes retrievable and citable.
   *
   * The object is copied under a document key and the row carries the MESSAGE's text as its
   * transcript, then a 'reindex' job chunks and embeds it. 'reindex' rather than 'full' because the
   * text already exists and is better than a second transcription would be: the user may have
   * corrected it before sending, and there is no reason to pay whisper twice.
   *
   * sha256 is left NULL. It is nullable since the direct-upload migration, and the empty string
   * would be a real key in the duplicate-hash index — two filed recordings would collide on it.
   */
  async fileAsDocument(
    ownerEmail: string,
    audioId: string
  ): Promise<LexDocument> {
    const row = await this.load(ownerEmail, audioId);
    if (!row.message_id) {
      throw new BadRequestException("This recording has not been sent yet");
    }
    if (row.document_id) {
      throw new BadRequestException("This recording is already filed");
    }

    const msg = await this.pg.query<{ content: string }>(
      `SELECT content FROM lex_messages WHERE id = $1 AND owner_email = $2`,
      [row.message_id, ownerEmail]
    );
    const transcript = msg.rows[0]?.content?.trim() ?? "";
    if (!transcript) {
      throw new BadRequestException(
        "This recording has no text to index. Correct the transcript first."
      );
    }

    const documentId = randomUUID();
    const ext = audioExtension(row.content_type);
    const destKey = `lex/${ownerEmail}/${row.workspace_id}/${documentId}/original.${ext}`;
    const copied = await this.s3.copy(row.s3_key, destKey);

    const created = await this.pg.withTransaction(async (client) => {
      const res = await client.query(
        `INSERT INTO lex_documents
           (id, workspace_id, owner_email, filename, content_type, size_bytes, s3_key,
            s3_version_id, transcript, duration_seconds, parse_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'uploaded')
         RETURNING *`,
        [
          documentId,
          row.workspace_id,
          ownerEmail,
          voiceFilename(row.created_at, ext),
          row.content_type,
          row.size_bytes,
          destKey,
          copied.versionId ?? null,
          transcript,
          row.duration_seconds
        ]
      );
      await client.query(
        `INSERT INTO lex_ingestion_jobs (document_id, workspace_id, mode)
         VALUES ($1, $2, 'reindex')`,
        [documentId, row.workspace_id]
      );
      await client.query(
        `UPDATE lex_message_audio SET document_id = $2 WHERE id = $1`,
        [audioId, documentId]
      );
      return res.rows[0];
    });

    this.logger.log(
      JSON.stringify({
        action: "lexVoiceFiledAsDocument",
        audioId,
        documentId,
        chars: transcript.length
      })
    );

    return mapDocument(created);
  }

  private async load(
    ownerEmail: string,
    audioId: string
  ): Promise<MessageAudioRow> {
    const res = await this.pg.query<MessageAudioRow>(
      `SELECT ${AUDIO_COLUMNS} FROM lex_message_audio WHERE id = $1 AND owner_email = $2`,
      [audioId, ownerEmail]
    );
    const row = res.rows[0];
    if (!row) throw new NotFoundException("Recording not found");
    return row;
  }

  /** A recording that is still a draft. Already-sent audio is never re-transcribed in place. */
  private async loadUnbound(
    ownerEmail: string,
    audioId: string
  ): Promise<MessageAudioRow> {
    const row = await this.load(ownerEmail, audioId);
    if (row.message_id) {
      throw new BadRequestException("This recording has already been sent");
    }
    return row;
  }
}
