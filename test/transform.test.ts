import { describe, expect, it } from "bun:test";
import { transformResponsesToChatCompletions } from "../src/transform/request";
import {
  createTransformContext,
  transformChatCompletionsToResponses,
} from "../src/transform/response";

describe("Request Transformation", () => {
  it("transforms input to messages", () => {
    const input = { input: "Hello", model: "test" };
    const result = transformResponsesToChatCompletions(input);
    expect(result.messages).toEqual([{ role: "user", content: "Hello" }]);
    expect(result.input).toBeUndefined();
  });

  it("transforms input_text to text content", () => {
    const input = {
      messages: [
        {
          role: "user",
          content: [{ type: "input_text", text: "Hello" }],
        },
      ],
    };
    const result = transformResponsesToChatCompletions(input);
    expect(result.messages[0].content).toEqual([
      { type: "text", text: "Hello" },
    ]);
  });

  it("transforms input_image to image_url", () => {
    const input = {
      messages: [
        {
          role: "user",
          content: [
            { type: "input_image", url: "https://example.com/img.png" },
          ],
        },
      ],
    };
    const result = transformResponsesToChatCompletions(input);
    expect(result.messages[0].content).toEqual([
      { type: "image_url", image_url: { url: "https://example.com/img.png" } },
    ]);
  });

  it("handles instructions as system message", () => {
    const input = {
      instructions: "Be helpful",
      messages: [{ role: "user", content: "Hi" }],
    };
    const result = transformResponsesToChatCompletions(input);
    expect(result.messages[0]).toEqual({
      role: "system",
      content: "Be helpful",
    });
    expect(result.messages[1]).toEqual({ role: "user", content: "Hi" });
    expect(result.instructions).toBeUndefined();
  });

  it("transforms tools schema", () => {
    const input = {
      tools: [
        {
          type: "function",
          name: "get_weather",
          description: "Get weather",
          parameters: { type: "object", properties: {} },
        },
      ],
    };
    const result = transformResponsesToChatCompletions(input);
    expect(result.tools[0]).toEqual({
      type: "function",
      function: {
        name: "get_weather",
        description: "Get weather",
        parameters: { type: "object", properties: {} },
        strict: undefined,
      },
    });
  });

  it("handles function_call_output", () => {
    const input = {
      messages: [
        { role: "user", content: "Call a function" },
        {
          type: "function_call_output",
          call_id: "call_123",
          output: '{"result": "ok"}',
        },
      ],
    };
    const result = transformResponsesToChatCompletions(input);
    expect(result.messages[1]).toEqual({
      role: "tool",
      tool_call_id: "call_123",
      content: '{"result": "ok"}',
    });
  });

  it("transforms max_output_tokens to max_tokens", () => {
    const input = { max_output_tokens: 1000, messages: [] };
    const result = transformResponsesToChatCompletions(input);
    expect(result.max_tokens).toBe(1000);
    expect(result.max_output_tokens).toBeUndefined();
  });

  it("removes Responses API specific fields", () => {
    const input = {
      messages: [],
      store: true,
      include: ["usage"],
      previous_response_id: "resp_123",
    };
    const result = transformResponsesToChatCompletions(input);
    expect(result.store).toBeUndefined();
    expect(result.include).toBeUndefined();
    expect(result.previous_response_id).toBeUndefined();
  });
});

describe("Response Transformation", () => {
  it("transforms basic text response", () => {
    const ctx = createTransformContext();
    const chatResponse = {
      choices: [{ message: { role: "assistant", content: "Hello!" } }],
      model: "qwen-test",
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    };
    const result = transformChatCompletionsToResponses(chatResponse, ctx);

    expect(result.id).toBe(ctx.responseId);
    expect(result.status).toBe("completed");
    expect(result.model).toBe("qwen-test");
    expect(result.output[0].content[0].text).toBe("Hello!");
    expect(result.usage).toEqual({ input_tokens: 10, output_tokens: 5 });
  });

  it("transforms tool calls", () => {
    const ctx = createTransformContext();
    const chatResponse = {
      choices: [
        {
          message: {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call_abc",
                function: {
                  name: "get_weather",
                  arguments: '{"location":"NYC"}',
                },
              },
            ],
          },
        },
      ],
    };
    const result = transformChatCompletionsToResponses(chatResponse, ctx);

    expect(result.output[0].type).toBe("function_call");
    expect(result.output[0].name).toBe("get_weather");
    expect(result.output[0].arguments).toBe('{"location":"NYC"}');
  });
});
