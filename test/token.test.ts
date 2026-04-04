import { describe, expect, it, mock } from "bun:test";
import { refreshAccessToken } from "../src/plugin/token";
import type { OAuthAuthDetails, PluginClient } from "../src/plugin/types";

const mockRefreshQwenToken = mock(() =>
  Promise.resolve({
    type: "success" as const,
    access: "access-new",
    refresh: "refresh-new",
    expires: 123456,
    resourceUrl: "https://resource.example",
  }),
);

mock.module("../src/qwen/oauth", () => ({
  refreshQwenToken: mockRefreshQwenToken,
}));

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
});
