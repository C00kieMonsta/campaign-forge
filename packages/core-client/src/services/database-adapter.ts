/**
 * Database adapter for HTTP communication with the backend
 *
 * This module provides the implementation of the IDatabaseAdapter interface
 * with support for authentication, error handling, and retry logic.
 */

import {
  ConflictError,
  IDatabaseAdapter,
  NetworkError,
  NotFoundError,
  UnauthorizedError,
  ValidationError
} from "@packages/types";

/**
 * Configuration options for HttpDatabaseAdapter
 */
export interface HttpDatabaseAdapterConfig {
  /**
   * Base URL for the API (e.g., "https://api.example.com" or "" for relative URLs)
   */
  baseUrl: string;

  /**
   * Function to retrieve the current authentication token
   * Should return null if no token is available
   */
  getAuthToken: () => Promise<string | null>;

  /**
   * Maximum number of retry attempts for failed requests
   * @default 3
   */
  maxRetries?: number;

  /**
   * Initial delay in milliseconds for exponential backoff
   * @default 1000
   */
  initialRetryDelay?: number;

  /**
   * Maximum delay in milliseconds for exponential backoff
   * @default 10000
   */
  maxRetryDelay?: number;

  /**
   * HTTP status codes that should trigger a retry
   * @default [408, 429, 500, 502, 503, 504]
   */
  retryableStatusCodes?: number[];
}

/**
 * HTTP Database Adapter implementation
 *
 * Provides HTTP communication with the backend API including:
 * - Authentication token injection
 * - Error handling and transformation
 * - Retry logic with exponential backoff
 * - Request/response logging
 */
export class HttpDatabaseAdapter implements IDatabaseAdapter {
  private readonly baseUrl: string;
  private readonly getAuthToken: () => Promise<string | null>;
  private readonly maxRetries: number;
  private readonly initialRetryDelay: number;
  private readonly maxRetryDelay: number;
  private readonly retryableStatusCodes: Set<number>;

  constructor(config: HttpDatabaseAdapterConfig) {
    this.baseUrl = config.baseUrl;
    this.getAuthToken = config.getAuthToken;
    this.maxRetries = config.maxRetries ?? 3;
    this.initialRetryDelay = config.initialRetryDelay ?? 1000;
    this.maxRetryDelay = config.maxRetryDelay ?? 10000;
    this.retryableStatusCodes = new Set(
      config.retryableStatusCodes ?? [408, 429, 500, 502, 503, 504]
    );
  }

  /**
   * Perform a GET request
   */
  async get<T>(path: string, params?: Record<string, any>): Promise<T> {
    const url = this.buildUrl(path, params);
    return this.request<T>("GET", url);
  }

  /**
   * Perform a POST request
   */
  async post<T>(path: string, data?: any): Promise<T> {
    const url = this.buildUrl(path);
    return this.request<T>("POST", url, data);
  }

  /**
   * Perform a PUT request
   */
  async put<T>(path: string, data?: any): Promise<T> {
    const url = this.buildUrl(path);
    return this.request<T>("PUT", url, data);
  }

  /**
   * Perform a PATCH request
   */
  async patch<T>(path: string, data?: any): Promise<T> {
    const url = this.buildUrl(path);
    return this.request<T>("PATCH", url, data);
  }

  /**
   * Perform a DELETE request
   */
  async delete<T>(path: string): Promise<T> {
    const url = this.buildUrl(path);
    return this.request<T>("DELETE", url);
  }

