# Lex Roadmap v2 — expanded scope + decisions

Supersedes the ingestion/UX portions of [lex-architecture.md](./lex-architecture.md). Captures
the product direction added 2026-07-30 and the decisions taken.

## Locked decisions

- **DB layer:** raw SQL (pg + node-pg-migrate). See [ADR 0001](./adr/0001-lex-db-layer-raw-sql.md).
- **Entities:** `@packages/types` holds the _exposed API contract_; persistence rows stay
  private per backend service (internal columns like `embedding` never exported).
- **Transcription:** hosted **OpenAI `whisper-1`** (not billed as LLM tokens; no local compute).
- **OCR:** **Mistral OCR API** (`mistral-ocr-latest`), used only when a doc has no text layer.
- **Ingestion infra:** in-process **worker pool** (concurrency ~3–4) over `lex_ingestion_jobs`;
  OCR/transcription offloaded to APIs so the EC2 orchestrates. Bump **t3.small → t3.medium**.
- **Frontend:** Redux + controllers (store backbone shipped). Workspace **redesigned around one
  chat**; do NOT convert the standalone pages that the redesign replaces.

## Product requirements (v2)

1. **Bulk upload** up to 50 docs; a worker pool drains the queue, one job per worker.
2. **Formats:** pdf, docx, xlsx, md, txt, jpeg, png (+ other common safe types). Step 1 is the
   **text layer**; scanned/no-text or images → **Mistral OCR**.
3. **Voice notes:** record in chat ≤30 min, always **transcribed** (whisper-1). Re-listen
   (presigned audio URL) + re-read; transcription is **manually re-triggerable** and the transcript
   is **partially editable**.
   **Superseded 2026-08-31 (see Phase II bis):** a recording made in the chat is a **message**, not
   a document. A voice note uploaded as a FILE is still a document.
4. **Every document** carries, for search: **timeline date**, **summary in the document's
   language**, **key names**, **tags**.
5. **Document viewing** via a **presigned URL** (AWS SDK).
6. **Workspace = one focused chat** — a lawyer agent with access to all workspace documents,
   with **document + specific-page reference** UI, strong **context compression / memory**, and
   **chat actions** (generate email, generate document, …).

## Phases (re-sequenced)

### Phase I — Backend ingestion foundation ✅ done

- Config: `MISTRAL_API_KEY` (optional), `OCR_MODEL` (default `mistral-ocr-latest`),
  `TRANSCRIBE_MODEL` (default `whisper-1`). Deps: `xlsx` (SheetJS), `@aws-sdk/s3-request-presigner`.
- Parser handles pdf (unpdf), docx (mammoth), xlsx (SheetJS→text), md/txt (utf8), jpeg/png
  (→ OCR). `MistralOcrService` OCRs scanned PDFs + images when no text layer exists.
- Migration adds `language`, `key_names jsonb`, `tags jsonb` to `lex_documents`; the summarizer
  extracts `{ summary (in doc language), date, language, keyNames[], tags[] }`; exposed on
  `LexDocument`.
- `GET /documents/:id/view` → presigned URL. Ingestion becomes a **pool** (concurrency ~3–4).
  `POST /workspaces/:id/documents/bulk-upload` accepts ≤50 files.

### Phase II — Voice notes ✅ done

- No `document_kind` column: a voice note _is_ a document whose contentType is `audio/*`
  (`isAudio()` in `document-parser.ts` is the single predicate, extension included). Audio lands
  in the docs bucket like any upload; `OpenAiService.transcribe` (whisper-1, `verbose_json` for
  the duration) produces the text, which is chunked/embedded/summarized by the same pipeline.
- `transcript` + `duration_seconds` on `lex_documents`; the transcript is a **sub-resource**
  (`LexTranscript`), never carried by document reads — hence the explicit `DOC_COLUMNS` list.
- `lex_ingestion_jobs.mode`: `full` (derive text from S3 — parse / OCR / transcribe) or
  `reindex` (re-index from the stored, hand-corrected transcript — no second transcription spend).
- Endpoints: `GET|PATCH /documents/:id/transcript`, `POST /documents/:id/retranscribe`; re-listen
  reuses the presigned `GET /documents/:id/view`. Editing a transcript is audio-only, so a
  document's indexed text can never drift from its source.
