# Changelog

## 0.1.0 — 2026-08-25

First release. Verified against a live Umami 3.3.1 instance.

- 28 tools: analytics, all seven Umami v3 report types, website management, user administration.
- Verified against a live Umami 3.3.1 instance (self-hosted, PostgreSQL).
- Permission tiers (`read` / `write` / `admin`) where withheld tools are never registered.
- Destructive operations gated behind a separate flag and a typed confirmation checked against
  the live record.
- Credential redaction applied to all output.
- stdio and streamable-HTTP transports.
- OAuth 2.1 mode for hosted, multi-tenant use (Claude web, Cowork, Claude Code on web):
  each user brings their own Umami, credentials are sealed into the access token, and the
  server stores none of them. Destructive tools are never exposed over OAuth.
- Credentials can live in `~/.config/umami-mcp/env` instead of the MCP client's config JSON,
  with a startup warning when that file is readable by other users.
- Relative time ranges (`24h`, `7d`, `30d`, `today`) alongside explicit epoch timestamps.
