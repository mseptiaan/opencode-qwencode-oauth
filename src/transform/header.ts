import { createLogger } from "../plugin/logger";

const logger = createLogger("transform:header");

export interface TransformHeaderOptions {
  accessToken?: string;
  /**
   * When true, ensures `Content-Type: application/json` is present.
   * Useful when the request body has been re-serialised during transformation.
   */
  forceJsonContentType?: boolean;
}

function buildUserAgent(): string {
  const platform = process.platform; // "darwin", "linux", "win32", etc.
  const arch = process.arch; // "arm64", "x64", etc.
  return `QwenCode/dev (${platform}; ${arch})`;
}

/**
 * Build a normalised `Headers` object for outbound Qwen API requests.
 *
 * - Copies all headers from `input` (if provided).
 * - Sets `Authorization: Bearer <accessToken>` when an access token is given.
 * - Strips `OpenAI-Beta` and `x-session-affinity` headers that OpenCode/OpenAI
 *   SDKs may inject; Qwen's API does not recognise them and can return a 400.
 * - Optionally forces `Content-Type: application/json`.
 */
export function transformHeader(
  input: HeadersInit | Headers | undefined,
  options: TransformHeaderOptions = {},
): Headers {
  const headers = new Headers(input);

  if (options.accessToken) {
    headers.set("Authorization", `Bearer ${options.accessToken}`);
  }

  headers.delete("x-session-affinity");
  headers.delete("OpenAI-Beta");

  const ua = buildUserAgent();
  headers.set("User-Agent", ua);
  headers.set("X-DashScope-CacheControl", "enable");
  headers.set("X-DashScope-UserAgent", ua);
  headers.set("X-DashScope-AuthType", "qwen-oauth");

  if (options.forceJsonContentType) {
    headers.set("Content-Type", "application/json");
  }

  logger.verbose("Transformed headers", {
    authorization: headers.has("Authorization") ? "Bearer [redacted]" : "none",
    userAgent: ua,
  });

  return headers;
}
