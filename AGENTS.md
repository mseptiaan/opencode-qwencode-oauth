# For AI Coding Assistants

This file helps AI assistants understand this codebase.

## Project Overview

OpenCode plugin for Qwen OAuth authentication with:
- Device flow OAuth with PKCE
- Multi-account rotation (round-robin, sequential)
- Proactive token refresh
- Rate limit handling (429 detection)
- API translation: Responses API ↔ Chat Completions API

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Plugin entrypoint |
| `src/cli/install.ts` | CLI installer (`bunx opencode-qwencode-oauth install`) |
| `src/plugin/` | Core plugin logic, account management |
| `src/qwen/oauth.ts` | OAuth device flow implementation |
| `src/transform/` | API request/response transformation |

## Commands

```bash
bun install     # Install dependencies
bun test        # Run tests (50 tests)
bun run build   # Build for production
bun run lint    # Run Biome linter
```

## Testing

- Unit tests: `test/*.test.ts` (auth, token, transform, account, url, cli)
- Mock server: `test/mock-server/server.ts`
- E2E tests: `test/e2e.test.ts`

## Architecture

```
OpenCode → [Responses API] → Plugin → [Chat Completions] → Qwen API
                                ↓
                          Token refresh
                          Account rotation
                          Rate limit handling
```

## Configuration

User config: `~/.config/opencode/qwen.json`
Project config: `.opencode/qwen.json`
Account tokens: `~/.config/opencode/qwen-auth-accounts.json`

## Key Patterns

- Uses `proper-lockfile` for file locking during account storage
- SSE streaming transformation in `src/transform/sse.ts`
- Zod schemas for configuration validation

## Contributing

**Branch protection is enabled.** Direct pushes to `main` are blocked.

To make changes:
1. Create a feature branch: `git checkout -b feature/my-change`
2. Make changes and commit
3. Push and create PR: `git push -u origin feature/my-change && gh pr create`
4. Wait for CI to pass (ubuntu, macos, windows)
5. Wait for Codex review emoji on the PR summary comment:
   - 👀 = Codex reviewing
   - 👍 = no issues found
6. Merge PR (branch auto-deletes after merge)

## Release Process

1. Create a branch and bump version: `npm version patch|minor|major --no-git-tag-version`
2. Commit and create PR
3. After merge, create GitHub release with tag `vX.Y.Z`
4. Release workflow auto-publishes to npm via OIDC (no tokens needed)
