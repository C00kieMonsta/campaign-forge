import type { Campaign, Contact, ContactGroup } from "@packages/types";

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
    const msg = Array.isArray(data.message) ? data.message.join(", ") : (data.message || data.error || `Request failed: ${res.status}`);
    throw new Error(msg);
  }
  return data;
}

async function request<T>(path: string, opts?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(opts?.headers as Record<string, string>) };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });

  if (res.status === 401) {
    handleUnauthorized();
    throw new Error("Unauthorized");
  }

  return parseResponse<T>(res);
}

async function publicRequest<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  return parseResponse<T>(res);
}

export const api = {
  campaigns: {
    list() {
      return request<{ items: Campaign[]; cursor: string | null; count: number }>("/admin/campaigns");
    },
    get(id: string) {
      return request<{ ok: true; campaign: Campaign }>(`/admin/campaigns/${id}`);
    },
    create(data: { name: string; subject: string; html: string; targetGroups?: string[] }) {
      return request<{ ok: true; campaign: Campaign }>("/admin/campaigns", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    update(id: string, data: Partial<{ name: string; subject: string; html: string; targetGroups: string[] }>) {
      return request<{ ok: true; campaign: Campaign }>(`/admin/campaigns/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
    },
    delete(id: string) {
      return request<{ ok: true }>(`/admin/campaigns/${id}`, { method: "DELETE" });
    },
    send(id: string) {
      return request<{ ok: true; sentCount: number; message: string }>(`/admin/campaigns/${id}/send`, {
        method: "POST",
      });
    },
    testSendById(id: string, email: string) {
      return request<{ ok: true; message: string }>(`/admin/campaigns/${id}/test`, {
        method: "POST",
        body: JSON.stringify({ email }),
      });
    },
    testSend(email: string, subject: string, html: string) {
      return request<{ ok: true; message: string }>("/admin/campaigns/test-send", {
        method: "POST",
        body: JSON.stringify({ email, subject, html }),
      });
    },
  },
  contacts: {
    list(params?: { status?: string; q?: string; limit?: number; cursor?: string }) {
      const qs = new URLSearchParams();
      if (params?.status) qs.set("status", params.status);
      if (params?.q) qs.set("q", params.q);
      if (params?.limit) qs.set("limit", String(params.limit));
      if (params?.cursor) qs.set("cursor", params.cursor);
      const query = qs.toString();
      return request<{ items: Contact[]; cursor: string | null; count: number }>(`/admin/contacts${query ? `?${query}` : ""}`);
    },
    create(data: Partial<Contact> & { email: string }) {
      return request<{ ok: true; contact: Contact }>("/admin/contacts", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    update(emailLower: string, data: Partial<Contact>) {
      return request<{ ok: true; contact: Contact }>(`/admin/contacts/${encodeURIComponent(emailLower)}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
    },
    delete(emailLower: string) {
      return request<{ ok: true }>(`/admin/contacts/${encodeURIComponent(emailLower)}`, { method: "DELETE" });
    },
    importCsv(csv: string) {
      return request<{ ok: true; imported: number; skipped: number }>("/admin/contacts/import", {
        method: "POST",
        body: JSON.stringify({ csv }),
      });
    },
  },
  groups: {
    list() {
      return request<ContactGroup[]>("/admin/groups");
    },
    create(data: { name: string; color: string }) {
      return request<ContactGroup>("/admin/groups", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    update(id: string, data: { name?: string; color?: string }) {
      return request<void>(`/admin/groups/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
    },
    delete(id: string) {
      return request<void>(`/admin/groups/${id}`, { method: "DELETE" });
    },
  },
  public: {
    subscribe(email: string, firstName?: string, lastName?: string) {
      return publicRequest<{ ok: true; message: string }>("/public/subscribe", {
        method: "POST",
        body: JSON.stringify({ email, firstName, lastName }),
      });
    },
  },
};
