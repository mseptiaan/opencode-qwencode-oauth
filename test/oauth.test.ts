import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { QwenAuthClient } from "../src/qwen/oauth";
import type { QwenCredentials } from "../src/qwen/sharedTokenManager";

describe("QwenAuthClient", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("should initialize with credentials and return them", () => {
    const creds: QwenCredentials = {
      access_token: "access1",
      refresh_token: "refresh1",
      token_type: "Bearer",
      expiry_date: 1000000,
    };
    const client = new QwenAuthClient(
      { clientId: "test", oauthBaseUrl: "http://test" },
      creds,
    );

    expect(client.getCredentials()).toEqual(creds);
  });

  it("should update credentials", () => {
    const creds1: QwenCredentials = {
      access_token: "access1",
      refresh_token: "refresh1",
      token_type: "Bearer",
    };
    const creds2: QwenCredentials = {
      access_token: "access2",
      refresh_token: "refresh2",
      token_type: "Bearer",
    };
    const client = new QwenAuthClient(
      { clientId: "test", oauthBaseUrl: "http://test" },
      creds1,
    );

    client.setCredentials(creds2);
    expect(client.getCredentials()).toEqual(creds2);
  });

  it("should refresh access token and map success response", async () => {
    const creds: QwenCredentials = {
      access_token: "old-access",
      refresh_token: "valid-refresh-token",
      token_type: "Bearer",
    };
    const client = new QwenAuthClient(
      { clientId: "test", oauthBaseUrl: "http://test" },
      creds,
    );

    const mockResponse = {
      ok: true,
      json: async () => ({
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_in: 3600,
        token_type: "Bearer",
      }),
    };
    global.fetch = mock(async () => mockResponse as unknown as Response) as any;

    const result = await client.refreshAccessToken();

    // Check if result matches TokenRefreshData shape
    expect(result).not.toHaveProperty("error");
    if ("access_token" in result) {
      expect(result.access_token).toBe("new-access");
      expect(result.refresh_token).toBe("new-refresh");
      // calculateTokenExpiry computes expiry as Date.now() + expires_in * 1000
      // SharedTokenManager expects expires_in in seconds.
      expect(result.expires_in).toBeGreaterThan(0);
      // Wait, QwenAuthClient will return something where expires_in is roughly 3600.
      expect(result.expires_in).toBeGreaterThanOrEqual(3590);
      expect(result.expires_in).toBeLessThanOrEqual(3610);
      expect(result.token_type).toBe("Bearer");
    } else {
      throw new Error("Expected TokenRefreshData, got ErrorData");
    }
  });

  it("should handle refresh failure and map error response", async () => {
    const creds: QwenCredentials = {
      access_token: "old-access",
      refresh_token: "bad-refresh",
      token_type: "Bearer",
    };
    const client = new QwenAuthClient(
      { clientId: "test", oauthBaseUrl: "http://test" },
      creds,
    );

    const mockResponse = {
      ok: false,
      text: async () =>
        JSON.stringify({
          error: "invalid_grant",
          error_description: "Invalid refresh token",
        }),
    };
    global.fetch = mock(async () => mockResponse as unknown as Response) as any;

    const result = await client.refreshAccessToken();

    expect(result).toHaveProperty("error");
    if ("error" in result) {
      expect(result.error).toBe("invalid_grant");
      expect(result.error_description).toBe("Invalid refresh token");
    } else {
      throw new Error("Expected ErrorData");
    }
  });

  it("should return error if no refresh token exists", async () => {
    const creds: QwenCredentials = {
      access_token: "old-access",
      token_type: "Bearer",
      // no refresh_token
    };
    const client = new QwenAuthClient(
      { clientId: "test", oauthBaseUrl: "http://test" },
      creds,
    );

    const result = await client.refreshAccessToken();

    expect(result).toHaveProperty("error");
    if ("error" in result) {
      expect(result.error).toBe("invalid_request");
    } else {
      throw new Error("Expected ErrorData");
    }
  });
});
