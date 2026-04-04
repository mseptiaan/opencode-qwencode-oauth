import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMockServer } from "./mock-server/server";

const MOCK_PORT = 3456;

describe("E2E with Mock Server", () => {
  const mockServer = createMockServer({ port: MOCK_PORT });
  let tempConfigDir: string;

  beforeAll(() => {
    mockServer.start();
  });

  afterAll(() => {
    mockServer.stop();
  });

  beforeEach(() => {
    mockServer.reset();
    tempConfigDir = mkdtempSync(join(tmpdir(), "qwen-auth-test-"));
  });

  function _createTestAccounts(
    accounts: Array<{ refreshToken: string; rateLimitedUntil?: number }>,
  ) {
    const storage = {
      version: 1,
      activeIndex: 0,
      accounts: accounts.map((acc, _i) => ({
        refreshToken: acc.refreshToken,
        addedAt: Date.now(),
        lastUsed: Date.now(),
        rateLimitedUntil: acc.rateLimitedUntil,
      })),
    };
    const accountsPath = join(tempConfigDir, "qwen-auth-accounts.json");
    writeFileSync(accountsPath, JSON.stringify(storage));
    return accountsPath;
  }

  describe("Basic Functionality", () => {
    it("mock server responds to chat completions", async () => {
      const response = await fetch(
        `http://localhost:${MOCK_PORT}/v1/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer test-token",
          },
          body: JSON.stringify({
            model: "qwen3-coder-plus",
            messages: [{ role: "user", content: "Hello" }],
          }),
        },
      );

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.choices[0].message.content).toContain("Mock response");
    });

    it("mock server handles SSE streaming", async () => {
      const response = await fetch(
        `http://localhost:${MOCK_PORT}/v1/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer test-token",
          },
          body: JSON.stringify({
            model: "qwen3-coder-plus",
            messages: [{ role: "user", content: "Hello" }],
            stream: true,
          }),
        },
      );

      expect(response.ok).toBe(true);
      expect(response.headers.get("content-type")).toContain(
        "text/event-stream",
      );

      const text = await response.text();
      expect(text).toContain("data:");
      expect(text).toContain("[DONE]");
    });
  });

  describe("Rate Limit Handling", () => {
    it("returns 429 after configured request count", async () => {
      mockServer.setRateLimitAfter(2);

      const makeRequest = () =>
        fetch(`http://localhost:${MOCK_PORT}/v1/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer account-1",
          },
          body: JSON.stringify({ model: "test", messages: [] }),
        });

      const r1 = await makeRequest();
      expect(r1.status).toBe(200);

      const r2 = await makeRequest();
      expect(r2.status).toBe(200);

      const r3 = await makeRequest();
      expect(r3.status).toBe(429);
      expect(r3.headers.get("retry-after")).toBe("60");
    });
  });

  describe("Token Refresh", () => {
    it("returns new tokens on refresh", async () => {
      const response = await fetch(
        `http://localhost:${MOCK_PORT}/oauth/token`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            grant_type: "refresh_token",
            refresh_token: "old-token",
          }),
        },
      );

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.access_token).toBe("mock-access-new");
      expect(data.refresh_token).toBe("mock-refresh-new");
      expect(mockServer.state.tokenRefreshCount).toBe(1);
    });

    it("fails refresh when configured", async () => {
      mockServer.setRefreshBehavior("fail");

      const response = await fetch(
        `http://localhost:${MOCK_PORT}/oauth/token`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            grant_type: "refresh_token",
            refresh_token: "old-token",
          }),
        },
      );

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("invalid_grant");
    });
  });

  describe("SSE Chunk Splitting", () => {
    it("handles split chunks correctly", async () => {
      mockServer.enableChunkSplitting(true);

      const response = await fetch(
        `http://localhost:${MOCK_PORT}/v1/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer test-token",
          },
          body: JSON.stringify({
            model: "qwen3-coder-plus",
            messages: [{ role: "user", content: "Hello" }],
            stream: true,
          }),
        },
      );

      expect(response.ok).toBe(true);
      const text = await response.text();
      expect(text).toContain("[DONE]");

      const dataLines = text
        .split("\n")
        .filter((line) => line.startsWith("data:"));
      expect(dataLines.length).toBeGreaterThan(0);
    });
  });

  describe("Device Code Flow", () => {
    it("returns device code for OAuth", async () => {
      const response = await fetch(
        `http://localhost:${MOCK_PORT}/oauth/device/code`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client_id: "test-client" }),
        },
      );

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.device_code).toBe("mock-device-code-123");
      expect(data.user_code).toBe("MOCK-1234");
    });
  });
});
