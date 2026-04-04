# OpenCode Qwen Auth Plugin

[![npm version](https://img.shields.io/npm/v/opencode-qwen-oauth.svg)](https://www.npmjs.com/package/opencode-qwen-oauth)
[![npm downloads](https://img.shields.io/npm/dm/opencode-qwen-oauth.svg)](https://www.npmjs.com/package/opencode-qwen-oauth)
[![CI](https://github.com/mseptiaan/opencode-qwen-oauth/actions/workflows/ci.yml/badge.svg)](https://github.com/mseptiaan/opencode-qwen-oauth/actions)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Built with Bun](https://img.shields.io/badge/Built%20with-Bun-black?logo=bun)](https://bun.sh)
[![Support on Ko-fi](https://img.shields.io/badge/Support-Ko--fi-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/fox445353) [![Bitcoin](https://img.shields.io/badge/Bitcoin-000000?logo=bitcoin&logoColor=white)](#-donate-crypto-addresses) [![Ethereum](https://img.shields.io/badge/Ethereum-3C3C3D?logo=ethereum&logoColor=white)](#-donate-crypto-addresses) [![USDT](https://img.shields.io/badge/USDT-26A17B?logo=tether&logoColor=white)](#-donate-crypto-addresses)

Qwen OAuth authentication plugin for [OpenCode](https://opencode.ai) with multi-account rotation, proactive token refresh, and automatic API translation.

## Features

- **Device Flow OAuth** - PKCE-secured authentication, works in headless/CI environments
- **Multi-Account Support** - Store and rotate between multiple Qwen accounts
- **Hybrid Account Rotation** - Smart selection using health scores, token bucket, and LRU
- **Proactive Token Refresh** - Automatically refresh tokens before expiry
- **Rate Limit Handling** - Detects 429 responses, rotates accounts, respects retry-after
- **API Translation** - Bridges OpenAI Responses API ↔ Chat Completions API
- **Streaming Support** - Full SSE transformation for real-time responses

## Installation

### Let an LLM Do It

Paste this into any LLM agent (Claude Code, OpenCode, Cursor, etc.):

```
Install the opencode-qwen-oauth plugin by following: https://raw.githubusercontent.com/mseptiaan/opencode-qwen-oauth/main/README.md
```

### Quick Install (Recommended)

Run one command to automatically configure OpenCode:

```bash
bunx opencode-qwen-oauth install
# or
npx opencode-qwen-oauth install
```

This adds the plugin and Qwen provider configuration to your `opencode.json`.

### Manual Installation

If you prefer manual setup:

```bash
# Using Bun
bun add opencode-qwen-oauth

# Using npm
npm install opencode-qwen-oauth
```

Then add to your `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-qwen-oauth"],
  "provider": {
    "qwen": {
      "npm": "@ai-sdk/openai",
      "options": {
        "baseURL": "https://portal.qwen.ai/v1",
        "compatibility": "strict"
      },
      "models": {
        "qwen3-coder-plus": {},
        "qwen3-vl-plus": { "attachment": true }
      }
    }
  }
}
```

## Quick Start

1. Start OpenCode in your project directory:

   ```bash
   opencode
   ```

2. Authenticate with Qwen:

   ```
   /connect
   ```

   Select **Qwen OAuth** and follow the device flow instructions.

3. Start coding with Qwen models:
   ```
   /model qwen/qwen3-coder-plus
   ```

## Configuration

**No configuration required.** The plugin works out of the box with sensible defaults.

To customize behavior, create `.opencode/qwen.json` (project) or `~/.config/opencode/qwen.json` (user-level) with only the options you want to override:

```jsonc
{
  // API endpoint (default: https://portal.qwen.ai/v1)
  "base_url": "https://portal.qwen.ai/v1",

  // OAuth client ID (default: built-in)
  "client_id": "your-client-id",

  // OAuth server URL (default: https://chat.qwen.ai)
  "oauth_base_url": "https://chat.qwen.ai",

  // Account rotation: "hybrid", "round-robin", or "sequential" (default: hybrid)
  "rotation_strategy": "hybrid",

  // Enable PID-based offset for multi-session load distribution (default: false)
  "pid_offset_enabled": false,

  // Refresh tokens before expiry (default: true)
  "proactive_refresh": true,

  // Seconds before expiry to trigger refresh (default: 300)
  "refresh_window_seconds": 300,

  // Maximum wait time when rate limited (default: 300)
  "max_rate_limit_wait_seconds": 300,

  // Suppress informational messages (default: false)
  "quiet_mode": true
}
```

### Configuration Options

| Option                        | Default                     | Description                                                      |
| ----------------------------- | --------------------------- | ---------------------------------------------------------------- |
| `base_url`                    | `https://portal.qwen.ai/v1` | API endpoint for Qwen requests                                   |
| `client_id`                   | (built-in)                  | OAuth client ID                                                  |
| `oauth_base_url`              | `https://chat.qwen.ai`      | OAuth server URL                                                 |
| `rotation_strategy`           | `hybrid`                    | Account rotation: `hybrid`, `round-robin`, or `sequential`       |
| `pid_offset_enabled`          | `false`                     | Distribute parallel sessions across accounts using PID offset    |
| `proactive_refresh`           | `true`                      | Refresh tokens before expiry                                     |
| `refresh_window_seconds`      | `300`                       | Seconds before expiry to trigger refresh                         |
| `max_rate_limit_wait_seconds` | `300`                       | Maximum wait time when rate limited                              |
| `quiet_mode`                  | `false`                     | Suppress informational messages                                  |

### Environment Variables

All options can be overridden via environment variables:

- `QWEN_API_BASE_URL`
- `QWEN_OAUTH_CLIENT_ID`
- `QWEN_OAUTH_BASE_URL`
- `QWEN_ROTATION_STRATEGY`
- `QWEN_PID_OFFSET_ENABLED`
- `QWEN_PROACTIVE_REFRESH`
- `QWEN_REFRESH_WINDOW_SECONDS`
- `QWEN_MAX_RATE_LIMIT_WAIT_SECONDS`
- `QWEN_QUIET_MODE`

## Models

### Available via OAuth

| Model              | Context Window | Features                     |
| ------------------ | -------------- | ---------------------------- |
| `qwen3-coder-plus` | 1M tokens      | Optimized for coding tasks   |
| `qwen3-vl-plus`    | 256K tokens    | Vision + language multimodal |

## Multi-Account Rotation

Add multiple accounts for higher throughput:

1. Run `/connect` and complete the first login
2. Run `/connect` again to add additional accounts
3. The plugin automatically rotates between accounts

### Rotation Strategies

- **hybrid** (default): Smart selection combining health scores, token bucket rate limiting, and LRU. Accounts recover health passively over time.
- **round-robin**: Cycles through accounts on each request
- **sequential**: Uses one account until rate limited, then switches

#### Hybrid Strategy Details

The hybrid strategy uses a weighted scoring algorithm:

- **Health Score (0-100)**: Tracks account wellness. Success rewards (+1), rate limits penalize (-10), failures penalize more (-20). Accounts passively recover +2 points/hour when rested.
- **Token Bucket**: Client-side rate limiting (50 tokens max, regenerates 6/minute) to prevent hitting server 429s.
- **LRU Freshness**: Prefers accounts that haven't been used recently.

Score formula: `(health × 2) + (tokens × 5) + (freshness × 0.1)`

Enable `pid_offset_enabled: true` when running multiple parallel sessions (e.g., oh-my-opencode) to distribute load across accounts.

## How It Works

This plugin bridges OpenCode's Responses API format with Qwen's Chat Completions API:

```
OpenCode → [Responses API] → Plugin → [Chat Completions] → Qwen
                                ↓
OpenCode ← [Responses API] ← Plugin ← [Chat Completions] ← Qwen
```

### Request Transformation

| Responses API       | Chat Completions API     |
| ------------------- | ------------------------ |
| `input`             | `messages`               |
| `input_text`        | `text` content type      |
| `input_image`       | `image_url` content type |
| `instructions`      | System message           |
| `max_output_tokens` | `max_tokens`             |

### Response Transformation (Streaming)

Converts SSE events from Chat Completions to Responses API format:

- `response.created`
- `response.output_item.added`
- `response.content_part.added`
- `response.output_text.delta`
- `response.completed`

## Storage Locations

| Data           | Location                                     |
| -------------- | -------------------------------------------- |
| User config    | `~/.config/opencode/qwen.json`               |
| Project config | `.opencode/qwen.json`                        |
| Account tokens | `~/.config/opencode/qwen-auth-accounts.json` |

**Security Note**: Tokens are stored with restricted permissions (0600). Ensure appropriate filesystem security.

## Troubleshooting

### Authentication Issues

**"invalid_grant" error**

- Your refresh token has expired. Run `/connect` to re-authenticate.

**Device code expired**

- Complete the browser login within 5 minutes of starting `/connect`.

### Rate Limiting

**Frequent 429 errors**

- Add more accounts with `/connect`
- Increase `max_rate_limit_wait_seconds` in config

### Reset Plugin State

To start fresh, delete the accounts file:

```bash
rm ~/.config/opencode/qwen-auth-accounts.json
```

## Development

This project uses [Bun](https://bun.sh) for development.

### Prerequisites

- [Bun](https://bun.sh) 1.0+ (recommended)
- Node.js 20+ (for npm compatibility)

### Getting Started

```bash
# Install dependencies
bun install

# Build
bun run build

# Run tests
bun test

# Run tests in watch mode
bun test --watch

# Run e2e test (requires authenticated Qwen account)
bun run test:e2e

# Link for local testing
bun link
```

### Using npm

The project also works with npm:

```bash
npm install
npm run build
npm test
```

## Known Limitations

- Audio input (`input_audio`) is not supported by Qwen and is converted to placeholder text

## License

Apache-2.0

## Roadmap

Planned features and improvements for future releases:

### 🔴 Next Release (v0.4.0)

| Feature | Description | Status |
|---------|-------------|--------|
| **Rate Limit Deduplication** | Ignore duplicate 429s within 2s window to prevent backoff cascades | Planned |
| **Exponential Backoff with Jitter** | Add randomness to retry delays to prevent thundering herd | Planned |
| **Schema Cleaning** | Remove unsupported JSON Schema keys (`const`, `$ref`, `$defs`) that cause API rejections | Planned |

### 🟡 Short-term (v0.5.0)

| Feature | Description | Status |
|---------|-------------|--------|
| **Circuit Breaker** | Temporarily stop requests to failing accounts after consecutive failures | Planned |
| **Proactive Health Checks** | Validate tokens before use, not just after failures | Planned |
| **CLI: Status Command** | `bunx opencode-qwen-oauth status` to show account health and token info | Planned |

### 🟢 Medium-term

| Feature | Description | Status |
|---------|-------------|--------|
| **Session Recovery** | Handle `tool_result_missing` errors from interrupted conversations | Research |
| **CLI: Uninstall Command** | Clean removal from opencode.json | Planned |
| **Configurable Retry Strategies** | User-selectable aggressive/conservative retry modes | Research |

### 🔵 Future Consideration

| Feature | Description | Status |
|---------|-------------|--------|
| **Dual Quota System** | Track separate quotas per API endpoint if Qwen supports | Research |
| **OAuth Server Fallback** | Try backup auth servers when primary fails | Research |
| **Rate Limit Prediction** | Use historical patterns to predict when limits will hit | Research |

### ✅ Completed

| Feature | Version | Description |
|---------|---------|-------------|
| CLI Installer Safety | v0.3.4 | Preview, backup, `--yes` flag for CI automation |
| Hybrid Account Rotation | v0.3.0 | Health scores, token bucket, LRU freshness |
| PID Offset | v0.3.0 | Multi-session load distribution |

---

**Want to contribute?** See [AGENTS.md](AGENTS.md) for development guidelines.
