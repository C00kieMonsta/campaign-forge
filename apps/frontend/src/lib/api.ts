import type { Campaign } from "@packages/types";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

async function request<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = Array.isArray(data.message) ? data.message.join(", ") : (data.message || data.error || `Request failed: ${res.status}`);
    throw new Error(msg);
  }
  return data;
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
  public: {
    subscribe(email: string, firstName?: string, lastName?: string) {
      return request<{ ok: true; message: string }>("/public/subscribe", {
        method: "POST",
        body: JSON.stringify({ email, firstName, lastName }),
      });
    },
  },
};
