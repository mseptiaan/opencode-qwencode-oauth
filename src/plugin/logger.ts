let quietMode = false;
let debugLevel = 0;

export function setLoggerQuietMode(value: boolean): void {
  quietMode = value;
}

export function setDebugLevel(level: number): void {
  debugLevel = level;
}

export function initDebugFromEnv(): void {
  const envDebug = process.env.QWEN_DEBUG;
  if (envDebug === "true" || envDebug === "1") {
    debugLevel = 1;
  } else if (envDebug === "2") {
    debugLevel = 2;
  } else if (process.env.DEBUG?.includes("qwen")) {
    debugLevel = 1;
  }
}

export function createLogger(scope: string) {
  const prefix = `[qwen-oauth:${scope}]`;
  return {
    debug: (message: string, meta?: Record<string, unknown>) => {
      if (debugLevel < 1) return;
      if (meta) {
        console.error(prefix, message, meta);
      } else {
        console.error(prefix, message);
      }
    },
    verbose: (message: string, meta?: Record<string, unknown>) => {
      if (debugLevel < 2) return;
      if (meta) {
        console.error(prefix, "[verbose]", message, meta);
      } else {
        console.error(prefix, "[verbose]", message);
      }
    },
    info: (message: string, meta?: Record<string, unknown>) => {
      if (quietMode) return;
      if (meta) {
        console.log(prefix, message, meta);
      } else {
        console.log(prefix, message);
      }
    },
    warn: (message: string, meta?: Record<string, unknown>) => {
      if (quietMode) return;
      if (meta) {
        console.warn(prefix, message, meta);
      } else {
        console.warn(prefix, message);
      }
    },
    error: (message: string, meta?: Record<string, unknown>) => {
      if (meta) {
        console.error(prefix, message, meta);
      } else {
        console.error(prefix, message);
      }
    },
  };
}

export type Logger = ReturnType<typeof createLogger>;
