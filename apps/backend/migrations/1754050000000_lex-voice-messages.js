// A spoken chat turn. The transcript IS the message's own content — the same column a typed turn
// writes to — and this table holds the audio behind it, so the bubble can be played back and what
// speech-to-text actually heard can be compared with what was sent.
//
// Its own table rather than columns on lex_messages, because the audio exists BEFORE the message:
// the browser uploads it and asks for a transcript while the user may still be correcting the text,
// and the message row is only written when she sends. A row with message_id NULL is that draft, and
// it is also the only record that an object was uploaded, which is what makes an abandoned
// recording reapable.
//
// NOT lex_messages.origin. That column protects assessment turns from context eviction, and a third
// value there is one change away from pinning every spoken turn in the prompt forever.
//
// document_id is the promote path. Until this feature, every recording became an indexed pièce, so
// a dictated FACT was retrievable and citable. A chat turn must not be citable as evidence — a
// question is not a source — but losing the ability to file one would be a regression, so the user
// can copy a recording into a document explicitly. Null on every other row.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE lex_message_audio (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_email      TEXT NOT NULL,
      workspace_id     UUID NOT NULL REFERENCES lex_workspaces(id) ON DELETE CASCADE,
      conversation_id  UUID NOT NULL REFERENCES lex_conversations(id) ON DELETE CASCADE,
      -- Null until the turn is sent. UNIQUE, and the uniqueness is what stops one draft being bound
      -- to two turns by a double-tapped send. It also indexes the message-page read, so no separate
      -- index on message_id is needed.
      message_id       UUID UNIQUE REFERENCES lex_messages(id) ON DELETE CASCADE,
      s3_key           TEXT NOT NULL,
      s3_version_id    TEXT,
      content_type     TEXT NOT NULL,
      size_bytes       BIGINT,
      duration_seconds INT,
      -- What speech-to-text returned, verbatim. The message content may have been corrected before
      -- sending, and both are worth keeping: one is what was said, the other is what was asked.
      transcript       TEXT,
      transcribe_error TEXT,
      -- Set when the user files this recording as a pièce.
      document_id      UUID REFERENCES lex_documents(id) ON DELETE SET NULL,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Unsent drafts, oldest first, for a future reaper. Partial, because a sent row is never swept
    -- and the overwhelming majority of rows are sent.
    CREATE INDEX idx_lex_message_audio_unbound
      ON lex_message_audio (created_at)
      WHERE message_id IS NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS lex_message_audio;`);
};