- Frontend: a mic in the chat composer backed by `useVoiceRecorder` (MediaRecorder, 30-min cap,
  releases the mic on stop/cancel/unmount), plus `VoiceNoteDialog` for re-listening, re-reading,
  correcting and re-transcribing a note.

### Phase II bis — Voice as a chat message ✅ done

Supersedes the "a voice note IS a document" rule above for recordings made in the composer.

- A recording in the chat becomes a **user message**: its transcript is `lex_messages.content`, so
  the agent reads a dictated question exactly as it reads a typed one. The audio lives in
  `lex_message_audio` (`1754050000000_lex-voice-messages.js`) with a nullable `message_id` — unbound
  is a draft, bound is a sent turn.
- **A spoken turn is not retrievable and not citable.** A question is not evidence, and one document
  row per spoken sentence is not a case file. `POST /voice/:id/document` is the explicit promote
  path for a recording that dictated a FACT: it copies the object under a document key, carries the
  corrected text as the transcript, and enqueues `mode: 'reindex'` so whisper is not paid twice.
- Transcription is **synchronous** (`POST /voice/:id/transcribe`), not queued: the ingestion pool
  polls every five seconds and may be mid-OCR, so a spoken question would wait an unbounded time to
  become a turn. Capped at 3 concurrent calls, mirroring the ingestion pool, and given its own nginx
  location with `proxy_read_timeout 600s` — without that block a clip over roughly four minutes
  504s in production.
- The composer offers **Send** (the default: speak, send, the agent answers) and **Review** (the
  transcript lands in the composer first). Review exists because speech-to-text mishears proper
  names and invents a sentence on a silent clip.
- Fixed alongside: the 30-minute recording cap used to stop the recorder and **silently discard the
  audio**. It now flows into the same transcribe path.

### Phase III — Single-chat workspace UI (on controllers + store) ✅ done

- Controllers (Workspace/Document/Conversation) wrapping `api.lex.*` + writing the store, provided
  alongside it by `LexStoreProvider` via `useLexControllers()`.
- `LexWorkspaceChat` is now the workspace (`/lex/workspaces/:id`): one agent chat + a documents
  side panel (upload/bulk/view/reference/delete) + page-pinnable reference chips + a
  generate-document action. The standalone timeline/chat pages it replaces are left in place.
- Chat memory: rolling summarization already exists; harden compression + surface it.

### Phase III bis — The case file in every prompt ✅ done

- **CASE FILE manifest** (`documents/case-file-manifest.ts` + `case-file.service.ts`): every
  document in the workspace, with its date, language, summary and a state word, injected into the
  chat turn and into the deep/adverse synthesis. The chat used to deny having a file the user could
  see on screen, because nothing in the prompt said which documents existed — only which chunks had
  been retrieved for that turn.
- Detail degrades by tier (`full → brief → index → names → filenames`) so **every document is named
  up to roughly 500**, which is past any real case file. Unlike the authority digest it never drops
  the tail: a list that stops at document 40 recreates the bug for document 41.
- **Not citable.** Summaries are derived text, so the block carries `#n` handles rather than `[n]`
  markers, which makes it unreachable by `extractCitedIndexes`. Deliberately excluded from artifact
  generation and from claim verification: the frozen evidence pack is a court-safety control.
- Compression: the fold's output ceiling went from 4000 to 12000 tokens (below that, a long summary
  could no longer be restated and the early case history eroded), the budget now uses the shared
  token estimate, the fold writes under a fixed append-only skeleton, and `lostFacts` measures any
  date or amount a fold dropped.

### Phase IV — Realtime

- Postgres NOTIFY triggers on `lex_*` + `PgListenerService` (LISTEN) + owner-scoped `@Sse`
  entity-stream; frontend SSE seam feeds `storeWriter.ingestServer(...)`.

## Feasibility note

Local Whisper + a 50-doc local pool + embeddings will not fit t3.small (2 GB). Offloading OCR
(Mistral) and transcription (whisper-1) keeps CPU/RAM on the box modest; bump to t3.medium for
headroom. Revisit SQS + a dedicated worker only if batch volume outgrows one box.
