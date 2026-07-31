import type {
  LexArtifact,
  LexArtifactVersion,
  LexAuthority,
  LexConversation,
  LexDocument,
  LexEntityCollection,
  LexMessage,
  LexTask,
  LexWorkspace
} from "@packages/types";

/** Normalized store: one Record<id, entity> per Lex collection. */
export interface LexEntitiesState {
  lexWorkspaces: Record<string, LexWorkspace>;
  lexDocuments: Record<string, LexDocument>;
  lexConversations: Record<string, LexConversation>;
  lexMessages: Record<string, LexMessage>;
  lexArtifacts: Record<string, LexArtifact>;
  lexArtifactVersions: Record<string, LexArtifactVersion>;
  lexAuthorities: Record<string, LexAuthority>;
  lexTasks: Record<string, LexTask>;
}

/** Maps a collection name to its entity type (drives useCollection/useEntity typing). */
export interface LexEntityTypeMap {
  lexWorkspaces: LexWorkspace;
  lexDocuments: LexDocument;
  lexConversations: LexConversation;
  lexMessages: LexMessage;
  lexArtifacts: LexArtifact;
  lexArtifactVersions: LexArtifactVersion;
  lexAuthorities: LexAuthority;
  lexTasks: LexTask;
}

export type LexEntityType = keyof LexEntityTypeMap;

export const LEX_COLLECTIONS: LexEntityCollection[] = [
  "lexWorkspaces",
  "lexDocuments",
  "lexConversations",
  "lexMessages",
  "lexArtifacts",
  "lexArtifactVersions",
  "lexAuthorities",
  "lexTasks"
];

/** A fresh, empty entities state (every collection present and empty). */
export function emptyEntitiesState(): LexEntitiesState {
  const state = {} as Record<LexEntityCollection, Record<string, unknown>>;
  for (const collection of LEX_COLLECTIONS) state[collection] = {};
  return state as unknown as LexEntitiesState;
}
