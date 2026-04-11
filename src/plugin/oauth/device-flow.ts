import {
  authorizeQwenDevice,
  pollQwenDeviceToken,
  type QwenOAuthOptions,
} from "../../qwen/oauth";
import type { AuthMethod, OAuthAuthorizationResult } from "../types";

export interface OAuthFlowResult {
  refresh: string;
  access: string;
  expires: number;
  resourceUrl?: string;
}

export function createOAuthMethod(options: QwenOAuthOptions): AuthMethod {
  return {
    label: "Qwen OAuth",
    type: "oauth",
    async authorize(): Promise<OAuthAuthorizationResult> {
      const device = await authorizeQwenDevice(options);
      const url = device.verificationUriComplete ?? device.verificationUri;
      const instructions = `Open ${device.verificationUri} and enter code ${device.userCode}`;

      return {
        url,
        method: "auto",
        instructions,
        async callback() {
          const result = await pollQwenDeviceToken(
            options,
            device.deviceCode,
            device.intervalSeconds,
            device.expiresAt,
            device.codeVerifier,
          );

          if (result.type === "success") {
            return {
              type: "success",
              refresh: result.refresh,
              access: result.access,
              expires: result.expires,
              resourceUrl: result.resourceUrl,
            };
          }

          return { type: "failed", error: result.error };
        },
      };
    },
  };
}

export async function executeOAuthFlow(
  options: QwenOAuthOptions,
): Promise<OAuthFlowResult> {
  const device = await authorizeQwenDevice(options);
  const result = await pollQwenDeviceToken(
    options,
    device.deviceCode,
    device.intervalSeconds,
    device.expiresAt,
    device.codeVerifier,
  );

  if (result.type === "failed") {
    throw new Error(`OAuth failed: ${result.error}`);
  }

  return {
    refresh: result.refresh,
    access: result.access,
    expires: result.expires,
    resourceUrl: result.resourceUrl,
  };
}
