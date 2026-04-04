/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Logger } from "../plugin/logger";

type JsonValue = any;

export interface SSETransformContext {
  responseId: string;
  itemId: string;
  createdAt: number;
  logger?: Logger;
}

export function createSSETransformContext(
  logger?: Logger,
): SSETransformContext {
  return {
    responseId: `resp_${Date.now().toString(36)}`,
    itemId: `msg_${Date.now().toString(36)}`,
    createdAt: Math.floor(Date.now() / 1000),
    logger,
  };
}

interface ToolCallState {
  id: string;
  name: string;
  arguments: string;
  emittedAdded: boolean;
  outputIndex: number;
}

export function createSSETransformStream(
  ctx: SSETransformContext,
): TransformStream<Uint8Array, Uint8Array> {
  let accumulatedText = "";
  let sentCreated = false;
  let sentItemAdded = false;
  let sentContentPartAdded = false;
  let messageOutputIndex = -1;
  let inputTokens = 0;
  let outputTokens = 0;
  let modelName = "qwen";
  let buffer = "";
  let nextOutputIndex = 0;
  const toolCallStates: Map<number, ToolCallState> = new Map();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const encoder = new TextEncoder();

  const emit = (event: JsonValue): Uint8Array => {
    return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
  };

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (let line of lines) {
        line = line.replace(/\r$/, "");
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();

        if (data === "[DONE]") {
          if (accumulatedText || sentContentPartAdded) {
            controller.enqueue(
              emit({
                type: "response.output_text.done",
                item_id: ctx.itemId,
                output_index: messageOutputIndex,
                content_index: 0,
                text: accumulatedText,
              }),
            );
            controller.enqueue(
              emit({
                type: "response.content_part.done",
                item_id: ctx.itemId,
                output_index: messageOutputIndex,
                content_index: 0,
                part: {
                  type: "output_text",
                  text: accumulatedText,
                  annotations: [],
                },
              }),
            );
            controller.enqueue(
              emit({
                type: "response.output_item.done",
                output_index: messageOutputIndex,
                item: {
                  id: ctx.itemId,
                  type: "message",
                  status: "completed",
                  role: "assistant",
                  content: [{ type: "output_text", text: accumulatedText }],
                },
              }),
            );
          }

          for (const [, tcState] of toolCallStates) {
            controller.enqueue(
              emit({
                type: "response.function_call_arguments.done",
                item_id: tcState.id,
                output_index: tcState.outputIndex,
                arguments: tcState.arguments,
              }),
            );
            controller.enqueue(
              emit({
                type: "response.output_item.done",
                output_index: tcState.outputIndex,
                item: {
                  id: tcState.id,
                  type: "function_call",
                  status: "completed",
                  name: tcState.name,
                  arguments: tcState.arguments,
                  call_id: tcState.id,
                },
              }),
            );
          }

          controller.enqueue(
            emit({
              type: "response.completed",
              response: {
                id: ctx.responseId,
                object: "response",
                created_at: ctx.createdAt,
                status: "completed",
                model: modelName,
                usage: {
                  input_tokens: inputTokens,
                  output_tokens: outputTokens,
                },
              },
            }),
          );
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          continue;
        }

        try {
          const parsed = JSON.parse(data);
          if (parsed.model) modelName = parsed.model;
          const usage = parsed.usage;
          if (usage) {
            inputTokens = usage.prompt_tokens ?? inputTokens;
            outputTokens = usage.completion_tokens ?? outputTokens;
          }

          if (!sentCreated) {
            controller.enqueue(
              emit({
                type: "response.created",
                response: {
                  id: ctx.responseId,
                  object: "response",
                  created_at: ctx.createdAt,
                  status: "in_progress",
                  model: modelName,
                },
              }),
            );
            sentCreated = true;
          }

          const choices = parsed.choices;
          const delta = choices?.[0]?.delta?.content;

          if (delta !== undefined && delta !== null) {
            if (!sentItemAdded) {
              messageOutputIndex = nextOutputIndex++;
              controller.enqueue(
                emit({
                  type: "response.output_item.added",
                  output_index: messageOutputIndex,
                  item: {
                    id: ctx.itemId,
                    type: "message",
                    status: "in_progress",
                    role: "assistant",
                    content: [],
                  },
                }),
              );
              sentItemAdded = true;
            }
            if (!sentContentPartAdded) {
              controller.enqueue(
                emit({
                  type: "response.content_part.added",
                  item_id: ctx.itemId,
                  output_index: messageOutputIndex,
                  content_index: 0,
                  part: { type: "output_text", text: "", annotations: [] },
                }),
              );
              sentContentPartAdded = true;
            }
            if (delta) {
              accumulatedText += delta;
              controller.enqueue(
                emit({
                  type: "response.output_text.delta",
                  item_id: ctx.itemId,
                  output_index: messageOutputIndex,
                  content_index: 0,
                  delta: delta,
                }),
              );
            }
          }

          const toolCalls = choices?.[0]?.delta?.tool_calls;
          if (toolCalls && Array.isArray(toolCalls)) {
            for (const tc of toolCalls) {
              const tcIndex = tc.index ?? 0;
              const fn = tc.function;
              const tcId =
                tc.id ?? `call_${Date.now().toString(36)}_${tcIndex}`;

              let state = toolCallStates.get(tcIndex);
              if (!state) {
                state = {
                  id: tcId,
                  name: fn?.name ?? "",
                  arguments: "",
                  emittedAdded: false,
                  outputIndex: nextOutputIndex++,
                };
                toolCallStates.set(tcIndex, state);
              }

              if (tc.id && !state.emittedAdded) state.id = tc.id;
              if (fn?.name) state.name = fn.name;
              if (fn?.arguments) state.arguments += fn.arguments;

              if (!state.emittedAdded && state.name) {
                controller.enqueue(
                  emit({
                    type: "response.output_item.added",
                    output_index: state.outputIndex,
                    item: {
                      id: state.id,
                      type: "function_call",
                      status: "in_progress",
                      name: state.name,
                      arguments: "",
                      call_id: state.id,
                    },
                  }),
                );
                state.emittedAdded = true;
              }

              if (fn?.arguments) {
                controller.enqueue(
                  emit({
                    type: "response.function_call_arguments.delta",
                    item_id: state.id,
                    output_index: state.outputIndex,
                    delta: fn.arguments,
                  }),
                );
              }
            }
          }
        } catch {
          // Skip malformed JSON
        }
      }
    },
    flush(_controller) {
      buffer += decoder.decode();
      if (buffer.trim()) {
        ctx.logger?.verbose("Flush remaining SSE buffer", {
          length: buffer.length,
        });
      }
    },
  });
}
