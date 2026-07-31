# Campaign Forge → Super App: "Lex" Legal-RAG Architecture

> Status: proposed architecture (design only, no code yet).
> Produced from a full codebase mapping + an 8-specialist / 3-red-team design pass.

## 1. North star

The existing admin UI becomes a two-app **Command Center**:

- **Campaigns** — the current email tool (untouched).
- **Lex** — a legal-document RAG app for Belgian-law court files.

For the single admin tenant (mom + you), Lex turns a court case into a long-lived
**workspace** that accumulates legal PDFs/DOCX for years, keeps them navigable via an
auto-maintained **document timeline** + layered summaries, and lets the user hold
ChatGPT-style **conversations** that survive far beyond any context window. From those
conversations the user generates court-usable **artifacts** (memos/submissions) in which
**every factual claim carries a machine-verified citation** back to an exact source span.

It is built entirely **next to** the existing code — new NestJS modules under
`apps/backend/src/lex/*`, new frontend routes, new `@packages/types` entries, a new CDK
data stack — on one `t3.small` EC2 backed by a single RDS PostgreSQL+pgvector instance.

**Non-negotiable rule:** adding Lex must never take the live Campaigns app down.
Citation faithfulness, long-context fidelity over years, and coexistence safety are
treated as **correctness requirements**, not features.

## 2. Locked decisions (from product owner)

| Decision | Choice |
|---|---|
| Users | Single-tenant now (reuse credential JWT), `users` table + `owner_email` scoping so multi-user is a later migration, not a rewrite |
| Database | One AWS RDS **PostgreSQL** (small) + **pgvector**. No Aurora, no separate vector store, no DynamoDB for Lex |
| Compute | Add Lex as NestJS modules to the **existing EC2**, bumped `t2.micro → t3.small`. In-process ingestion worker now; SQS-ready seam for later |
| Storage | New **dedicated** S3 bucket for legal docs (versioned, SSE, Object Lock). Never the campaign bucket |
| AI | **OpenAI** — GPT for chat/generation + `text-embedding-3-large` (3072 dims). Standard API accepted. Key in **Secrets Manager** |
| Build | Full architecture upfront, sequenced into phases |

## 3. Monorepo layout (what gets added / touched)

```
apps/backend/
  migrations/                       # NEW node-pg-migrate SQL (CREATE EXTENSION vector; lex_* tables; HNSW halfvec index)
  src/
    main.ts                         # MODIFY: bootstrap() try/catch + fatal log + exit(1)
    app.module.ts                   # MODIFY: register LexModule gated on LEX_ENABLED
    config/config.service.ts        # MODIFY: Lex keys .optional()/.default(); LEX_ENABLED=false; fix AWS_REGION → eu-north-1
    auth/admin.guard.ts             # MODIFY: req.user = verify(...) + ADMIN_CREDENTIALS allowlist assert
    auth/current-user.decorator.ts  # NEW: @CurrentUser()
    shared/
      pg.service.ts                 # NEW: lazy pg Pool (max 5-8), withTransaction, halfvec type reg
      secrets.service.ts            # NEW: lazy Secrets Manager fetch+cache
      openai.service.ts             # NEW: embed / chat / streamChat / rerank
      lex-s3.service.ts             # NEW: bound to LEX_DOCUMENTS_BUCKET
      shared.module.ts              # MODIFY: add the 4 services (all inert until LEX_ENABLED)
    lex/
      lex.module.ts                 # NEW aggregator
      ai/rag.service.ts             # NEW: hybrid retrieval + context assembly + entailment checks
      workspaces/                   # NEW
      documents/                    # NEW: upload + ingestion.worker + parser + chunker
      timeline/                     # NEW: canonical date + summaries + case_state
      conversations/                # NEW: SSE chat + context-assembler + summarization
      artifacts/                    # NEW: generation + verification + export
apps/frontend/src/
  App.tsx                           # MODIFY: /lex/* routes under AdminLayout
  lib/api.ts                        # MODIFY: api.lex.* namespace
  lib/lexStream.ts                  # NEW: SSE helper (fetch + ReadableStream)
  components/admin/AdminSidebar.tsx # MODIFY: Campaigns ⇆ Lex app switcher
  components/lex/CitationMark.ts    # NEW: Tiptap Mark preserving data-claim-id
  pages/lex/*                       # NEW: Workspaces, WorkspaceDetail, LexTimeline, Conversation, Artifacts, ArtifactEditor
  i18n/translations.ts             # MODIFY: FR/NL Lex strings
packages/types/src/
  entities/lex/*.ts                 # NEW domain types
  dto/lex/*.ts                      # NEW Zod DTOs + LexStreamEvent union
infrastructure/
  bin/app.ts                        # MODIFY: wire NetworkStack + LexDataStack
  lib/network-stack.ts              # NEW: owns VPC + backend SG (breaks Backend↔LexData cycle)
  lib/lex-data-stack.ts             # NEW: RDS PG16+pgvector (RETAIN), docs bucket, DB+OpenAI secrets, 5432 ingress
  lib/backend-stack.ts              # MODIFY: consume NetworkStack; t3.small; grants; S3 gateway endpoint
scripts/setup-ssm-params.sh         # MODIFY: add Lex keys (+ backfill missing S3_BUCKET) — the REAL config surface
scripts/ec2-bootstrap.sh            # MODIFY: emit Lex keys; nginx SSE location (proxy_buffering off)
.github/workflows/cd-deploy.yml     # MODIFY: ssm_get Lex keys; make health check BLOCKING w/ rollback
```

