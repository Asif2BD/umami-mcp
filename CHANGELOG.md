# Changelog

## 0.1.0 — unreleased

First release.

- 28 tools: analytics, all seven Umami v3 report types, website management, user administration.
- Verified against a live Umami 3.3.1 instance (self-hosted, PostgreSQL).
- Permission tiers (`read` / `write` / `admin`) where withheld tools are never registered.
- Destructive operations gated behind a separate flag and a typed confirmation checked against
  the live record.
- Credential redaction applied to all output.
- stdio and streamable-HTTP transports.
- Relative time ranges (`24h`, `7d`, `30d`, `today`) alongside explicit epoch timestamps.
