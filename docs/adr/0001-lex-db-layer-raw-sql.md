# ADR 0001 — Lex uses raw SQL (pg + node-pg-migrate), not Prisma/Drizzle

Status: accepted (2026-07-30)

## Context

The Lex legal-RAG feature runs on PostgreSQL + **pgvector**: `halfvec(3072)` embeddings,
an **HNSW** index (`halfvec_cosine_ops`), FR/NL `tsvector` GIN full-text, cosine `<=>`
similarity, and **Reciprocal Rank Fusion**. remorai (the sibling project) uses Prisma, so
"consistency" argued for Prisma; the alternative ORMs are Prisma and Drizzle, vs the current
raw `pg` + `node-pg-migrate` setup.

## Decision

**Keep raw SQL for Lex.** Retrieval is the heart of the product and lives exactly where the
ORMs are weakest:

- **Prisma** (as of early 2026) has no native vector type for self-hosted RDS — vectors are
  `Unsupported()`/`$queryRaw` with hand-written result types — and `prisma migrate` drops
  HNSW indexes (prisma#28414/#21850). We'd stay raw for retrieval *and* pay ORM overhead on
  trivial CRUD.
- **Drizzle** can model `halfvec`/`hnsw`, but won't create the extension, has emitted HNSW
  DDL without the operator class, and introduces a **second source of truth** (`$inferSelect`)
  that would surface the `embedding` column we intentionally hide (see the entities rule).
- **Raw** keeps `@packages/types` the single wire-shaped source of truth with zero
  reconciliation tax, and the retrieval SQL is already correct and fast.

Consistency with remorai is real but low-weight: separate repos, different Postgres topologies,
no shared backend package, and remorai's Prisma bet was made against zero pgvector.

## Consequences

- Persistence rows stay as private snake_case `Row` interfaces inside each backend service,
  mapped to the exposed `@packages/types` entities. They are never exported (no DB-shape leak).
- If typed-CRUD ergonomics are ever wanted, **Kysely** (query builder, no codegen, no second
  schema) is the only switch worth considering for this pgvector workload — not Prisma/Drizzle.
- Optional hardening: a generic typed query helper on `PgService` and Zod-parsing at the
  `Row → entity` mapper boundary so persistence and exposed shapes can't silently drift.
- Revisit only if native (non-preview) `halfvec`+HNSW ships in an ORM AND cross-product
  consistency becomes an explicit mandate.
