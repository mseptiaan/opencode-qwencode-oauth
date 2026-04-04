import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { QwenConfigSchema, type QwenPluginConfig } from "./schema";

export interface LoadedConfig extends QwenPluginConfig {
  isExplicitStrategy: boolean;
}

function readJsonFile(path: string): Record<string, unknown> | null {
  try {
    const data = readFileSync(path, "utf-8");
    return JSON.parse(data) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getUserConfigPath(): string {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "opencode", "qwen.json");
}

function getProjectConfigPath(directory: string): string {
  return join(directory, ".opencode", "qwen.json");
}

function applyEnvOverrides(config: QwenPluginConfig): {
  config: QwenPluginConfig;
  envHasStrategy: boolean;
} {
  const overrides: Partial<QwenPluginConfig> = {};
  let envHasStrategy = false;

  if (process.env.QWEN_OAUTH_CLIENT_ID) {
    overrides.client_id = process.env.QWEN_OAUTH_CLIENT_ID;
  }
  if (process.env.QWEN_OAUTH_BASE_URL) {
    overrides.oauth_base_url = process.env.QWEN_OAUTH_BASE_URL;
  }
  if (process.env.QWEN_API_BASE_URL) {
    overrides.base_url = process.env.QWEN_API_BASE_URL;
  }
  if (process.env.QWEN_ROTATION_STRATEGY) {
    const strategy = process.env.QWEN_ROTATION_STRATEGY;
    if (
      strategy === "round-robin" ||
      strategy === "sequential" ||
      strategy === "hybrid"
    ) {
      overrides.rotation_strategy = strategy;
      envHasStrategy = true;
    }
  }
  if (process.env.QWEN_PROACTIVE_REFRESH) {
    overrides.proactive_refresh = process.env.QWEN_PROACTIVE_REFRESH === "true";
  }
  if (process.env.QWEN_REFRESH_WINDOW_SECONDS) {
    const value = Number(process.env.QWEN_REFRESH_WINDOW_SECONDS);
    if (Number.isFinite(value)) {
      overrides.refresh_window_seconds = value;
    }
  }
  if (process.env.QWEN_MAX_RATE_LIMIT_WAIT_SECONDS) {
    const value = Number(process.env.QWEN_MAX_RATE_LIMIT_WAIT_SECONDS);
    if (Number.isFinite(value)) {
      overrides.max_rate_limit_wait_seconds = value;
    }
  }
  if (process.env.QWEN_QUIET_MODE) {
    overrides.quiet_mode = process.env.QWEN_QUIET_MODE === "true";
  }
  if (process.env.QWEN_PID_OFFSET_ENABLED) {
    overrides.pid_offset_enabled =
      process.env.QWEN_PID_OFFSET_ENABLED === "true" ||
      process.env.QWEN_PID_OFFSET_ENABLED === "1";
  }

  return {
    config: QwenConfigSchema.parse({ ...config, ...overrides }),
    envHasStrategy,
  };
}

export function loadConfig(directory: string): LoadedConfig {
  const defaults = QwenConfigSchema.parse({});
  const userConfig = readJsonFile(getUserConfigPath());
  const projectConfig = readJsonFile(getProjectConfigPath(directory));

  const rawHasStrategy =
    userConfig?.rotation_strategy !== undefined ||
    projectConfig?.rotation_strategy !== undefined;

  const merged = QwenConfigSchema.parse({
    ...defaults,
    ...(userConfig ?? {}),
    ...(projectConfig ?? {}),
  });

  const { config, envHasStrategy } = applyEnvOverrides(merged);

  return {
    ...config,
    isExplicitStrategy: rawHasStrategy || envHasStrategy,
  };
}
