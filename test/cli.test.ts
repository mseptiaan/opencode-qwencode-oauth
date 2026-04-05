import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { install, installWithPrompt } from "../src/cli/install";

describe("CLI installer", () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `opencode-qwen-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    originalCwd = process.cwd();
    process.chdir(testDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("install()", () => {
    it("should create opencode.json if it doesn't exist", () => {
      const result = install();

      expect(result.success).toBe(true);
      expect(result.alreadyInstalled).toBe(false);
      expect(existsSync(result.configPath)).toBe(true);

      const config = JSON.parse(readFileSync(result.configPath, "utf-8"));
      expect(config.$schema).toBe("https://opencode.ai/config.json");
      expect(config.plugin).toContain("opencode-qwencode-oauth");
      expect(config.provider.qwen).toBeDefined();
    });

    it("should add plugin to existing opencode.json", () => {
      const existingConfig = {
        $schema: "https://opencode.ai/config.json",
        someOtherSetting: true,
      };
      writeFileSync(
        join(testDir, "opencode.json"),
        JSON.stringify(existingConfig, null, 2),
      );

      const result = install();

      expect(result.success).toBe(true);
      expect(result.alreadyInstalled).toBe(false);

      const config = JSON.parse(readFileSync(result.configPath, "utf-8"));
      expect(config.someOtherSetting).toBe(true);
      expect(config.plugin).toContain("opencode-qwencode-oauth");
      expect(config.provider.qwen).toBeDefined();
    });

    it("should create timestamped backup before modifying config", () => {
      const existingConfig = {
        $schema: "https://opencode.ai/config.json",
        someOtherSetting: true,
      };
      writeFileSync(
        join(testDir, "opencode.json"),
        JSON.stringify(existingConfig, null, 2),
      );

      const result = install();

      expect(result.success).toBe(true);
      const files = readdirSync(testDir);
      const backups = files.filter((file) =>
        /^opencode\.json\.\d{8}-\d{6}\.bak$/.test(file),
      );
      expect(backups.length).toBeGreaterThanOrEqual(1);
    });

    it("should preserve existing plugins", () => {
      const existingConfig = {
        $schema: "https://opencode.ai/config.json",
        plugin: ["some-other-plugin"],
      };
      writeFileSync(
        join(testDir, "opencode.json"),
        JSON.stringify(existingConfig, null, 2),
      );

      const result = install();

      const config = JSON.parse(readFileSync(result.configPath, "utf-8"));
      expect(config.plugin).toContain("some-other-plugin");
      expect(config.plugin).toContain("opencode-qwencode-oauth");
      expect(config.plugin.length).toBe(2);
    });

    it("should not duplicate plugin if already installed", () => {
      const existingConfig = {
        $schema: "https://opencode.ai/config.json",
        plugin: ["opencode-qwencode-oauth"],
        provider: {
          qwen: {
            npm: "@ai-sdk/openai",
            options: { baseURL: "https://portal.qwen.ai/v1" },
            models: {},
          },
        },
      };
      writeFileSync(
        join(testDir, "opencode.json"),
        JSON.stringify(existingConfig, null, 2),
      );

      const result = install();

      expect(result.success).toBe(true);
      expect(result.alreadyInstalled).toBe(true);

      const config = JSON.parse(readFileSync(result.configPath, "utf-8"));
      expect(
        config.plugin.filter((p: string) => p === "opencode-qwencode-oauth").length,
      ).toBe(1);
    });

    it("should detect versioned plugin as already installed", () => {
      const existingConfig = {
        $schema: "https://opencode.ai/config.json",
        plugin: ["opencode-qwencode-oauth@1.0.0"],
        provider: {
          qwen: { npm: "@ai-sdk/openai" },
        },
      };
      writeFileSync(
        join(testDir, "opencode.json"),
        JSON.stringify(existingConfig, null, 2),
      );

      const result = install();

      expect(result.alreadyInstalled).toBe(true);
    });

    it("should preserve existing provider config", () => {
      const existingConfig = {
        $schema: "https://opencode.ai/config.json",
        provider: {
          openai: { apiKey: "test" },
        },
      };
      writeFileSync(
        join(testDir, "opencode.json"),
        JSON.stringify(existingConfig, null, 2),
      );

      const result = install();

      const config = JSON.parse(readFileSync(result.configPath, "utf-8"));
      expect(config.provider.openai).toBeDefined();
      expect(config.provider.openai.apiKey).toBe("test");
      expect(config.provider.qwen).toBeDefined();
    });

    it("should not overwrite existing qwen provider", () => {
      const existingConfig = {
        $schema: "https://opencode.ai/config.json",
        plugin: ["opencode-qwencode-oauth"],
        provider: {
          qwen: {
            npm: "@ai-sdk/openai",
            customOption: true,
          },
        },
      };
      writeFileSync(
        join(testDir, "opencode.json"),
        JSON.stringify(existingConfig, null, 2),
      );

      const result = install();

      const config = JSON.parse(readFileSync(result.configPath, "utf-8"));
      expect(config.provider.qwen.customOption).toBe(true);
    });

    it("should find config in .opencode directory", () => {
      mkdirSync(join(testDir, ".opencode"), { recursive: true });
      const existingConfig = { someOtherSetting: true };
      writeFileSync(
        join(testDir, ".opencode", "opencode.json"),
        JSON.stringify(existingConfig, null, 2),
      );

      const result = install();

      expect(result.configPath).toContain(".opencode");
      expect(result.configPath).toContain("opencode.json");
      const config = JSON.parse(readFileSync(result.configPath, "utf-8"));
      expect(config.someOtherSetting).toBe(true);
      expect(config.plugin).toContain("opencode-qwencode-oauth");
    });

    it("should add correct provider config", () => {
      const result = install();

      const config = JSON.parse(readFileSync(result.configPath, "utf-8"));
      expect(config.provider.qwen.npm).toBe("@ai-sdk/openai");
      expect(config.provider.qwen.options.baseURL).toBe(
        "https://portal.qwen.ai/v1",
      );
      expect(config.provider.qwen.options.compatibility).toBe("strict");
      expect(config.provider.qwen.models["coder-model"]).toBeDefined();
      expect(config.provider.qwen.models["coder-model"].limit.context).toBe(
        1048576,
      );
      expect(config.provider.qwen.models["coder-model"].attachment).toBe(true);
    });

    it("should complete without prompting when skipPrompt is true", async () => {
      const result = await installWithPrompt({
        global: false,
        skipPrompt: true,
      });

      expect(result.success).toBe(true);
      expect(existsSync(result.configPath)).toBe(true);
    });
  });
});