## 4. End-to-end data flow (one court PDF)

1. **Upload** — `api.lex.documents.upload()` → `POST /api/admin/lex/workspaces/:id/documents`.
   `AdminGuard` verifies JWT and now attaches `req.user={email}`; `@CurrentUser()` gives
   `ownerEmail`. Service upserts the `lex_users` row, computes SHA-256 (dedupe via
   `UNIQUE(workspace_id, sha256)`), streams bytes to the versioned Lex bucket, and in **one
   transaction** inserts `lex_documents(status='uploaded')` + a `lex_ingestion_jobs(queued)`
   row. Returns `202`.
2. **Parse → chunk → embed** — `IngestionWorker` claims the job with
   `SELECT ... FOR UPDATE SKIP LOCKED` (concurrency 1). Parser uses `unpdf` (per-page,
   in a **worker_thread** so PDF parsing never blocks the Campaigns event loop) + `mammoth`
   for DOCX; scanned pages → `needs_ocr`. Chunker emits ~1000-token page-bounded chunks
   each carrying `page_number` + `char_start`/`char_end`, **validated by re-extracting the
   substring** (rejects offset drift). Embeddings batch ≤96/req against
   `text-embedding-3-large` with SES-style backoff → stored as `halfvec(3072)`.
3. **Summarize + timeline** — per-document summary + candidate dates → pick `canonical_date`
   → fold into workspace `lex_case_state`; `status='ready'`. Frontend polls
   `/documents/:id/status` and renders the doc on the timeline rail.
4. **Chat / retrieve** — `api.lex.conversations.stream()` POSTs to the SSE endpoint.
   Service inserts a `pending` assistant message, then `ContextAssembler` builds:
   system prompt + citation-anchored `case_memory` + last-N verbatim turns + **hybrid
   retrieval** (one SQL fusing pgvector cosine HNSW + FR/NL `tsvector` FTS via RRF,
   hard-scoped by `owner_email + workspace_id` and `lifecycle_state='active'`, optional
   rerank). A **non-evictable retrieval-token floor** guarantees grounding is never squeezed
   to zero. `streamChat` emits `token` events; grounded claims emit `citation` events with
   `chunkId + documentId + page + char span`; the finalize transaction writes the full
   message + token/cost counts idempotently.
