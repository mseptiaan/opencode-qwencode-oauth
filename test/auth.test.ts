import { describe, expect, it } from "bun:test";
import { accessTokenExpired, isOAuthAuth } from "../src/plugin/auth";
import type { AuthDetails } from "../src/plugin/types";

const baseAuth = {
  type: "oauth" as const,
  refresh: "refresh",
  access: "access",
};

describe("accessTokenExpired", () => {
  it("treats missing expiry as expired", () => {
    expect(accessTokenExpired(baseAuth)).toBe(true);
  });

  it("returns false when expiry is in the future", () => {
    const auth = { ...baseAuth, expires: Date.now() + 10_000 };
    expect(accessTokenExpired(auth)).toBe(false);
  });

  it("uses buffer window", () => {
    const auth = { ...baseAuth, expires: Date.now() + 5_000 };
    expect(accessTokenExpired(auth, 10)).toBe(true);
  });
});

describe("isOAuthAuth", () => {
  it("accepts a normal refresh token", () => {
    const auth: AuthDetails = {
      type: "oauth",
      refresh: "real-token",
    };
    expect(isOAuthAuth(auth)).toBe(true);
  });

  it("rejects the literal string undefined", () => {
    const auth: AuthDetails = {
      type: "oauth",
      refresh: "undefined",
    };
    expect(isOAuthAuth(auth)).toBe(false);
  });

  it("rejects the literal string null", () => {
    const auth: AuthDetails = {
      type: "oauth",
      refresh: "null",
    };
    expect(isOAuthAuth(auth)).toBe(false);
  });

  it("rejects empty refresh", () => {
    const auth: AuthDetails = { type: "oauth", refresh: "" };
    expect(isOAuthAuth(auth)).toBe(false);
  });
});
