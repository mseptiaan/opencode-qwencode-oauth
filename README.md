# OpenCode Qwen Auth Plugin

[![npm version](https://img.shields.io/npm/v/opencode-qwencode-oauth.svg)](https://www.npmjs.com/package/opencode-qwencode-oauth)
[![npm downloads](https://img.shields.io/npm/dm/opencode-qwencode-oauth.svg)](https://www.npmjs.com/package/opencode-qwencode-oauth)
[![CI](https://github.com/mseptiaan/opencode-qwencode-oauth/actions/workflows/ci.yml/badge.svg)](https://github.com/mseptiaan/opencode-qwencode-oauth/actions)
[![License: MIT](https://img.shields.io/github/license/mseptiaan/opencode-qwencode-oauth)](LICENSE)
[![Built with Bun](https://img.shields.io/badge/Built%20with-Bun-black?logo=bun)](https://bun.sh)

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
Install the opencode-qwencode-oauth plugin by following: https://raw.githubusercontent.com/mseptiaan/opencode-qwencode-oauth/main/README.md
```

### Quick Install (Recommended)

Add to your `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-qwencode-oauth"],
  "provider": {
    "qwen": {
      "npm": "@ai-sdk/openai",
      "options": {
        "baseURL": "https://portal.qwen.ai/v1",
        "compatibility": "strict"
      },
      "models": {
        "coder-model": {
          "id": "coder-model",
          "name": "Qwen Coder",
          "limit": {
            "context": 1048576,
            "output": 65536
          },
          "modalities": {
            "input": [
              "text",
              "image"
            ],
            "output": [
              "text"
            ]
          },
          "attachment": true
        }
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

   Select **Qwen OAuth** or **qwen** and follow the device flow instructions.

3. Start coding with Qwen models:
   ```
   /model qwen/coder-model
   ```

## Configuration

**No configuration required.** The plugin works out of the box with sensible defaults.

## Models

### Available via OAuth

| Model              | Context Window | Features                     |
| ------------------ | -------------- | ---------------------------- |
| `coder-model` | 1M tokens      | Last qwen model   |

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

MIT

---

**Want to contribute?** See [AGENTS.md](AGENTS.md) for development guidelines.