5. **Artifact** — `plan → retrieve (frozen document-only evidence pack) → generate (JSON
   schema forces each claim to cite a pack chunkId or declare `unsupported`) → verify`.
   Verification runs an **independent judge** + a **deterministic backstop**: the judge's
   quote must appear verbatim **at the stored `char_start/char_end`** of the cited chunk, and
   an entailment check confirms the quote actually supports the claim. A version is
   `verified` only if every claim has a fresh verdict and zero are unsupported/contradicted.
   Body stored as **ProseMirror JSON** with `CitationMark(data-claim-id)`; saves diff
   claimIds against the prior version and refuse to silently drop citations.
6. **Court export** — after a **mandatory human sign-off**, `ExportService` renders the
   ProseMirror JSON (never an HTML round-trip) to PDF (Puppeteer, concurrency 1) / DOCX,
   building footnotes + References from the same citation rows. Verified-only is a
   server-side hard block re-checked at export; draft mode stamps an un-removable
   "DRAFT — NOT FOR FILING" watermark.

## 5. Data model (PostgreSQL + pgvector)

Tables (all `owner_email`-scoped on top-level rows; children scope via parent FK):
`lex_users`, `lex_workspaces`, `lex_documents`, `lex_document_chunks`,
`lex_document_summaries`, `lex_conversations`, `lex_messages`,
`lex_conversation_summaries`, `lex_citations`, `lex_artifacts` (+ `lex_artifact_versions`),
`lex_ingestion_jobs`.

**Critical vector decision:** `text-embedding-3-large` is **3072 dims**, but pgvector's
HNSW/IVFFlat indexes **cannot index the `vector` type above 2000 dims**. Store embeddings as
**`halfvec(3072)`** and build **`HNSW ... halfvec_cosine_ops`** (pgvector ≥ 0.7.0 supports
`halfvec` up to 4000 dims). HNSW over IVFFlat because the corpus grows incrementally over
years (no representative-data-at-build-time requirement, no reclustering). Lock embedding
dimensionality immutable per workspace — changing it means re-embedding everything.

**Migrations:** `node-pg-migrate` (raw SQL) driven off the same `pg` Pool — not Prisma/Drizzle,
because the repo's type source of truth is hand-written `@packages/types` + Zod, and
`halfvec`/HNSW DDL is first-class in SQL but awkward/unsupported in ORM schema DSLs.

## 6. REST API surface (all under `/api/admin/lex/*`, `@UseGuards(AdminGuard)`)

- Workspaces: `GET/POST /workspaces`, `GET/PATCH/DELETE /workspaces/:id`
- Documents: `GET /workspaces/:id/documents`, `GET /workspaces/:id/timeline`,
  `POST /workspaces/:id/documents/upload`, `GET /documents/:id`,
  `GET /documents/:id/download`, `GET /documents/:id/status`,
  `POST /documents/:id/resummarize`, `DELETE /documents/:id`
- Conversations: `GET/POST /workspaces/:id/conversations`,
  `GET/PATCH/DELETE /conversations/:id`, `GET /conversations/:id/messages`,
  `POST /conversations/:id/messages/stream` (SSE)
- Artifacts: `GET /workspaces/:id/artifacts`, `POST /artifacts/generate`,
  `GET/PATCH/DELETE /artifacts/:id`, `GET /artifacts/:id/export`

**SSE contract:** `{"type":"token","delta":"…"}` … `{"type":"citations","citations":[…]}` …
`{"type":"done","messageId":"…"}`.

## 7. Court-safety mechanisms (the product crux)

The red-team's job was to make a court artifact cite something false. The controls that survived:

- **Provenance threaded from ingestion, never reconstructed** — `chunkId + page + char
  offset` persisted at chunk time and carried to every citation.
- **Frozen evidence pack** at generation — the model can only cite chunk IDs in the pack, or
  declare a claim `unsupported`. Out-of-pack IDs are rejected.
- **Independent verify stage** — a separate judge + a **deterministic verbatim-at-offset**
  backstop (quote must match at the stored offsets, not merely exist somewhere in the doc —
  prevents a twice-occurring quote deep-linking to the wrong page).
