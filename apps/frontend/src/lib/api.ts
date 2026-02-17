/**
 * API utility functions for making requests to the backend
 */

import type { ZodSchema } from "zod";
// Import the singleton client to avoid multiple instances
import { getSupabaseBrowser } from "./supabase-browser";

// Get the API base URL from environment variables
const getApiBaseUrl = (): string => {
  // In development, use the explicit API URL if provided
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }

  // In production or when no explicit URL is set, use relative URLs
  // This assumes the frontend and backend are served from the same domain
  return "";
};

// Get the current access token
const getAccessToken = async (): Promise<string | null> => {
  try {
    const supabase = getSupabaseBrowser();
    const {
      data: { session },
      error
    } = await supabase.auth.getSession();

    if (error) {
      console.warn("Auth session error:", error);
      return null;
    }

    if (!session) {
      console.warn("No active session found");
      return null;
    }

    if (!session.access_token) {
      console.warn("Session found but no access token");
      return null;
    }

    // Debug: check if token is expired
    const now = Math.floor(Date.now() / 1000);
    if (session.expires_at && session.expires_at < now) {
      console.warn("Access token is expired");
      return null;
    }

    console.debug("Found valid access token");
    return session.access_token;
  } catch (error) {
    console.warn("Failed to get access token:", error);
    return null;
  }
};

/**
 * Make an API request with the correct base URL and auth token
 */
export const apiRequest = async (
  endpoint: string,
  options?: RequestInit
): Promise<Response> => {
  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}/api${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;

  // Get auth token and add to headers
  const token = await getAccessToken();
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string>)
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    ...options,
    headers
  });

  // Handle 401 Unauthorized errors
  if (response.status === 401) {
    console.warn(`API request to ${endpoint} failed: Authentication required`);
    // You might want to redirect to login page or refresh token here
    // For now, we'll just return the response and let the calling code handle it
  }

  return response;
};

/**
 * Make a GET request to the API
 */
export const apiGet = async (endpoint: string): Promise<Response> => {
  return apiRequest(endpoint, { method: "GET" });
};

/**
 * Make a POST request to the API
 */
export const apiPost = async (
  endpoint: string,
  data?: unknown,
  options?: Omit<RequestInit, "method" | "body">
): Promise<Response> => {
  const body = data ? JSON.stringify(data) : null;
  return apiRequest(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...options?.headers
    },
    body,
    ...options
  });
};

/**
 * Make a PUT request to the API
 */
export const apiPut = async (
  endpoint: string,
  data?: unknown,
  options?: Omit<RequestInit, "method" | "body">
): Promise<Response> => {
  const body = data ? JSON.stringify(data) : null;
  return apiRequest(endpoint, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...options?.headers
    },
    body,
    ...options
  });
};

/**
 * Make a PATCH request to the API
 */
export const apiPatch = async (
  endpoint: string,
  data?: unknown,
  options?: Omit<RequestInit, "method" | "body">
): Promise<Response> => {
  const body = data ? JSON.stringify(data) : null;
  return apiRequest(endpoint, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...options?.headers
    },
    body,
    ...options
  });
};

/**
 * Make a DELETE request to the API
 */
export const apiDelete = async (
  endpoint: string,
  options?: Omit<RequestInit, "method">
): Promise<Response> => {
  return apiRequest(endpoint, {
    method: "DELETE",
    ...options
  });
};

/**
 * Generic API call to OpenAI to generate a string or a structured output
 */
interface GenerateFromLLMRequest {
  system: string;
  prompt: string;
  schema?: ZodSchema<unknown>;
}

export async function generateFromLLM(
  request: GenerateFromLLMRequest
): Promise<Response> {
  try {
    const token = await getAccessToken();

    const baseUrl = getApiBaseUrl();
    const url = `${baseUrl}/api/llm/generate`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token && { Authorization: `Bearer ${token}` })
      },
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      throw new Error(`Failed to generate content: ${response.statusText}`);
    }

    return response;
  } catch (error) {
    throw error;
  }
}
