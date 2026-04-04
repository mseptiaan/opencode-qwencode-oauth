import { describe, expect, it } from "bun:test";
import { accessTokenExpired } from "../src/plugin/auth";

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
