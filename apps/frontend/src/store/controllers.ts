// Controllers wrap the existing api.lex.* transport and write results into the store via the
// StoreWriter (the only way to mutate state.entities). Pages read via useCollection/useEntity
// and call controllers to load/mutate. Chat token-streaming stays in lib/lexStream.ts.
import type {
  CreateTaskRequest,
  CreateWorkspaceRequest,
  LexParseStatus,
  UpdateAuthorityRequest
} from "@packages/types";
import { api } from "@/lib/api";
import { uploadAuthorities } from "@/lib/uploadAuthorities";
import { toUploadCandidates, uploadDocuments } from "@/lib/uploadDocuments";
import type { StoreWriter } from "./store-writer";

export class WorkspaceController {
  constructor(private writer: StoreWriter) {}

  async loadAll() {
    const { items } = await api.lex.workspaces.list();
    this.writer.upsertMany("lexWorkspaces", items);
    return items;
  }
  async load(id: string) {
    const { workspace } = await api.lex.workspaces.get(id);
    this.writer.upsert("lexWorkspaces", workspace);
    return workspace;
  }
  async create(data: CreateWorkspaceRequest) {
    const { workspace } = await api.lex.workspaces.create(data);
    this.writer.upsert("lexWorkspaces", workspace);
    return workspace;
  }
  async rename(id: string, name: string) {
    const { workspace } = await api.lex.workspaces.update(id, { name });
    this.writer.upsert("lexWorkspaces", workspace);
    return workspace;
  }
  async remove(id: string) {
    await api.lex.workspaces.delete(id);
    this.writer.remove("lexWorkspaces", id);
  }
}

export class DocumentController {
  constructor(private writer: StoreWriter) {}

  /**
   * replaceCollection, NOT upsertMany: the store must mirror this read, not accumulate across it.
   *
   * `list` now excludes archived documents, and an upsert-only load can never express a row the
   * server stopped returning — so an archived document stayed in the chat's documents panel as a
   * live, pinnable row whose pin retrieved nothing (RagService scopes pins to lifecycle 'active').
   * Deletions from another tab had the same shape of problem.
   *
   * Sound because documents are only ever loaded one workspace at a time; a view that needed two
   * workspaces' documents resident at once would need a workspace-scoped prune instead.
   */
  async loadForWorkspace(workspaceId: string) {
    const { items } = await api.lex.documents.list(workspaceId);
    this.writer.replaceCollection("lexDocuments", items);
    return items;
  }
  async refresh(id: string) {
    const { document } = await api.lex.documents.get(id);
    this.writer.upsert("lexDocuments", document);
    return document;
  }
  /**
   * Uploads files straight to S3 (presign → PUT → confirm) and folds the resulting documents
   * into the store. Accepts folder drops: paths are flattened into the filename.
   */
  async upload(
    workspaceId: string,
    files: File[],
    onProgress?: (done: number, total: number) => void
  ) {
    const outcome = await uploadDocuments(
      workspaceId,
      toUploadCandidates(files),
      onProgress
    );
    this.writer.upsertMany("lexDocuments", outcome.documents);
    return outcome;
  }
  async remove(id: string) {
    await api.lex.documents.delete(id);
    this.writer.remove("lexDocuments", id);
  }
  async removeMany(ids: string[]) {
    const result = await api.lex.documents.bulkDelete(ids);
    for (const id of ids) this.writer.remove("lexDocuments", id);
    return result;
  }
  /** Discards stuck/unparseable/duplicate documents, then reloads the workspace's list. */
  async discard(workspaceId: string, statuses: LexParseStatus[]) {
    const result = await api.lex.documents.discard(workspaceId, statuses);
    await this.loadForWorkspace(workspaceId);
    return result;
  }
  async retry(id: string) {
    const { document } = await api.lex.documents.retry(id);
    this.writer.upsert("lexDocuments", document);
    return document;
  }

