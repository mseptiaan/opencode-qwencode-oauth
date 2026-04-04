type BunServer = ReturnType<typeof Bun.serve>;

export interface MockServerConfig {
  port: number;
  rateLimitAfter?: number;
  refreshTokenBehavior?: "success" | "fail" | "expire";
  streamingChunkDelay?: number;
  splitChunks?: boolean;
}

export interface MockServerState {
  requestCount: number;
  rateLimitedAccounts: Set<string>;
  tokenRefreshCount: number;
  lastRequest?: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: unknown;
  };
}

const defaultConfig: MockServerConfig = {
  port: 3456,
  rateLimitAfter: 0,
  refreshTokenBehavior: "success",
  streamingChunkDelay: 10,
  splitChunks: false,
};

export function createMockServer(
  configOverrides: Partial<MockServerConfig> = {},
) {
  const config = { ...defaultConfig, ...configOverrides };
  const state: MockServerState = {
    requestCount: 0,
    rateLimitedAccounts: new Set(),
    tokenRefreshCount: 0,
  };

  let server: BunServer | null = null;

  const handlers: Record<
    string,
    (req: Request) => Response | Promise<Response>
  > = {
    "/oauth/device/code": handleDeviceCode,
    "/oauth/token": handleToken,
    "/v1/chat/completions": handleChatCompletions,
    "/chat/completions": handleChatCompletions,
    "/compatible-mode/v1/chat/completions": handleChatCompletions,
  };

  function handleDeviceCode(_req: Request): Response {
    return Response.json({
      device_code: "mock-device-code-123",
      user_code: "MOCK-1234",
      verification_uri: "https://mock.qwen.ai/activate",
      verification_uri_complete:
        "https://mock.qwen.ai/activate?user_code=MOCK-1234",
      expires_in: 600,
      interval: 5,
    });
  }

  function handleToken(_req: Request): Response {
    state.tokenRefreshCount++;

    if (config.refreshTokenBehavior === "fail") {
      return Response.json({ error: "invalid_grant" }, { status: 400 });
    }

    if (config.refreshTokenBehavior === "expire") {
      return Response.json({
        access_token: "mock-access-expired",
        token_type: "Bearer",
        expires_in: 1,
        refresh_token: "mock-refresh-new",
        resource_url: `http://localhost:${config.port}`,
      });
    }

    return Response.json({
      access_token: "mock-access-new",
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: "mock-refresh-new",
      resource_url: `http://localhost:${config.port}`,
    });
  }

  async function handleChatCompletions(req: Request): Promise<Response> {
    state.requestCount++;

    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");

    if (config.rateLimitAfter && state.requestCount > config.rateLimitAfter) {
      if (!state.rateLimitedAccounts.has(token)) {
        state.rateLimitedAccounts.add(token);
        return new Response(JSON.stringify({ error: "rate_limit_exceeded" }), {
          status: 429,
          headers: { "Retry-After": "60" },
        });
      }
    }

    const responseId = `chatcmpl-mock-${Date.now()}`;

    let shouldStream = false;
    try {
      const body = await req.clone().json();
      shouldStream = body?.stream === true;
    } catch {
      shouldStream = false;
    }

    if (shouldStream) {
      return createStreamingResponse(responseId, config);
    }

    return Response.json({
      id: responseId,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "qwen3-coder-plus",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "Mock response from Qwen server",
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      },
    });
  }

  function createStreamingResponse(
    responseId: string,
    config: MockServerConfig,
  ): Response {
    const chunks = [
      `data: {"id":"${responseId}","object":"chat.completion.chunk","created":${Math.floor(Date.now() / 1000)},"model":"qwen3-coder-plus","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}\n\n`,
      `data: {"id":"${responseId}","object":"chat.completion.chunk","created":${Math.floor(Date.now() / 1000)},"model":"qwen3-coder-plus","choices":[{"index":0,"delta":{"content":"Mock"},"finish_reason":null}]}\n\n`,
      `data: {"id":"${responseId}","object":"chat.completion.chunk","created":${Math.floor(Date.now() / 1000)},"model":"qwen3-coder-plus","choices":[{"index":0,"delta":{"content":" response"},"finish_reason":null}]}\n\n`,
      `data: {"id":"${responseId}","object":"chat.completion.chunk","created":${Math.floor(Date.now() / 1000)},"model":"qwen3-coder-plus","choices":[{"index":0,"delta":{"content":" from"},"finish_reason":null}]}\n\n`,
      `data: {"id":"${responseId}","object":"chat.completion.chunk","created":${Math.floor(Date.now() / 1000)},"model":"qwen3-coder-plus","choices":[{"index":0,"delta":{"content":" Qwen"},"finish_reason":null}]}\n\n`,
      `data: {"id":"${responseId}","object":"chat.completion.chunk","created":${Math.floor(Date.now() / 1000)},"model":"qwen3-coder-plus","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n`,
      `data: [DONE]\n\n`,
    ];

    if (config.splitChunks) {
      const splitChunks: string[] = [];
      for (const chunk of chunks) {
        const mid = Math.floor(chunk.length / 2);
        splitChunks.push(chunk.slice(0, mid));
        splitChunks.push(chunk.slice(mid));
      }
      chunks.length = 0;
      chunks.push(...splitChunks);
    }

    const encoder = new TextEncoder();
    let chunkIndex = 0;

    const stream = new ReadableStream({
      async pull(controller) {
        if (chunkIndex >= chunks.length) {
          controller.close();
          return;
        }

        await new Promise((resolve) =>
          setTimeout(resolve, config.streamingChunkDelay),
        );
        controller.enqueue(encoder.encode(chunks[chunkIndex]));
        chunkIndex++;
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  async function handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const pathname = url.pathname;

    state.lastRequest = {
      url: req.url,
      method: req.method,
      headers: {} as Record<string, string>,
      body:
        req.method !== "GET"
          ? await req
              .clone()
              .json()
              .catch(() => null)
          : undefined,
    };

    for (const [path, handler] of Object.entries(handlers)) {
      if (pathname.endsWith(path) || pathname === path) {
        return handler(req);
      }
    }

    return new Response("Not Found", { status: 404 });
  }

  return {
    config,
    state,

    start(): BunServer {
      server = Bun.serve({
        port: config.port,
        fetch: handleRequest,
      });
      return server;
    },

    stop() {
      server?.stop();
      server = null;
    },

    reset() {
      state.requestCount = 0;
      state.rateLimitedAccounts.clear();
      state.tokenRefreshCount = 0;
      state.lastRequest = undefined;
    },

    setRateLimitAfter(n: number) {
      config.rateLimitAfter = n;
    },

    setRefreshBehavior(behavior: "success" | "fail" | "expire") {
      config.refreshTokenBehavior = behavior;
    },

    enableChunkSplitting(enabled: boolean) {
      config.splitChunks = enabled;
    },
  };
}
