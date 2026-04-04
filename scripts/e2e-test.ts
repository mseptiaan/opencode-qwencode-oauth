#!/usr/bin/env bun
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { $ } from "bun";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");

const model = process.argv[2] ?? "qwen/qwen3-coder-plus";
const testFile = resolve(PROJECT_ROOT, "test-output.txt");

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

console.log(bold("=== OpenCode Qwen Auth E2E Test ==="));
console.log(`Model: ${model}`);
console.log(`Test file: ${testFile}`);
console.log();

if (existsSync(testFile)) {
  unlinkSync(testFile);
}

console.log("Building plugin...");
const buildResult = await $`bun run build`.cwd(PROJECT_ROOT).nothrow();
if (buildResult.exitCode !== 0) {
  console.log(red("Build failed!"));
  process.exit(1);
}

console.log();
console.log("Running opencode with Qwen model...");

const result =
  await $`opencode run "Write 'hello world' to the file ${testFile}. Just write the text, nothing else." --model=${model}`
    .cwd(PROJECT_ROOT)
    .env({ ...process.env, QWEN_DEBUG: "1" })
    .nothrow();

if (result.exitCode !== 0) {
  console.log();
  console.log(red(`Command failed with exit code ${result.exitCode}`));
  process.exit(1);
}

console.log();
console.log("Command completed successfully.");
console.log();
console.log("Verifying output...");

if (!existsSync(testFile)) {
  console.log();
  console.log(red("❌ E2E test FAILED: Test file was not created"));
  process.exit(1);
}

const content = readFileSync(testFile, "utf-8");
console.log(`File content: '${content}'`);

if (content.toLowerCase().includes("hello world")) {
  console.log();
  console.log(green("✅ E2E test PASSED!"));
  console.log("The plugin successfully:");
  console.log("  1. Authenticated with Qwen OAuth");
  console.log("  2. Transformed Responses API -> Chat Completions API");
  console.log("  3. Received and transformed the response");
  console.log("  4. Completed the task");
  unlinkSync(testFile);
  process.exit(0);
} else {
  console.log();
  console.log(
    red("❌ E2E test FAILED: File content does not contain 'hello world'"),
  );
  unlinkSync(testFile);
  process.exit(1);
}
