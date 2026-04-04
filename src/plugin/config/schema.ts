import { z } from "zod";
import {
  QWEN_DEFAULT_API_BASE_URL,
  QWEN_DEFAULT_CLIENT_ID,
  QWEN_OAUTH_BASE_URL,
} from "../../constants";

export const HealthScoreConfigSchema = z.object({
  initial: z.number().min(0).max(100).default(70),
  success_reward: z.number().default(1),
  rate_limit_penalty: z.number().max(0).default(-10),
  failure_penalty: z.number().max(0).default(-20),
  recovery_rate_per_hour: z.number().min(0).default(2),
  min_usable: z.number().min(0).max(100).default(50),
});

export const TokenBucketConfigSchema = z.object({
  max_tokens: z.number().min(1).default(50),
  regeneration_rate_per_minute: z.number().min(0).default(6),
});

export const QwenConfigSchema = z.object({
  client_id: z.string().default(QWEN_DEFAULT_CLIENT_ID),
  oauth_base_url: z.string().default(QWEN_OAUTH_BASE_URL),
  base_url: z.string().default(QWEN_DEFAULT_API_BASE_URL),
  rotation_strategy: z
    .enum(["round-robin", "sequential", "hybrid"])
    .default("hybrid"),
  proactive_refresh: z.boolean().default(true),
  refresh_window_seconds: z.number().min(0).default(300),
  max_rate_limit_wait_seconds: z.number().min(0).default(300),
  quiet_mode: z.boolean().default(false),
  pid_offset_enabled: z.boolean().default(false),
  health_score: HealthScoreConfigSchema.optional(),
  token_bucket: TokenBucketConfigSchema.optional(),
});

export type HealthScorePluginConfig = z.infer<typeof HealthScoreConfigSchema>;
export type TokenBucketPluginConfig = z.infer<typeof TokenBucketConfigSchema>;
export type QwenPluginConfig = z.infer<typeof QwenConfigSchema>;
export type RotationStrategy = QwenPluginConfig["rotation_strategy"];
