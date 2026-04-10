import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { SharedTokenManager, TokenError, TokenManagerError, type QwenTokenClient, type QwenCredentials, type TokenRefreshData } from "../src/qwen/sharedTokenManager.ts";
import { promises as fs } from "node:fs";
import * as os from "os";
import path from "node:path";

describe("SharedTokenManager", () => {
  let manager: SharedTokenManager;
  let tempDir: string;
  let mockClient: QwenTokenClient;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qwen-test-'));
    spyOn(os, "homedir").mockReturnValue(tempDir);
    
    // @ts-ignore
    SharedTokenManager.instance = null;
    manager = SharedTokenManager.getInstance();
    manager.setLockConfig({ maxAttempts: 5, attemptInterval: 10, maxInterval: 50 }); // fast lock config
    
    let currentCreds: QwenCredentials = {
      access_token: "init_access",
      refresh_token: "init_refresh",
      token_type: "Bearer",
      expiry_date: Date.now() - 1000 // expired
    };
    
    mockClient = {
      getCredentials: () => currentCreds,
      setCredentials: (creds) => { currentCreds = creds; },
      refreshAccessToken: async () => ({
        access_token: "new_access",
        refresh_token: "new_refresh",
        token_type: "Bearer",
        expires_in: 3600
      })
    };
  });

  afterEach(async () => {
    manager.cleanup();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("should be a singleton", () => {
    const instance1 = SharedTokenManager.getInstance();
    const instance2 = SharedTokenManager.getInstance();
    expect(instance1).toBe(instance2);
  });

  test("should return valid cached credentials without refresh", async () => {
    const validCreds: QwenCredentials = {
      access_token: "valid_access",
      refresh_token: "valid_refresh",
      token_type: "Bearer",
      expiry_date: Date.now() + 60000 // valid for 1 min
    };
    
    mockClient.setCredentials(validCreds);
    // Directly setting memory cache for testing
    // @ts-ignore
    manager.memoryCache.credentials = validCreds;
    
    const creds = await manager.getValidCredentials(mockClient, false);
    expect(creds.access_token).toBe("valid_access");
  });

  test("should refresh credentials if expired", async () => {
    const creds = await manager.getValidCredentials(mockClient, false);
    expect(creds.access_token).toBe("new_access");
    expect(creds.refresh_token).toBe("new_refresh");
  });

  test("should handle concurrent refreshes safely", async () => {
    let refreshCount = 0;
    
    const slowMockClient: QwenTokenClient = {
      ...mockClient,
      refreshAccessToken: async () => {
        refreshCount++;
        await new Promise(r => setTimeout(r, 50));
        return {
          access_token: "concurrent_access",
          refresh_token: "concurrent_refresh",
          token_type: "Bearer",
          expires_in: 3600
        };
      }
    };

    const p1 = manager.getValidCredentials(slowMockClient, false);
    const p2 = manager.getValidCredentials(slowMockClient, false);
    
    const [res1, res2] = await Promise.all([p1, p2]);
    expect(res1.access_token).toBe("concurrent_access");
    expect(res2.access_token).toBe("concurrent_access");
    
    // Only 1 actual API refresh call should be made because of promise reuse
    expect(refreshCount).toBe(1);
  });

  test("should throw NO_REFRESH_TOKEN if missing", async () => {
    const badClient: QwenTokenClient = {
      getCredentials: () => ({ access_token: "a", token_type: "b", expiry_date: Date.now() - 1000 }),
      setCredentials: () => {},
      refreshAccessToken: async () => ({ access_token: "new", token_type: "b", expires_in: 1 })
    };
    
    await expect(manager.getValidCredentials(badClient, false))
      .rejects.toThrow(/No refresh token available/);
  });
});
