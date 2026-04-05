# Qwen Auth plugin quick setup

## Install

```bash
# Using Bun (recommended)
bun add opencode-qwencode-oauth

# Using npm
npm install opencode-qwencode-oauth
```

Add to `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-qwencode-oauth"],
  "provider": {
    "qwen": {
      "models": {
        "qwen3-coder-plus": { "contextWindow": 1048576 },
        "qwen3-vl-plus": { "contextWindow": 262144 }
      }
    }
  }
}
```

## Authenticate

```bash
/auth
```

Select **Qwen OAuth** and follow the device login instructions.

## Choose a model

OAuth models:

- `qwen3-coder-plus`
- `qwen3-vl-plus`

OpenAI-compatible examples:

- `qwen-plus`
- `qwen3-max`
- `qwen-flash`
- `qwen-turbo`

## Optional overrides

Create `.opencode/qwen.json`:

```json
{
  "base_url": "https://portal.qwen.ai/v1",
  "rotation_strategy": "round-robin",
  "proactive_refresh": true,
  "refresh_window_seconds": 300
}
```
