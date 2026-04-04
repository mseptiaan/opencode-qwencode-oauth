# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2025-01-18

### Added

- Initial release
- Device flow OAuth authentication with PKCE
- Multi-account support with rotation strategies (round-robin, sequential)
- Proactive token refresh before expiry
- Rate limit handling with 429 detection and retry-after support
- API translation: OpenAI Responses API ↔ Chat Completions API
- SSE streaming transformation
- Bun-first development workflow
- Mock server for deterministic e2e testing
- GitHub Actions CI with multi-platform testing
