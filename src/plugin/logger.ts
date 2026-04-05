import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

let quietMode = false;
let debugLevel = 0;
let logFileStream: fs.WriteStream | null = null;

function getLogFilePath(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hour = String(now.getHours()).padStart(2, "0");
  const fileName = `${year}${month}${day}${hour}.log`;
  const logDir = path.join(
    os.homedir(),
    ".local",
    "share",
    "opencode",
    "log",
    "opencode-qwen-auth",
  );
  return path.join(logDir, fileName);
}

function getLogStream(): fs.WriteStream {
  const filePath = getLogFilePath();
  const logDir = path.dirname(filePath);

  if (!logFileStream) {
    fs.mkdirSync(logDir, { recursive: true });
    logFileStream = fs.createWriteStream(filePath, { flags: "a" });
  } else {
    // Rotate if the file path (hour) has changed
    const currentPath = (logFileStream as fs.WriteStream & { path: string })
      .path;
    if (currentPath !== filePath) {
      logFileStream.end();
      fs.mkdirSync(logDir, { recursive: true });
      logFileStream = fs.createWriteStream(filePath, { flags: "a" });
    }
  }

  return logFileStream;
}

function writeToFile(level: string, prefix: string, message: string, meta?: Record<string, unknown>): void {
  try {
    const stream = getLogStream();
    const timestamp = new Date().toISOString();
    const line = meta
      ? `${timestamp} ${level} ${prefix} ${message} ${JSON.stringify(meta)}\n`
      : `${timestamp} ${level} ${prefix} ${message}\n`;
    stream.write(line);
  } catch {
    // Silently ignore file write errors to not disrupt the plugin
  }
}

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
      writeToFile("DEBUG  ", prefix, message, meta);
      if (meta) {
        console.error(prefix, message, meta);
      } else {
        console.error(prefix, message);
      }
    },
    verbose: (message: string, meta?: Record<string, unknown>) => {
      if (debugLevel < 2) return;
      writeToFile("VERBOSE", prefix, `[verbose] ${message}`, meta);
      if (meta) {
        console.error(prefix, "[verbose]", message, meta);
      } else {
        console.error(prefix, "[verbose]", message);
      }
    },
    info: (message: string, meta?: Record<string, unknown>) => {
      writeToFile("INFO   ", prefix, message, meta);
      if (quietMode) return;
      if (meta) {
        console.log(prefix, message, meta);
      } else {
        console.log(prefix, message);
      }
    },
    warn: (message: string, meta?: Record<string, unknown>) => {
      writeToFile("WARN   ", prefix, message, meta);
      if (quietMode) return;
      if (meta) {
        console.warn(prefix, message, meta);
      } else {
        console.warn(prefix, message);
      }
    },
    error: (message: string, meta?: Record<string, unknown>) => {
      writeToFile("ERROR  ", prefix, message, meta);
      if (meta) {
        console.error(prefix, message, meta);
      } else {
        console.error(prefix, message);
      }
    },
  };
}

export type Logger = ReturnType<typeof createLogger>;
