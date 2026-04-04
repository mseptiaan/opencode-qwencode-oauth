# Contributing to opencode-qwen-oauth

Thank you for your interest in contributing!

## Prerequisites

- [Bun](https://bun.sh) 1.0+ (install: `curl -fsSL https://bun.sh/install | bash`)
- TypeScript 5.x (installed automatically)

## Development Setup

```bash
# Clone the repository
git clone https://github.com/mseptiaan/opencode-qwen-oauth.git
cd opencode-qwen-oauth

# Install dependencies
bun install

# Run tests
bun test

# Build
bun run build
```

## Project Structure

```
opencode-qwen-oauth/
├── src/
│   ├── index.ts              # Plugin entrypoint
│   ├── plugin/               # Core plugin logic
│   ├── qwen/                 # Qwen OAuth implementation
│   └── transform/            # API translation
├── test/
│   ├── *.test.ts             # Unit tests
│   ├── e2e.test.ts           # E2E tests with mock server
│   └── mock-server/          # Mock Qwen server for testing
├── scripts/
│   └── e2e-test.ts           # Live e2e test script
└── dist/                     # Build output
```

## Available Commands

| Command             | Description                        |
| ------------------- | ---------------------------------- |
| `bun install`       | Install dependencies               |
| `bun test`          | Run all tests                      |
| `bun test --watch`  | Run tests in watch mode            |
| `bun run build`     | Build for production               |
| `bun run typecheck` | Type check without emitting        |
| `bun run test:e2e`  | Run live e2e test (requires auth)  |

## Testing

### Unit Tests

Unit tests use Bun's built-in test runner:

```bash
bun test                    # Run all tests
bun test test/auth.test.ts  # Run specific file
bun test --watch            # Watch mode
```

### E2E Tests

The project includes two types of e2e testing:

1. **Mock server tests** (`test/e2e.test.ts`) - Deterministic tests using a mock Qwen server
2. **Live tests** (`scripts/e2e-test.ts`) - Tests against real Qwen API (requires authentication)

```bash
# Run mock server e2e tests (included in bun test)
bun test test/e2e.test.ts

# Run live e2e test (requires authenticated account)
bun run test:e2e
```

## Code Style

- TypeScript strict mode enabled
- No comments unless absolutely necessary (complex algorithms, regex, etc.)
- Self-documenting code preferred

## Pull Request Process

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Ensure tests pass: `bun test`
5. Ensure build succeeds: `bun run build`
6. Submit a pull request

## License

By contributing, you agree that your contributions will be licensed under Apache-2.0.
