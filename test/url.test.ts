import { describe, expect, it } from "bun:test";
import { applyResourceUrl, sanitizeMalformedUrl } from "../src/plugin";

describe("sanitizeMalformedUrl", () => {
  it("strips undefined/ prefix", () => {
    expect(sanitizeMalformedUrl("undefined/chat/completions")).toBe(
      "/chat/completions",
    );
  });

  it("strips null/ prefix", () => {
    expect(sanitizeMalformedUrl("null/chat/completions")).toBe(
      "/chat/completions",
    );
  });

  it("collapses undefined// to single slash", () => {
    expect(sanitizeMalformedUrl("undefined//chat/completions")).toBe(
      "/chat/completions",
    );
  });

  it("handles bare undefined", () => {
    expect(sanitizeMalformedUrl("undefined")).toBe("");
  });

  it("handles bare null", () => {
    expect(sanitizeMalformedUrl("null")).toBe("");
  });

  it("preserves normal absolute URLs", () => {
    expect(sanitizeMalformedUrl("https://api.example.com/v1/chat")).toBe(
      "https://api.example.com/v1/chat",
    );
  });

  it("preserves normal relative paths", () => {
    expect(sanitizeMalformedUrl("/v1/chat/completions")).toBe(
      "/v1/chat/completions",
    );
  });

  it("trims whitespace", () => {
    expect(sanitizeMalformedUrl("  undefined/path  ")).toBe("/path");
  });

  it("does not strip undefined in middle of path", () => {
    expect(sanitizeMalformedUrl("/api/undefined/resource")).toBe(
      "/api/undefined/resource",
    );
  });
});

describe("applyResourceUrl", () => {
  const baseUrl = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";

  it("handles undefined/path with baseUrl", () => {
    const result = applyResourceUrl("undefined/chat/completions", baseUrl);
    expect(result.url).toBe(
      "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
    );
  });

  it("handles null/path with baseUrl", () => {
    const result = applyResourceUrl("null/chat/completions", baseUrl);
    expect(result.url).toBe(
      "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
    );
  });

  it("handles undefined//path (double slash) with baseUrl", () => {
    const result = applyResourceUrl("undefined//chat/completions", baseUrl);
    expect(result.url).toBe(
      "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
    );
  });

  it("rewrites absolute URLs to use baseUrl host", () => {
    const result = applyResourceUrl("https://other.api.com/v2/chat", baseUrl);
    expect(result.url).toBe(
      "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/v2/chat",
    );
  });

  it("throws when no baseUrl and malformed input", () => {
    expect(() => applyResourceUrl("undefined/chat/completions")).toThrow();
  });

  it("handles URL object input", () => {
    const url = new URL("https://example.com/chat/completions");
    const result = applyResourceUrl(url, baseUrl);
    expect(result.url).toContain("completions");
  });

  it("handles Request object input", () => {
    const request = new Request("https://example.com/chat/completions");
    const result = applyResourceUrl(request, baseUrl);
    expect(result.url).toContain("completions");
  });
});