- **Citation-edit survival** — body is ProseMirror JSON with a `CitationMark`; a save-time
  server invariant rejects/flags any save that drops a claimId. **The existing Tiptap editor
  round-trips through `getHTML()`, which silently strips unknown mark attributes** — Lex must
  use `getJSON()` and never the HTML path.
- **Supersession-aware retrieval** — `lifecycle_state='active'` filter so a superseded/
  withdrawn filing is never cited as current; `chunk_content_hash` staleness detection.
- **Semantic-fidelity (NLI) invariant on summaries** — the "keep the same refs" rule guards
  ref *presence*; an NLI check guards that the summary doesn't paraphrase "admitted liability"
  into "contested the claim" under a still-valid citation.
- **Mandatory human sign-off** — "verified" means "a judge agreed + a quote matched at
  offset," which is necessary but not sufficient; a human gate sits between verified and
  exportable-for-filing.

## 8. Long-context strategy (conversations that last years)

Postgres (not the context window) is authoritative. Each turn assembles a bounded window from:
system prompt + a durable, citation-anchored **case_memory** (running facts, with a
never-dropped `uncorroborated` section + user-pin so chat-only facts don't vanish at
checkpoint) + last-N verbatim turns + retrieved doc chunks (with a reserved token floor).
Rolling `conversation_summaries` checkpoint older turns; a canonical-date edit publishes a
`needs_rederive` event to dependent summaries; archived docs keep their **summary + key-fact
embeddings hot** (archival sheds cost, not discoverability).

## 9. Coexistence safety — the #1 gate (verified against the repo)

Adding Lex to the same process/EC2 can silently crash Campaigns. Verified facts:

