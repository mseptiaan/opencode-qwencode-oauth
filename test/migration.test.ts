import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/plugin/config";

describe("migration behavior", () => {
  let testDir: string;
  let savedXdgConfigHome: string | undefined;

  beforeEach(() => {
    savedXdgConfigHome = process.env.XDG_CONFIG_HOME;
    testDir = join(tmpdir(), `qwen-migration-test-${Date.now()}`);
    mkdirSync(join(testDir, ".opencode"), { recursive: true });
    mkdirSync(join(testDir, "config", "opencode"), { recursive: true });
    process.env.XDG_CONFIG_HOME = join(testDir, "config");
  });

  afterEach(() => {
    if (savedXdgConfigHome !== undefined) {
      process.env.XDG_CONFIG_HOME = savedXdgConfigHome;
    } else {
      delete process.env.XDG_CONFIG_HOME;
    }
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("isExplicitStrategy detection", () => {
    it("returns false when no config file exists", () => {
      const config = loadConfig(testDir);
      expect(config.isExplicitStrategy).toBe(false);
      expect(config.rotation_strategy).toBe("hybrid");
    });

    it("returns false when config exists but no rotation_strategy set", () => {
      writeFileSync(
        join(testDir, ".opencode", "qwen.json"),
        JSON.stringify({ quiet_mode: true }),
      );
      const config = loadConfig(testDir);
      expect(config.isExplicitStrategy).toBe(false);
      expect(config.rotation_strategy).toBe("hybrid");
    });

    it("returns true when rotation_strategy is explicitly set to hybrid", () => {
      writeFileSync(
        join(testDir, ".opencode", "qwen.json"),
        JSON.stringify({ rotation_strategy: "hybrid" }),
      );
      const config = loadConfig(testDir);
      expect(config.isExplicitStrategy).toBe(true);
      expect(config.rotation_strategy).toBe("hybrid");
    });

    it("returns true when rotation_strategy is explicitly set to round-robin", () => {
      writeFileSync(
        join(testDir, ".opencode", "qwen.json"),
        JSON.stringify({ rotation_strategy: "round-robin" }),
      );
      const config = loadConfig(testDir);
      expect(config.isExplicitStrategy).toBe(true);
      expect(config.rotation_strategy).toBe("round-robin");
    });

    it("returns true when rotation_strategy is explicitly set to sequential", () => {
      writeFileSync(
        join(testDir, ".opencode", "qwen.json"),
        JSON.stringify({ rotation_strategy: "sequential" }),
      );
      const config = loadConfig(testDir);
      expect(config.isExplicitStrategy).toBe(true);
      expect(config.rotation_strategy).toBe("sequential");
    });
  });

  describe("environment variable override", () => {
    const originalEnv = process.env.QWEN_ROTATION_STRATEGY;

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.QWEN_ROTATION_STRATEGY;
      } else {
        process.env.QWEN_ROTATION_STRATEGY = originalEnv;
      }
    });

    it("marks strategy as explicit when set via env var", () => {
      process.env.QWEN_ROTATION_STRATEGY = "round-robin";
      const config = loadConfig(testDir);
      expect(config.isExplicitStrategy).toBe(true);
      expect(config.rotation_strategy).toBe("round-robin");
    });

    it("env var overrides config file", () => {
      writeFileSync(
        join(testDir, ".opencode", "qwen.json"),
        JSON.stringify({ rotation_strategy: "sequential" }),
      );
      process.env.QWEN_ROTATION_STRATEGY = "round-robin";
      const config = loadConfig(testDir);
      expect(config.rotation_strategy).toBe("round-robin");
      expect(config.isExplicitStrategy).toBe(true);
    });
  });

  describe("default strategy behavior", () => {
    it("defaults to hybrid for new users", () => {
      const config = loadConfig(testDir);
      expect(config.rotation_strategy).toBe("hybrid");
    });

    it("preserves round-robin for users who explicitly set it", () => {
      writeFileSync(
        join(testDir, ".opencode", "qwen.json"),
        JSON.stringify({ rotation_strategy: "round-robin" }),
      );
      const config = loadConfig(testDir);
      expect(config.rotation_strategy).toBe("round-robin");
    });
  });
});
