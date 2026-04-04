/* eslint-disable @typescript-eslint/no-explicit-any */
type JsonValue = any;

export interface TransformContext {
  responseId: string;
  itemId: string;
  createdAt: number;
}

export function createTransformContext(): TransformContext {
  return {
    responseId: `resp_${Date.now().toString(36)}`,
    itemId: `msg_${Date.now().toString(36)}`,
    createdAt: Math.floor(Date.now() / 1000),
  };
}

export function transformChatCompletionsToResponses(
  chatBody: JsonValue,
  ctx: TransformContext,
): JsonValue {
  const choice = chatBody.choices?.[0];
  const message = choice?.message;
  const content = message?.content ?? "";
  const toolCalls = message?.tool_calls;

  const outputItems: JsonValue[] = [];

  if (content) {
    outputItems.push({
      type: "message",
      id: ctx.itemId,
      status: "completed",
      role: "assistant",
      content: [{ type: "output_text", text: content, annotations: [] }],
    });
  }

  if (toolCalls && Array.isArray(toolCalls)) {
    for (const tc of toolCalls) {
      const fn = tc.function;
      outputItems.push({
        type: "function_call",
        id: tc.id ?? `call_${Date.now().toString(36)}`,
        status: "completed",
        name: fn?.name ?? "",
        arguments: fn?.arguments ?? "{}",
        call_id: tc.id,
      });
    }
  }

  const usage = chatBody.usage;

  return {
    id: ctx.responseId,
    object: "response",
    created_at: ctx.createdAt,
    status: "completed",
    model: chatBody.model ?? "qwen",
    output: outputItems,
    usage: usage
      ? {
          input_tokens: usage.prompt_tokens ?? 0,
          output_tokens: usage.completion_tokens ?? 0,
        }
      : undefined,
  };
}
