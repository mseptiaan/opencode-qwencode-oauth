import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from "bun:test";
import { QwenTokenRefreshError, refreshAccessToken } from "../src/plugin/token";
import type { OAuthAuthDetails, PluginClient } from "../src/plugin/types";
import {
  SharedTokenManager,
  TokenManagerError,
  TokenError,
} from "../src/qwen/sharedTokenManager";

const mockGetValidCredentials = mock(() =>
  Promise.resolve({
    access_token: "access-new",
    refresh_token: "refresh-new",
    token_type: "Bearer",
    expiry_date: 123456,
    resource_url: "https://resource.example",
  }),
);

let getInstanceSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  getInstanceSpy = spyOn(SharedTokenManager, "getInstance").mockReturnValue({
    getValidCredentials: mockGetValidCredentials,
  } as unknown as SharedTokenManager);
});

afterEach(() => {
  getInstanceSpy.mockRestore();
  mockGetValidCredentials.mockClear();
});

describe("refreshAccessToken", () => {
  it("persists updated auth details", async () => {
    const auth: OAuthAuthDetails = {
      type: "oauth",
      refresh: "refresh-old",
      access: "access-old",
      expires: 1000,
    };

    const mockAuthSet = mock(() => Promise.resolve(undefined));
    const client = {
      auth: {
        set: mockAuthSet,
      },
    } as unknown as PluginClient;

    const result = await refreshAccessToken(
      auth,
      { clientId: "client", oauthBaseUrl: "https://chat.qwen.ai" },
      client,
      "qwen",
    );

    expect(result?.access).toBe("access-new");
    expect(result?.refresh).toBe("refresh-new");
    expect(mockAuthSet).toHaveBeenCalledWith({
      path: { id: "qwen" },
      body: {
        type: "oauth",
        refresh: "refresh-new",
        access: "access-new",
        expires: 123456,
        resourceUrl: "https://resource.example",
      },
    });
  });

  it("does not call the token endpoint when refresh is the string undefined", async () => {
    const auth = {
      type: "oauth" as const,
      refresh: "undefined",
      access: "access-old",
    } as OAuthAuthDetails;

    const client = {
      auth: { set: mock(() => Promise.resolve(undefined)) },
    } as unknown as PluginClient;

    await expect(
      refreshAccessToken(
        auth,
        { clientId: "client", oauthBaseUrl: "https://chat.qwen.ai" },
        client,
        "qwen",
      ),
    ).rejects.toThrow(QwenTokenRefreshError);

    expect(mockGetValidCredentials).not.toHaveBeenCalled();
  });

  it("throws QwenTokenRefreshError with specific code when TokenManagerError is thrown", async () => {
    const auth: OAuthAuthDetails = {
      type: "oauth",
      refresh: "refresh-old",
      access: "access-old",
      expires: 1000,
    };
    const client = { auth: { set: mock() } } as unknown as PluginClient;

    mockGetValidCredentials.mockRejectedValueOnce(
      new TokenManagerError(
        TokenError.REFRESH_FAILED,
        "Custom token manager error",
      ),
    );

    let caughtError: Error | undefined;
    try {
      await refreshAccessToken(
        auth,
        { clientId: "client", oauthBaseUrl: "https://chat.qwen.ai" },
        client,
        "qwen",
      );
    } catch (e: any) {
      caughtError = e;
    }

    expect(caughtError).toBeInstanceOf(QwenTokenRefreshError);
    expect((caughtError as QwenTokenRefreshError).message).toBe(
      "Custom token manager error",
    );
    expect((caughtError as QwenTokenRefreshError).code).toBe(
      TokenError.REFRESH_FAILED,
    );
  });

  it("throws generic QwenTokenRefreshError when an unknown Error is thrown", async () => {
    const auth: OAuthAuthDetails = {
      type: "oauth",
      refresh: "refresh-old",
      access: "access-old",
      expires: 1000,
    };
    const client = { auth: { set: mock() } } as unknown as PluginClient;

    mockGetValidCredentials.mockRejectedValueOnce(
      new Error("Generic network error"),
    );

    let caughtError: Error | undefined;
    try {
      await refreshAccessToken(
        auth,
        { clientId: "client", oauthBaseUrl: "https://chat.qwen.ai" },
        client,
        "qwen",
      );
    } catch (e: any) {
      caughtError = e;
    }

    expect(caughtError).toBeInstanceOf(QwenTokenRefreshError);
    expect((caughtError as QwenTokenRefreshError).message).toBe(
      "Generic network error",
    );
    expect((caughtError as QwenTokenRefreshError).code).toBeUndefined();
  });
});