  /** Voice-note transcript — a sub-resource, so it is returned, not stored in entities. */
  async transcript(id: string) {
    const { transcript } = await api.lex.documents.transcript(id);
    return transcript;
  }
  /** Saving a corrected transcript re-indexes the document, so refresh its row too. */
  async saveTranscript(id: string, text: string) {
    const { transcript } = await api.lex.documents.saveTranscript(id, text);
    await this.refresh(id);
    return transcript;
  }
  async retranscribe(id: string) {
    const { document } = await api.lex.documents.retranscribe(id);
    this.writer.upsert("lexDocuments", document);
    return document;
  }
}

export class ConversationController {
  constructor(private writer: StoreWriter) {}

  async loadForWorkspace(workspaceId: string) {
    const { items } = await api.lex.conversations.list(workspaceId);
    this.writer.upsertMany("lexConversations", items);
    return items;
  }
  async create(workspaceId: string, title?: string) {
    const { conversation } = await api.lex.conversations.create(workspaceId, {
      title
    });
    this.writer.upsert("lexConversations", conversation);
    return conversation;
  }
  /**
   * Loads a page of messages into the store. Returns `hasMore` so the page can offer "load
   * earlier" without guessing. UPSERT_MANY merges, so paging backwards simply accumulates —
   * no ordering or de-duplication work is needed on the client.
   */
  async loadMessages(conversationId: string, beforeSeq?: number) {
    const { items, hasMore } = await api.lex.conversations.messages(
      conversationId,
      beforeSeq === undefined ? undefined : { beforeSeq }
    );
    this.writer.upsertMany("lexMessages", items);
    return { items, hasMore };
  }
}

/** Authorities: uploaded law, shared across every workspace this user owns. */
export class AuthorityController {
  constructor(private writer: StoreWriter) {}

  async loadAll() {
    const { items } = await api.lex.authorities.list();
    this.writer.replaceCollection("lexAuthorities", items);
    return items;
  }
  async upload(files: File[]) {
    const outcome = await uploadAuthorities(files);
    this.writer.upsertMany("lexAuthorities", outcome.authorities);
    return outcome;
  }
  async update(id: string, data: UpdateAuthorityRequest) {
    const { authority } = await api.lex.authorities.update(id, data);
    this.writer.upsert("lexAuthorities", authority);
    return authority;
  }
  /** Toggling `enabled` is the switch for "is this law in every prompt". */
  async setEnabled(id: string, enabled: boolean) {
    return this.update(id, { enabled });
  }
  async retry(id: string) {
    const { authority } = await api.lex.authorities.retry(id);
    this.writer.upsert("lexAuthorities", authority);
    return authority;
  }
  async remove(id: string) {
    await api.lex.authorities.delete(id);
    this.writer.remove("lexAuthorities", id);
  }
  /** The digest is a sub-resource (large), so it is returned rather than stored. */
  async digest(id: string) {
    const { digest } = await api.lex.authorities.digest(id);
    return digest;
  }
}

/** Long-running background assessments over a whole case file. */
export class TaskController {
  constructor(private writer: StoreWriter) {}

  async loadForWorkspace(workspaceId: string) {
    const { items } = await api.lex.tasks.list(workspaceId);
    this.writer.upsertMany("lexTasks", items);
    return items;
  }
  async create(data: CreateTaskRequest) {
    const { task } = await api.lex.tasks.create(data);
    this.writer.upsert("lexTasks", task);
    return task;
  }
  async refresh(id: string) {
    const { task } = await api.lex.tasks.get(id);
    this.writer.upsert("lexTasks", task);
    return task;
  }
  async cancel(id: string) {
    const { task } = await api.lex.tasks.cancel(id);
    this.writer.upsert("lexTasks", task);
    return task;
  }
}

export interface LexControllers {
  workspaces: WorkspaceController;
  documents: DocumentController;
  conversations: ConversationController;
  authorities: AuthorityController;
  tasks: TaskController;
}

export function createControllers(writer: StoreWriter): LexControllers {
  return {
    workspaces: new WorkspaceController(writer),
    documents: new DocumentController(writer),
    conversations: new ConversationController(writer),
    authorities: new AuthorityController(writer),
    tasks: new TaskController(writer)
  };
}