  /**
   * Build the full URL from path and query parameters
   */
  private buildUrl(path: string, params?: Record<string, any>): string {
    // Ensure path starts with /api
    const normalizedPath = path.startsWith("/api")
      ? path
      : `/api${path.startsWith("/") ? path : `/${path}`}`;

    let url = `${this.baseUrl}${normalizedPath}`;

    // Add query parameters if provided
    if (params && Object.keys(params).length > 0) {
      const searchParams = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          searchParams.append(key, String(value));
        }
      });
      const queryString = searchParams.toString();
      if (queryString) {
        url += `?${queryString}`;
      }
    }

    return url;
  }

  /**
   * Perform an HTTP request with retry logic
   */
  private async request<T>(
    method: string,
    url: string,
    data?: any,
    attempt: number = 0
  ): Promise<T> {
    try {
      // Get authentication token
      const token = await this.getAuthToken();

      // Build headers
      const headers: Record<string, string> = {
        "Content-Type": "application/json"
      };

      // Add cache control headers for hot data (extraction results/jobs)
      // These endpoints deliver frequently-changing data via WebSocket, so disable browser caching
      if (
        method === "GET" &&
        (url.includes("/extraction-results") ||
          url.includes("/extraction-jobs") ||
          url.includes("/extraction/job"))
      ) {
        headers["Cache-Control"] =
          "no-store, no-cache, must-revalidate, proxy-revalidate";
        // Note: Pragma and Expires headers removed - not needed with modern Cache-Control
        // and were causing CORS issues
      }

      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      // Build request options
      const options: RequestInit = {
        method,
        headers
      };

      if (data !== undefined && method !== "GET") {
        options.body = JSON.stringify(data);
      }

      // Disable HTTP cache for GET requests to extraction data (hot data)
      // Hot data changes frequently via WebSocket, so browser cache can cause stale responses
      if (
        method === "GET" &&
        (url.includes("/extraction-results") ||
          url.includes("/extraction-jobs") ||
          url.includes("/extraction/job"))
      ) {
        options.cache = "no-store";
      }

      // Make the request
      const response = await fetch(url, options);

      // Handle response
      if (!response.ok) {
        // Check if we should retry
        if (
          attempt < this.maxRetries &&
          this.retryableStatusCodes.has(response.status)
        ) {
          const delay = this.calculateRetryDelay(attempt);
          console.warn(
            `Request failed with status ${response.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${this.maxRetries})`
          );
          await this.sleep(delay);
          return this.request<T>(method, url, data, attempt + 1);
        }

        // Transform error based on status code
        await this.handleErrorResponse(response);
      }

      // Parse and return response
      return this.parseResponse<T>(response);
    } catch (error) {
      // Handle network errors with retry
      if (
        error instanceof TypeError &&
        error.message.includes("fetch") &&
        attempt < this.maxRetries
      ) {
        const delay = this.calculateRetryDelay(attempt);
        console.warn(
          `Network error, retrying in ${delay}ms (attempt ${attempt + 1}/${this.maxRetries})`
        );
        await this.sleep(delay);
        return this.request<T>(method, url, data, attempt + 1);
      }

      // Re-throw if it's already one of our custom errors
      if (
        error instanceof NetworkError ||
        error instanceof ValidationError ||
        error instanceof NotFoundError ||
        error instanceof UnauthorizedError ||
        error instanceof ConflictError
      ) {
        throw error;
      }

      // Wrap unknown errors
      throw new NetworkError(
        `Request failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        undefined,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Parse the response body
   */
  private async parseResponse<T>(response: Response): Promise<T> {
    const contentType = response.headers.get("content-type");

    // Handle empty responses
    if (response.status === 204 || !contentType) {
      return undefined as T;
    }

    // Parse JSON responses
    if (contentType.includes("application/json")) {
      return response.json();
    }

    // Handle text responses
    const text = await response.text();
    return text as T;
  }

  /**
   * Handle error responses and throw appropriate errors
   */
  private async handleErrorResponse(response: Response): Promise<never> {
    let errorMessage = `Request failed with status ${response.status}`;
    let errorDetails: any = null;

    // Try to parse error response body
    try {
      const contentType = response.headers.get("content-type");
      if (contentType?.includes("application/json")) {
        errorDetails = await response.json();
        errorMessage =
          errorDetails.message || errorDetails.error || errorMessage;
      } else {
        const text = await response.text();
        if (text) {
          errorMessage = text;
        }
      }
    } catch (parseError) {
      // Ignore parse errors, use default message
    }

    // Throw appropriate error based on status code
    switch (response.status) {
      case 400:
        throw new ValidationError(errorMessage, errorDetails?.field);
      case 401:
        throw new UnauthorizedError(errorMessage);
      case 404:
        throw new NotFoundError(errorMessage);
      case 409:
        throw new ConflictError(errorMessage);
      default:
        throw new NetworkError(errorMessage, response.status);
    }
  }

  /**
   * Calculate retry delay using exponential backoff
   */
  private calculateRetryDelay(attempt: number): number {
    const exponentialDelay = this.initialRetryDelay * Math.pow(2, attempt);
    const jitter = Math.random() * 0.1 * exponentialDelay; // Add 10% jitter
    return Math.min(exponentialDelay + jitter, this.maxRetryDelay);
  }

  /**
   * Sleep for the specified duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
