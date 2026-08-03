import type {
  Campaign,
  CampaignAttachment,
  Contact,
  ContactGroup,
  CreateConversationRequest,
  CreateTaskRequest,
  CreateWorkspaceRequest,
  LexArchivedScope,
  LexArtifact,
  LexArtifactVersion,
  LexAuthority,
  LexAuthorityDigest,
  LexAuthorityUploadSlot,
  LexCitationEvent,
  LexConversation,
  LexDocument,
  LexLanguage,
  LexLifecycleChange,
  LexMessage,
  LexPageIndexBackfill,
  LexPageIndexStatus,
  LexParseStatus,
  LexStoryPayload,
  LexTask,
  LexTranscript,
  LexUploadSlot,
  LexUserSettings,
  LexWorkspace,
  PresignAuthorityRequest,
  PresignUploadRequest,
  SaveArtifactRequest,
  UpdateAuthorityRequest,
  UpdateWorkspaceRequest
} from "@packages/types";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001/api";
const TOKEN_KEY = "admin_token";

function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

function handleUnauthorized() {
  sessionStorage.removeItem(TOKEN_KEY);
  window.location.href = "/login";
}

async function parseResponse<T>(res: Response): Promise<T> {
  const data = await res.json();
  if (!res.ok) {
    const msg = Array.isArray(data.message)
      ? data.message.join(", ")
      : data.message || data.error || `Request failed: ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

async function request<T>(path: string, opts?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts?.headers as Record<string, string>)
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });

  if (res.status === 401) {
    handleUnauthorized();
    throw new Error("Unauthorized");
  }

  return parseResponse<T>(res);
}

async function requestText(path: string): Promise<string> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { headers });
  if (res.status === 401) {
    handleUnauthorized();
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    let msg = `Request failed: ${res.status}`;
    try {
      const data = await res.json();
      msg = data.message || data.error || msg;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(msg);
  }
  return res.text();
}

async function uploadRequest<T>(path: string, file: File): Promise<T> {
  const token = getToken();
  const form = new FormData();
  form.append("file", file);

  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers,
    body: form
  });

  if (res.status === 401) {
    handleUnauthorized();
    throw new Error("Unauthorized");
  }

  return parseResponse<T>(res);
}

async function publicRequest<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts
  });
  return parseResponse<T>(res);
}

export const api = {
  campaigns: {
    list() {
      return request<{
        items: Campaign[];
        cursor: string | null;
        count: number;
      }>("/admin/campaigns");
    },
    get(id: string) {
      return request<{ ok: true; campaign: Campaign }>(
        `/admin/campaigns/${id}`
      );
    },
    create(data: {
      name: string;
      subject: string;
      html: string;
      targetGroups?: string[];
      attachments?: CampaignAttachment[];
    }) {
      return request<{ ok: true; campaign: Campaign }>("/admin/campaigns", {
        method: "POST",
        body: JSON.stringify(data)
      });
    },
    update(
      id: string,
      data: Partial<{
        name: string;
        subject: string;
        html: string;
        targetGroups: string[];
        attachments: CampaignAttachment[];
      }>
    ) {
      return request<{ ok: true; campaign: Campaign }>(
        `/admin/campaigns/${id}`,
        {
          method: "PATCH",
          body: JSON.stringify(data)
        }
      );
    },
    upload(file: File) {
      return uploadRequest<{
        ok: true;
        key: string;
        url: string;
        filename: string;
        contentType: string;
        size: number;
      }>("/admin/campaigns/upload", file);
    },
    delete(id: string) {
      return request<{ ok: true }>(`/admin/campaigns/${id}`, {
        method: "DELETE"
      });
    },
    send(id: string) {
      return request<{ ok: true; queued: true; recipientCount: number }>(
        `/admin/campaigns/${id}/send`,
        {
          method: "POST"
        }
      );
    },
    testSendById(id: string, email: string) {
      return request<{ ok: true; message: string }>(
        `/admin/campaigns/${id}/test`,
        {
          method: "POST",
          body: JSON.stringify({ email })
        }
      );
    },
    testSend(email: string, subject: string, html: string) {
      return request<{ ok: true; message: string }>(
        "/admin/campaigns/test-send",
        {
          method: "POST",
          body: JSON.stringify({ email, subject, html })
        }
      );
    }
  },
  contacts: {
    stats() {
      return request<{
        total: number;
        subscribed: number;
        unsubscribed: number;
      }>("/admin/contacts/stats");
    },
    list(params?: {
      status?: string;
      q?: string;
      limit?: number;
      cursor?: string;
    }) {
      const qs = new URLSearchParams();
      if (params?.status) qs.set("status", params.status);
      if (params?.q) qs.set("q", params.q);
      if (params?.limit) qs.set("limit", String(params.limit));
      if (params?.cursor) qs.set("cursor", params.cursor);
      const query = qs.toString();
      return request<{
        items: Contact[];
        cursor: string | null;
        count: number;
      }>(`/admin/contacts${query ? `?${query}` : ""}`);
    },
    create(data: Partial<Contact> & { email: string }) {
      return request<{ ok: true; contact: Contact }>("/admin/contacts", {
        method: "POST",
        body: JSON.stringify(data)
      });
    },
    update(emailLower: string, data: Partial<Contact>) {
      return request<{ ok: true; contact: Contact }>(
        `/admin/contacts/${encodeURIComponent(emailLower)}`,
        {
          method: "PATCH",
          body: JSON.stringify(data)
        }
      );
    },
    delete(emailLower: string) {
      return request<{ ok: true }>(
        `/admin/contacts/${encodeURIComponent(emailLower)}`,
        { method: "DELETE" }
      );
    },
    importContacts(contacts: Partial<Contact>[]) {
      return request<{
        ok: true;
        imported: number;
        skipped: number;
        errors: unknown[];
      }>("/admin/contacts/import", {
        method: "POST",
        body: JSON.stringify({ contacts })
      });
    }
  },
  groups: {
    list() {
      return request<ContactGroup[]>("/admin/groups");
    },
    create(data: { name: string; color: string }) {
      return request<ContactGroup>("/admin/groups", {
        method: "POST",
        body: JSON.stringify(data)
      });
    },
    update(id: string, data: { name?: string; color?: string }) {
      return request<void>(`/admin/groups/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data)
      });
    },
    delete(id: string) {
      return request<void>(`/admin/groups/${id}`, { method: "DELETE" });
    }
  },
  public: {
    subscribe(email: string, firstName?: string, lastName?: string) {
      return publicRequest<{ ok: true; message: string }>("/public/subscribe", {
        method: "POST",
        body: JSON.stringify({ email, firstName, lastName })
      });
    }
  },
  // Lex legal-RAG app. Chat streaming lives in ./lexStream.ts (this client is Promise-only).
  lex: {
    settings: {
      get() {
        return request<{ settings: LexUserSettings }>("/admin/lex/settings");
      },
      update(language: LexLanguage) {
        return request<{ settings: LexUserSettings }>("/admin/lex/settings", {
          method: "PATCH",
          body: JSON.stringify({ language })
        });
      }
    },
    /**
     * Authorities: uploaded law, owner-scoped (no workspace in the path) because a code of law
     * applies to every case. Uploads use the same presign → PUT → complete sequence as documents.
     */
    authorities: {
      list() {
        return request<{ items: LexAuthority[] }>("/admin/lex/authorities");
      },
      presign(files: PresignAuthorityRequest["files"]) {
        return request<{ uploads: LexAuthorityUploadSlot[] }>(
          "/admin/lex/authorities/presign",
          { method: "POST", body: JSON.stringify({ files }) }
        );
      },
      completeUpload(authorityIds: string[]) {
        return request<{ authorities: LexAuthority[]; missing: string[] }>(
          "/admin/lex/authorities/complete-upload",
          { method: "POST", body: JSON.stringify({ authorityIds }) }
        );
      },
      digest(id: string) {
        return request<{ digest: LexAuthorityDigest }>(
          `/admin/lex/authorities/${id}/digest`
        );
      },
      update(id: string, data: UpdateAuthorityRequest) {
        return request<{ authority: LexAuthority }>(
          `/admin/lex/authorities/${id}`,
          { method: "PATCH", body: JSON.stringify(data) }
        );
      },
      retry(id: string) {
        return request<{ authority: LexAuthority }>(
          `/admin/lex/authorities/${id}/retry`,
          { method: "POST" }
        );
      },
      delete(id: string) {
        return request<{ ok: true }>(`/admin/lex/authorities/${id}`, {
          method: "DELETE"
        });
      }
    },
    /** Long-running background assessments. Watching one: see lib/taskStream.ts. */
    tasks: {
      create(data: CreateTaskRequest) {
        return request<{ task: LexTask }>("/admin/lex/tasks", {
          method: "POST",
          body: JSON.stringify(data)
        });
      },
      list(workspaceId: string) {
        return request<{ items: LexTask[] }>(
          `/admin/lex/workspaces/${workspaceId}/tasks`
        );
      },
      get(id: string) {
        return request<{ task: LexTask }>(`/admin/lex/tasks/${id}`);
      },
      cancel(id: string) {
        return request<{ task: LexTask }>(`/admin/lex/tasks/${id}/cancel`, {
          method: "POST"
        });
      }
    },
    workspaces: {
      list() {
        return request<{ items: LexWorkspace[]; cursor: string | null }>(
          "/admin/lex/workspaces"
        );
      },
      get(id: string) {
        return request<{ workspace: LexWorkspace }>(
          `/admin/lex/workspaces/${id}`
        );
      },
      create(data: CreateWorkspaceRequest) {
        return request<{ workspace: LexWorkspace }>("/admin/lex/workspaces", {
          method: "POST",
          body: JSON.stringify(data)
        });
      },
      update(id: string, data: UpdateWorkspaceRequest) {
        return request<{ workspace: LexWorkspace }>(
          `/admin/lex/workspaces/${id}`,
          {
            method: "PATCH",
            body: JSON.stringify(data)
          }
        );
      },
      delete(id: string) {
        return request<{ ok: true }>(`/admin/lex/workspaces/${id}`, {
          method: "DELETE"
        });
      },
      /**
       * `archived` is optional and omitted by default, which the backend reads as "exclude" — the
       * behaviour every existing caller already gets. The documents view passes "include" because
       * it holds both shelves in one state and splits them client-side (see filterDocuments), so
       * archiving and its Undo are local patches rather than two round-trips.
       */
      /**
       * The case story: the amounts the workspace's documents state, each with the sentence it came
       * from. Derived on read — no table, no model call, so it can never be stale.
       */
      story(id: string) {
        return request<LexStoryPayload>(`/admin/lex/workspaces/${id}/story`);
      },
      timeline(id: string, archived?: LexArchivedScope) {
        const qs = archived ? `?archived=${archived}` : "";
        return request<{ items: LexDocument[] }>(
          `/admin/lex/workspaces/${id}/timeline${qs}`
        );
      }
    },
    documents: {
      list(workspaceId: string, status?: string) {
        const qs = status ? `?status=${encodeURIComponent(status)}` : "";
        return request<{ items: LexDocument[] }>(
          `/admin/lex/workspaces/${workspaceId}/documents${qs}`
        );
      },
      // Uploads go browser → S3 directly; see lib/uploadDocuments.ts for the full sequence.
      presign(workspaceId: string, files: PresignUploadRequest["files"]) {
        return request<{ uploads: LexUploadSlot[] }>(
          `/admin/lex/workspaces/${workspaceId}/documents/presign`,
          { method: "POST", body: JSON.stringify({ files }) }
        );
      },
      completeUpload(documentIds: string[]) {
        return request<{ documents: LexDocument[]; missing: string[] }>(
          "/admin/lex/documents/complete-upload",
          { method: "POST", body: JSON.stringify({ documentIds }) }
        );
      },
      viewUrl(id: string) {
        return request<{ url: string; expiresIn: number }>(
          `/admin/lex/documents/${id}/view`
        );
      },
      transcript(id: string) {
        return request<{ transcript: LexTranscript }>(
          `/admin/lex/documents/${id}/transcript`
        );
      },
      saveTranscript(id: string, transcript: string) {
        return request<{ transcript: LexTranscript }>(
          `/admin/lex/documents/${id}/transcript`,
          { method: "PATCH", body: JSON.stringify({ transcript }) }
        );
      },
      retranscribe(id: string) {
        return request<{ document: LexDocument }>(
          `/admin/lex/documents/${id}/retranscribe`,
          { method: "POST" }
        );
      },
      resummarizeAll() {
        return request<{ queued: number }>(
          "/admin/lex/documents/resummarize-all",
          { method: "POST" }
        );
      },
      /**
       * Builds the per-page index for documents ingested before it existed. Free: re-derives the
       * text from S3, no re-embedding and no model call, so it is safe to fire from a button.
       */
      rebuildPageIndex() {
        return request<LexPageIndexBackfill>("/admin/lex/page-index/rebuild", {
          method: "POST"
        });
      },
      pageIndexStatus() {
        return request<LexPageIndexStatus>("/admin/lex/page-index");
      },
      get(id: string) {
        return request<{ document: LexDocument }>(`/admin/lex/documents/${id}`);
      },
      status(id: string) {
        return request<{
          id: string;
          parseStatus: LexDocument["parseStatus"];
          error: string | null;
        }>(`/admin/lex/documents/${id}/status`);
      },
      retry(id: string) {
        return request<{ document: LexDocument }>(
          `/admin/lex/documents/${id}/retry`,
          { method: "POST" }
        );
      },
      bulkDelete(documentIds: string[]) {
        return request<{ deleted: number }>(
          "/admin/lex/documents/bulk-delete",
          { method: "POST", body: JSON.stringify({ documentIds }) }
        );
      },
      /**
       * Reversible removal from search, chat and assessments: sets lifecycle_state 'archived', which
       * every retrieval path already excludes. Nothing is destroyed.
       *
       * Both routes return the ids that ACTUALLY moved, not a count — that list is what the Undo
       * replays through bulkRestore, so an Undo can never restore a document this archive did not
       * archive (an already-archived id is skipped server-side and never comes back here).
       */
      bulkArchive(documentIds: string[]) {
        return request<LexLifecycleChange>(
          "/admin/lex/documents/bulk-archive",
          { method: "POST", body: JSON.stringify({ documentIds }) }
        );
      },
      bulkRestore(documentIds: string[]) {
        return request<LexLifecycleChange>(
          "/admin/lex/documents/bulk-restore",
          { method: "POST", body: JSON.stringify({ documentIds }) }
        );
      },
      discard(workspaceId: string, statuses: LexParseStatus[]) {
        return request<{ deleted: number }>(
          `/admin/lex/workspaces/${workspaceId}/documents/discard`,
          { method: "POST", body: JSON.stringify({ statuses }) }
        );
      },
      delete(id: string) {
        return request<{ ok: true }>(`/admin/lex/documents/${id}`, {
          method: "DELETE"
        });
      }
    },
    conversations: {
      list(workspaceId: string) {
        return request<{ items: LexConversation[] }>(
          `/admin/lex/workspaces/${workspaceId}/conversations`
        );
      },
      create(workspaceId: string, data: CreateConversationRequest) {
        return request<{ conversation: LexConversation }>(
          `/admin/lex/workspaces/${workspaceId}/conversations`,
          { method: "POST", body: JSON.stringify(data) }
        );
      },
      get(id: string) {
        return request<{ conversation: LexConversation }>(
          `/admin/lex/conversations/${id}`
        );
      },
      /** Newest page by default; pass beforeSeq to walk backwards through a long thread. */
      messages(id: string, opts?: { beforeSeq?: number; limit?: number }) {
        const params = new URLSearchParams();
        if (opts?.beforeSeq !== undefined)
          params.set("beforeSeq", String(opts.beforeSeq));
        if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
        const qs = params.toString() ? `?${params}` : "";
        return request<{
          items: LexMessage[];
          hasMore: boolean;
          /** Per-message citations, keyed by message id — what makes each [n] traceable. */
          citations: Record<string, LexCitationEvent[]>;
        }>(`/admin/lex/conversations/${id}/messages${qs}`);
      },
      rename(id: string, title: string) {
        return request<{ conversation: LexConversation }>(
          `/admin/lex/conversations/${id}`,
          { method: "PATCH", body: JSON.stringify({ title }) }
        );
      },
      delete(id: string) {
        return request<{ ok: true }>(`/admin/lex/conversations/${id}`, {
          method: "DELETE"
        });
      }
      // Sending a message + streaming the reply: see streamLexMessage() in ./lexStream.ts.
    },
    artifacts: {
      list(workspaceId: string) {
        return request<{ items: LexArtifact[] }>(
          `/admin/lex/workspaces/${workspaceId}/artifacts`
        );
      },
      get(id: string) {
        return request<{ artifact: LexArtifact; version: LexArtifactVersion }>(
          `/admin/lex/artifacts/${id}`
        );
      },
      save(id: string, data: SaveArtifactRequest) {
        return request<{ artifact: LexArtifact; version: LexArtifactVersion }>(
          `/admin/lex/artifacts/${id}`,
          {
            method: "PATCH",
            body: JSON.stringify(data)
          }
        );
      },
      signoff(id: string) {
        return request<{ artifact: LexArtifact; version: LexArtifactVersion }>(
          `/admin/lex/artifacts/${id}/signoff`,
          { method: "POST" }
        );
      },
      delete(id: string) {
        return request<{ ok: true }>(`/admin/lex/artifacts/${id}`, {
          method: "DELETE"
        });
      },
      exportHtml(id: string, verifiedOnly: boolean) {
        return requestText(
          `/admin/lex/artifacts/${id}/export?verifiedOnly=${verifiedOnly}`
        );
      }
    }
  }
};