- [main.ts:20](../apps/backend/src/main.ts#L20): `bootstrap()` has **no `.catch()`** → a config
  throw exits the process.
- [config.service.ts:27](../apps/backend/src/config/config.service.ts#L27): `schema.parse(process.env)`
  in the constructor → any new **required** key hard-fails startup.
- [config.service.ts:6](../apps/backend/src/config/config.service.ts#L6): `AWS_REGION` defaults to
  `eu-west-1` but prod runs in **`eu-north-1`** ([cd-deploy.yml:37](../.github/workflows/cd-deploy.yml#L37)).
- Real config surface = **SSM → CI-rewritten `.env` heredoc**
  ([cd-deploy.yml:215-232](../.github/workflows/cd-deploy.yml#L215-L232)) at
  `/home/ec2-user/campaign-forge/apps/backend/.env`, using **static IAM-user keys** — so
  Secrets Manager grants must go to that **IAM user** (or switch the app to the instance role),
  not only the EC2 role.
- Deploy does `pm2 restart` ([:245](../.github/workflows/cd-deploy.yml#L245)) then a
  **non-blocking** health check (`curl -f … || echo`, [:253](../.github/workflows/cd-deploy.yml#L253))
  → a crash-loop reports as a **successful deploy**.

**Mitigations (Phase 0, before any Lex feature code):**
1. `main.ts` bootstrap try/catch + structured fatal log + explicit `exit(1)`.
2. All Lex config keys `.optional()/.default()`, `LEX_ENABLED=false`, and Lex providers
   **lazy-init** (no boot-time parse/I/O) so a Lex misconfig can never abort `AppModule`.
3. CI health check made **blocking** (retry loop, drop `|| echo`) with a `pm2` rollback.
4. A CI test asserting the app **boots with only the legacy campaign env vars set**.
5. Route Lex keys through `setup-ssm-params.sh` + the `cd-deploy.yml` `ssm_get` heredoc +
   `ec2-bootstrap.sh` — the real surface. Backfill the currently-missing `S3_BUCKET` SSM param.
6. Fix `AWS_REGION` default to `eu-north-1`; grant Secrets/RDS/S3 to the IAM user.
7. Extract a `NetworkStack` (VPC + backend SG) to break the Backend↔LexData CDK cycle;
   `cdk diff` must prove **no VPC/SG/EC2 replacement**.

## 10. Phased build plan

- **Phase 0 — Coexistence safety net & seams** (no user feature): items 1-7 above + the auth
  `@CurrentUser()` change + register (inert) `PgService`/`SecretsService`/`OpenAiService`/`LexS3Service`.
- **Phase 1 — Infra + schema** (flag off): `NetworkStack`, `LexDataStack` (RDS PG16+pgvector
  RETAIN, docs bucket, secrets, 5432 ingress, S3 gateway endpoint), `t3.small` bump,
  `node-pg-migrate` migrations, `@packages/types` + `api.lex.*` + `lexStream.ts` scaffolding.
- **Phase 2 — Workspaces + ingestion + timeline** (first shippable value): create a
  workspace, upload docs, watch them parse/chunk/embed/summarize, see the timeline; enable
  `LEX_ENABLED`.
- **Phase 3 — Retrieval + conversations**: hybrid RAG + SSE streaming chat with inline
  citations + multi-year memory.
- **Phase 4 — Artifacts + court export**: grounded generation + verify + citation-preserving
  editing + human sign-off + PDF/DOCX export; per-workspace golden-question eval harness.
- **Phase 5 — Hardening & scale**: swap in-process queue → SQS if load grows; Textract OCR
  path; cost/latency dashboards; revisit PITR/Object Lock retention + secret rotation.

## 11. First PRs

1. **Phase 0 — safety net:** `main.ts` try/catch + exit; Lex keys `.optional()/.default()`;
   `LEX_ENABLED=false`; fix `AWS_REGION → eu-north-1`; CI boot-with-legacy-env test.
2. **Phase 0 — deploy surface + health gate:** update `setup-ssm-params.sh` (+ backfill
   `S3_BUCKET`), `cd-deploy.yml` `ssm_get`, `ec2-bootstrap.sh`; blocking health check +
   `pm2` rollback; dedicated nginx SSE location block.
3. **Phase 0 — auth + shared services:** `AdminGuard` attaches `req.user` + allowlist assert;
   `@CurrentUser()`; add `PgService`/`SecretsService`/`OpenAiService`/`LexS3Service` (all lazy,
   inert until `LEX_ENABLED`).
4. **Phase 1 — infra:** `NetworkStack` + `LexDataStack`; `t3.small`; IAM grants to the IAM
   user; include `cdk diff` proving no VPC/SG/EC2 replacement.
5. **Phase 1 — schema + types:** migrations (pgvector extension, `lex_*` tables, `halfvec(3072)`
   HNSW index, FR/NL `tsvector` GIN index); `@packages/types` + client scaffolding.

## 12. Top risks

| Risk | Mitigation |
|---|---|
| Lex deploy crashes live Campaigns (config throw + no catch + non-blocking health check) | Phase 0 gate: try/catch, optional keys + `LEX_ENABLED`, lazy init, blocking health check + rollback |
| Editing wrong config surface (real surface is SSM, region is `eu-north-1`, static IAM-user keys) | Route via `setup-ssm-params.sh`/`ssm_get`/`ec2-bootstrap.sh`; fix region; grant IAM user |
| Court artifact cites something false | Frozen evidence pack + verify stage + verbatim-at-offset + supersession filter + NLI fidelity + human sign-off |
| pgvector can't ANN-index 3072 dims | `halfvec(3072)` + HNSW `halfvec_cosine_ops`; verify pgvector ≥ 0.7.0 |
| `t3.small` contention (parse/embed/export vs Campaigns API) | worker_thread parse @ concurrency 1, serialized queue off the SSE path, Puppeteer @ 1, bounded pg pool (5-8) |
| Long-context loses/mis-times facts | never-dropped `uncorroborated` memory + pins; keep archived summaries hot; canonical-date edits trigger re-derive |
| CDK circular dependency (Backend↔LexData) | Extract `NetworkStack`; `cdk diff` must show no VPC/SG/EC2 replacement |
