# Changelog

## 0.1.6 - 2026-10-09

**The server now starts over stdio even when it is not configured**, so registries and
inspectors (Glama, MCP Inspector) can list its tools without real credentials.

Previously a missing `UMAMI_URL` or missing credentials made the process exit immediately
(code 78), which looked like a broken server to anything that only launches it to see what
it offers. Now, on stdio only, it starts with the read-only tool set and every tool call
returns the original configuration error, so a user with a bad config still sees exactly
what to fix. Nothing is ever sent anywhere in this state. Write and admin tools are never
advertised while unconfigured, whatever `UMAMI_MCP_MODE` says.

HTTP and OAuth deployments are unchanged: a bad configuration still stops them at boot.

- Added `glama.json` so the Glama listing can be claimed by its maintainer.

## 0.1.5 - 2026-09-06

- `/health` reports the running server version.

## 0.1.4 - 2026-08-26

**Fixes native and desktop MCP clients, which could not authenticate at all.**

Redirect URI validation accepted only https and loopback, so every desktop client was
rejected at registration. Cursor sends `cursor://anysphere.cursor-mcp/oauth/callback`;
VS Code and other native clients do the same. RFC 8252 lists private-use URI schemes as a
valid redirect type alongside https and loopback, because a native app has no web server
to redirect to.

Private-use schemes are now accepted, and PKCE is **required** for them and for loopback:
the OS hands the callback to whichever app claimed the scheme, so the authorization code
alone is not a secret. Schemes that can execute or read local data (`javascript:`, `data:`,
`file:`, `blob:`, `about:`) are still refused, as is plaintext http to a remote host.

## 0.1.3 — 2026-08-26

- Added `server.json` and the `mcpName` field so the server can be published to the official
  MCP Registry. No functional change.

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
