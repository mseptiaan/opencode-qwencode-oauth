# Security Policy

## Reporting Security Issues

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, email security concerns to the maintainers directly. You should receive a response within 48 hours.

## Token Security

This plugin handles OAuth tokens for Qwen API access. Security measures include:

- **Storage**: Tokens stored in `~/.config/opencode/qwen-auth-accounts.json` with 0600 permissions (owner read/write only)
- **Refresh**: Access tokens are short-lived; refresh tokens are used to obtain new access tokens
- **No logging**: Authorization headers and tokens are never logged, even in debug mode
- **Local only**: Tokens are never transmitted except to Qwen's official OAuth endpoints

## Best Practices for Users

1. **Never commit** `qwen-auth-accounts.json` to version control
2. **Add to .gitignore**: `**/qwen-auth-accounts.json`
3. **Secure your config directory**: Ensure `~/.config/opencode/` has appropriate permissions
4. **Rotate accounts**: If you suspect token compromise, re-authenticate with `/auth`

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Security Updates

Security fixes will be released as patch versions and announced in the changelog.
