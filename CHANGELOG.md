# Changelog

## 0.1.2 — 2026-08-25

**Security.** The multi-tenant consent form accepted any URL and would connect to it, which made
a public deployment usable as an SSRF probe of the host's own network. It now requires https and
resolves the hostname, refusing loopback, private, link-local and CGNAT targets — including
hostnames that resolve to them. Single-tenant deployments are unchanged.

## 0.1.1 — 2026-08-25

- `list_websites` falls back to the instance-wide admin listing when an account owns no websites
  and belongs to no team but holds the admin role. This is what lets a dedicated service account
  and a human owner both see every website without either losing their dashboard.
- Published 0.1.0 shipped without this; there is no other change.

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
