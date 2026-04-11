# OpenCode Qwen Auth Plugin

[![npm version](https://img.shields.io/npm/v/opencode-qwencode-oauth.svg)](https://www.npmjs.com/package/opencode-qwencode-oauth)
[![npm downloads](https://img.shields.io/npm/dm/opencode-qwencode-oauth.svg)](https://www.npmjs.com/package/opencode-qwencode-oauth)
[![CI](https://github.com/mseptiaan/opencode-qwencode-oauth/actions/workflows/ci.yml/badge.svg)](https://github.com/mseptiaan/opencode-qwencode-oauth/actions)
[![License: MIT](https://img.shields.io/github/license/mseptiaan/opencode-qwencode-oauth)](LICENSE)
[![Built with Bun](https://img.shields.io/badge/Built%20with-Bun-black?logo=bun)](https://bun.sh)

<img width="900" height="884" alt="image" src="https://github.com/mseptiaan/opencode-qwencode-oauth/.github/img/opencode.png" />


Qwen OAuth authentication plugin for [OpenCode](https://opencode.ai) with multi-account rotation, proactive token refresh, and automatic API translation.

## Features

- **Device Flow OAuth** - PKCE-secured authentication, works in headless/CI environments
- **Multi-Account Support** - Store and rotate between multiple Qwen accounts
- **Hybrid Account Rotation** - Smart selection using health scores, token bucket, and LRU
- **Proactive Token Refresh** - Automatically refresh tokens before expiry
- **Rate Limit Handling** - Detects 429 responses, rotates accounts, respects retry-after
- **API Translation** - Bridges OpenAI Responses API ↔ Chat Completions API
- **Streaming Support** - Full SSE transformation for real-time responses
- **Cross-Platform** - Works on macOS, Linux, and Windows

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

   Select **Qwen OAuth** and follow the device flow instructions.

3. Start coding with Qwen models:
   ```
   /model qwen/coder-model
   ```

## Configuration

**No configuration required.** The plugin works out of the box with sensible defaults.

Configuration is loaded in layers with later sources taking precedence:

1. Built-in defaults
2. User config (`~/.config/opencode/qwen.json`)
3. Project config (`.opencode/qwen.json`)
4. Environment variables

### Available Options

| Option | Default | Description |
| ------ | ------- | ----------- |
| `rotation_strategy` | `"hybrid"` | Account rotation strategy (`hybrid`, `round-robin`, `sequential`) |
| `proactive_refresh` | `true` | Refresh tokens before they expire |
| `refresh_window_seconds` | `300` | Seconds before expiry to trigger a proactive refresh |
| `max_rate_limit_wait_seconds` | `300` | Max time to wait when all accounts are rate-limited (0 = unlimited) |
| `quiet_mode` | `false` | Suppress informational log output |
| `pid_offset_enabled` | `false` | Distribute load by process PID when running parallel sessions |
| `health_score` | (see below) | Fine-tune health score parameters |
| `token_bucket` | (see below) | Fine-tune token bucket parameters |

### Environment Variables

| Variable | Config Key |
| -------- | ---------- |
| `QWEN_OAUTH_CLIENT_ID` | `client_id` |
| `QWEN_OAUTH_BASE_URL` | `oauth_base_url` |
| `QWEN_API_BASE_URL` | `base_url` |
| `QWEN_ROTATION_STRATEGY` | `rotation_strategy` |
| `QWEN_PROACTIVE_REFRESH` | `proactive_refresh` |
| `QWEN_REFRESH_WINDOW_SECONDS` | `refresh_window_seconds` |
| `QWEN_MAX_RATE_LIMIT_WAIT_SECONDS` | `max_rate_limit_wait_seconds` |
| `QWEN_QUIET_MODE` | `quiet_mode` |
| `QWEN_PID_OFFSET_ENABLED` | `pid_offset_enabled` |

## Models

### Available via OAuth

| Model | Context Window | Features |
| ----- | -------------- | -------- |
| `coder-model` | 1M tokens | Text + image input, streaming |

## Multi-Account Rotation

Add multiple accounts for higher throughput:

1. Run `/connect` and complete the first login
2. Run `/connect` again to add additional accounts
3. The plugin automatically rotates between accounts

### Rotation Strategies

- **hybrid** (default): Smart selection combining health scores, token bucket rate limiting, and LRU. Accounts recover health passively over time.
- **round-robin**: Cycles through accounts on each request.
- **sequential**: Uses one account until rate limited, then switches.

#### Hybrid Strategy Details

The hybrid strategy uses a weighted scoring algorithm:

- **Health Score (0-100)**: Tracks account wellness. Success rewards (+1), rate limits penalize (-10), failures penalize more (-20). Accounts passively recover +2 points/hour when rested.
- **Token Bucket**: Client-side rate limiting (50 tokens max, regenerates 6/minute) to prevent hitting server 429s.
- **LRU Freshness**: Prefers accounts that haven't been used recently.

Score formula:

```
Score = (healthScore × 2) + ((tokens / maxTokens) × 100 × 5) + (min(secondsSinceUsed, 3600) × 0.1)
```

Maximum possible component values (total max ≈ 1060 points):

| Component | Max Points | Influence |
| --------- | ---------- | --------- |
| Health score | 200 pts | ~19% |
| Token balance | 500 pts | ~47% |
| Freshness (LRU) | 360 pts | ~34% |

Accounts with a health score below `min_usable` (default: 50) or with an exhausted token bucket are excluded from selection.

Enable `pid_offset_enabled: true` when running multiple parallel sessions (e.g., oh-my-opencode) to distribute load across accounts.

#### Customising Health Score

```json
{
  "health_score": {
    "initial": 70,
    "success_reward": 1,
    "rate_limit_penalty": -10,
    "failure_penalty": -20,
    "recovery_rate_per_hour": 2,
    "min_usable": 50
  }
}
```

#### Customising Token Bucket

```json
{
  "token_bucket": {
    "max_tokens": 50,
    "regeneration_rate_per_minute": 6
  }
}
```

## How It Works

This plugin bridges OpenCode's Responses API format with Qwen's Chat Completions API:

```
OpenCode → [Responses API] → Plugin → [Chat Completions] → Qwen
                                ↓
OpenCode ← [Responses API] ← Plugin ← [Chat Completions] ← Qwen
```

### Request Transformation

| Responses API | Chat Completions API |
| ------------- | -------------------- |
| `input` | `messages` |
| `input_text` | `text` content type |
| `input_image` | `image_url` content type |
| `instructions` | System message |
| `max_output_tokens` | `max_tokens` |
| `text.format` | `response_format` |

### Response Transformation (Streaming)

Converts SSE events from Chat Completions to Responses API format:

- `response.created`
- `response.output_item.added`
- `response.content_part.added`
- `response.output_text.delta`
- `response.completed`

## Storage Locations

| Data | Linux / macOS | Windows |
| ---- | ------------- | ------- |
| User config | `~/.config/opencode/qwen.json` | `%APPDATA%\opencode\qwen.json` |
| Project config | `.opencode/qwen.json` | `.opencode/qwen.json` |
| Account tokens | `~/.config/opencode/qwen-auth-accounts.json` | `%APPDATA%\opencode\qwen-auth-accounts.json` |
| Tracker state | `~/.config/opencode/qwen-auth-tracker-state.json` | `%APPDATA%\opencode\qwen-auth-tracker-state.json` |

`XDG_CONFIG_HOME` is respected on Linux/macOS.

**Security Note**: All token and state files are stored with restricted permissions (0600). Ensure appropriate filesystem security.

## Troubleshooting

### Authentication Issues

**"invalid_grant" error**

- Your refresh token has expired or been revoked. The account is automatically excluded from rotation. Run `/connect` to re-authenticate.

**Device code expired**

- Complete the browser login within 5 minutes of starting `/connect`.

### Rate Limiting

**Frequent 429 errors**

- Add more accounts with `/connect`.
- Increase `max_rate_limit_wait_seconds` in config.
- The hybrid strategy's token bucket provides client-side protection before hitting server limits.

### Debug Logging

Set `QWEN_DEBUG=1` to enable verbose debug output to stderr (and optionally a log file).

### Reset Plugin State

To start fresh, delete the accounts and tracker state files:

```bash
rm ~/.config/opencode/qwen-auth-accounts.json
rm ~/.config/opencode/qwen-auth-tracker-state.json
```

## Development

This project uses [Bun](https://bun.sh) for development.

### Prerequisites

- [Bun](https://bun.sh) 1.0+
- Node.js 20+ (for npm compatibility)

### Getting Started

```bash
# Install dependencies
bun install

# Build
bun run build

# Run tests (135 tests)
bun test

# Run tests in watch mode
bun test --watch

# Run with coverage
bun test --coverage

# Lint
bun run lint

# Auto-fix lint issues
bun run lint:fix

# Type-check
bun run typecheck

# Run e2e test (requires authenticated Qwen account)
bun run test:e2e

# Link for local testing
bun link
```

### Using npm

```bash
npm install
npm run build
npm test
```

## Known Limitations

- Audio input (`input_audio`) is not supported by Qwen and is converted to placeholder text.

## License

MIT License. See [LICENSE](LICENSE) for details.

<details>
<summary><b>Legal</b></summary>

### Intended Use

- Personal / internal development only
- Respect internal quotas and data handling policies
- Not for production services or bypassing intended limits

### Warning

By using this plugin, you acknowledge:

- **Terms of Service risk** — This approach may violate ToS of AI model providers
- **Account risk** — Providers may suspend or ban accounts
- **No guarantees** — APIs may change without notice
- **Assumption of risk** — You assume all legal, financial, and technical risks

### Disclaimer

- Not affiliated with QWEN and Alibaba. This is an independent open-source project.
- "QWEN" and "Alibaba" are trademarks of Alibaba company.

</details>
