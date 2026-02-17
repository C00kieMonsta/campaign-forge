/**
 * Tests for HttpDatabaseAdapter
 * 
 * Validates: Requirements 3.1, 3.4, 20.1, 20.2, 20.3, 20.4
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpDatabaseAdapter } from '../database-adapter';
import {
  NetworkError,
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  ConflictError,
} from '@packages/types';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

describe('HttpDatabaseAdapter', () => {
  let adapter: HttpDatabaseAdapter;
  let mockGetAuthToken: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockGetAuthToken = vi.fn().mockResolvedValue('test-token');
    adapter = new HttpDatabaseAdapter({
      baseUrl: 'https://api.example.com',
      getAuthToken: mockGetAuthToken,
      maxRetries: 2,
      initialRetryDelay: 10, // Short delay for tests
      maxRetryDelay: 50,
    });
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('GET requests', () => {
    it('should make a GET request with auth token', async () => {
      const mockData = { id: '1', name: 'Test' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockData,
      });

      const result = await adapter.get('/clients/1');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/api/clients/1',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token',
            'Content-Type': 'application/json',
          }),
        })
      );
      expect(result).toEqual(mockData);
    });

    it('should add query parameters to GET request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => [],
      });

      await adapter.get('/clients', { status: 'active', limit: 10 });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/api/clients?status=active&limit=10',
        expect.any(Object)
      );
    });

    it('should work without auth token', async () => {
      mockGetAuthToken.mockResolvedValueOnce(null);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({}),
      });

      await adapter.get('/public/data');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.not.objectContaining({
            'Authorization': expect.any(String),
          }),
        })
      );
    });
  });

  describe('POST requests', () => {
    it('should make a POST request with data', async () => {
      const postData = { name: 'New Client' };
      const responseData = { id: '1', ...postData };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => responseData,
      });

      const result = await adapter.post('/clients', postData);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/api/clients',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(postData),
        })
      );
      expect(result).toEqual(responseData);
    });
  });

  describe('PUT requests', () => {
    it('should make a PUT request with data', async () => {
      const putData = { name: 'Updated Client' };
      const responseData = { id: '1', ...putData };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => responseData,
      });

      const result = await adapter.put('/clients/1', putData);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/api/clients/1',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify(putData),
        })
      );
      expect(result).toEqual(responseData);
    });
  });

  describe('PATCH requests', () => {
    it('should make a PATCH request with data', async () => {
      const patchData = { name: 'Patched Client' };
      const responseData = { id: '1', ...patchData };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => responseData,
      });

      const result = await adapter.patch('/clients/1', patchData);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/api/clients/1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify(patchData),
        })
      );
      expect(result).toEqual(responseData);
    });
  });

  describe('DELETE requests', () => {
    it('should make a DELETE request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        headers: new Headers(),
      });

      const result = await adapter.delete('/clients/1');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/api/clients/1',
        expect.objectContaining({
          method: 'DELETE',
        })
      );
      expect(result).toBeUndefined();
    });
  });

  describe('Error handling', () => {
    it('should throw ValidationError for 400 status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ message: 'Invalid data', field: 'name' }),
      });

      await expect(adapter.get('/clients')).rejects.toThrow(ValidationError);
    });

    it('should throw UnauthorizedError for 401 status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ message: 'Unauthorized' }),
      });

      await expect(adapter.get('/clients')).rejects.toThrow(UnauthorizedError);
    });

    it('should throw NotFoundError for 404 status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ message: 'Not found' }),
      });

      await expect(adapter.get('/clients/999')).rejects.toThrow(NotFoundError);
    });

    it('should throw ConflictError for 409 status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ message: 'Conflict' }),
      });

      await expect(adapter.post('/clients', {})).rejects.toThrow(ConflictError);
    });

    it('should throw NetworkError for 500 status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ message: 'Internal server error' }),
      });

      await expect(adapter.get('/clients')).rejects.toThrow(NetworkError);
    });
  });

  describe('Retry logic', () => {
    it('should retry on 503 status and succeed', async () => {
      // First attempt fails with 503
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        headers: new Headers(),
      });

      // Second attempt succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ success: true }),
      });

      const result = await adapter.get('/clients');

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ success: true });
    });

    it('should retry on network error and succeed', async () => {
      // First attempt fails with network error
      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

      // Second attempt succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ success: true }),
      });

      const result = await adapter.get('/clients');

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ success: true });
    });

    it('should fail after max retries', async () => {
      // All attempts fail with 503
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        headers: new Headers(),
      });

      await expect(adapter.get('/clients')).rejects.toThrow(NetworkError);

      // Should try initial + 2 retries = 3 total
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should not retry on 400 status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ message: 'Bad request' }),
      });

      await expect(adapter.get('/clients')).rejects.toThrow(ValidationError);

      // Should only try once (no retries for 400)
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('URL building', () => {
    it('should handle paths with /api prefix', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({}),
      });

      await adapter.get('/api/clients');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/api/clients',
        expect.any(Object)
      );
    });

    it('should handle paths without leading slash', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({}),
      });

      await adapter.get('clients');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/api/clients',
        expect.any(Object)
      );
    });

    it('should work with empty baseUrl for relative URLs', async () => {
      const relativeAdapter = new HttpDatabaseAdapter({
        baseUrl: '',
        getAuthToken: mockGetAuthToken,
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({}),
      });

      await relativeAdapter.get('/clients');

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/clients',
        expect.any(Object)
      );
    });
  });
});
