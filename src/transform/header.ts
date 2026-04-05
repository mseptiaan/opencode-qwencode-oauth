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

/**
 * Build a normalised `Headers` object for outbound Qwen API requests.
 *
 * - Copies all headers from `input` (if provided).
 * - Sets `Authorization: Bearer <accessToken>` when an access token is given.
 * - Strips the `OpenAI-Beta` header that OpenCode/OpenAI SDKs may inject,
 *   because Qwen's API does not recognise it and can return a 400.
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

    headers.set("User-Agent", "QwenCode/dev (darwin; arm64)");
    headers.set("X-DashScope-CacheControl", "enable");
    headers.set("X-DashScope-UserAgent", "QwenCode/dev (darwin; arm64)");
    headers.set("X-DashScope-AuthType", "qwen-oauth");

    if (options.forceJsonContentType) {
        headers.set("Content-Type", "application/json");
    }

    logger.verbose("Transformed headers", { headers: headers });

    return headers;
}
