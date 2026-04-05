/* eslint-disable @typescript-eslint/no-explicit-any */
import { createLogger } from "../plugin/logger";

type JsonValue = any;

const logger = createLogger("transform");

function asImageUrlObject(part: JsonValue): { url: string } | null {
  const imageUrl = part?.image_url ?? part?.url;
  if (typeof imageUrl === "string") return { url: imageUrl };
  if (
    imageUrl &&
    typeof imageUrl === "object" &&
    typeof imageUrl.url === "string"
  ) {
    return { url: imageUrl.url };
  }
  return null;
}

function mapContentPart(part: JsonValue): JsonValue | null {
  if (!part || typeof part !== "object") return part;

  switch (part.type) {
    case "input_text":
    case "output_text":
      return { type: "text", text: String(part.text ?? "") };

    case "input_image": {
      const urlObj = asImageUrlObject(part);
      if (!urlObj) return null;
      return { type: "image_url", image_url: urlObj };
    }

    case "input_audio":
      return {
        type: "text",
        text: "[audio omitted: provider does not support input_audio]",
      };

    default:
      return part;
  }
}

function mapMessage(msg: JsonValue): JsonValue {
  const role = msg.role === "developer" ? "system" : msg.role;

  if (typeof msg.content === "string") {
    return { ...msg, role };
  }

  if (Array.isArray(msg.content)) {
    const mapped = msg.content.map(mapContentPart).filter(Boolean);
    return { ...msg, role, content: mapped.length ? mapped : "" };
  }

  return { ...msg, role };
}

export function transformResponsesToChatCompletions(
  body: JsonValue,
): JsonValue {
  const result = { ...body };

  if (result.input && !result.messages) {
    result.messages = Array.isArray(result.input)
      ? [...result.input]
      : result.input;
    delete result.input;
  }

  if (typeof result.messages === "string") {
    result.messages = [{ role: "user", content: result.messages }];
  }

  if (result.instructions) {
    result.messages = [
      { role: "system", content: String(result.instructions) },
      ...(Array.isArray(result.messages) ? result.messages : []),
    ];
    delete result.instructions;
  }

  if (Array.isArray(result.messages)) {
    result.messages = result.messages.flatMap((item: JsonValue) => {
      if (item && typeof item === "object" && "role" in item) {
        return [mapMessage(item)];
      }
      if (item?.type === "function_call_output") {
        return [
          {
            role: "tool",
            tool_call_id: item.call_id ?? item.id ?? "unknown",
            content:
              typeof item.output === "string"
                ? item.output
                : JSON.stringify(item.output ?? {}),
          },
        ];
      }
      return [];
    });
  }

  if (result.max_output_tokens && !result.max_tokens) {
    result.max_tokens = result.max_output_tokens;
    delete result.max_output_tokens;
  }

  if (result.text?.format && !result.response_format) {
    result.response_format = result.text.format;
    const { format, ...restText } = result.text;
    result.text = Object.keys(restText).length ? restText : undefined;
    if (!result.text) delete result.text;
  }

  if (Array.isArray(result.tools)) {
    result.tools = result.tools.map((tool: JsonValue) => {
      if (tool.type === "function" && tool.name && !tool.function) {
        const { type, name, description, parameters, strict, ...rest } = tool;
        return {
          type: "function",
          function: { name, description, parameters, strict },
          ...rest,
        };
      }
      return tool;
    });
  }

  result.stream_options = {
    include_usage: true,
  };

  let sessionId: string;
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    sessionId = crypto.randomUUID();
  } else {
    sessionId = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0,
        v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
  const promptId = sessionId + "########" + sessionId[sessionId.length - 1];

  result.metadata = {
    sessionId: sessionId,
    promptId: promptId,
  };
  result.vl_high_resolution_images = true;

  delete result.store;
  delete result.include;
  delete result.previous_response_id;
  delete result.tool_choice;

  logger.debug("Transformed request", { body: result });

  return result;
}
