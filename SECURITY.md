# Security Policy

## Reporting a vulnerability

Please report security issues privately through
[GitHub Security Advisories](https://github.com/Asif2BD/umami-mcp/security/advisories/new)
rather than opening a public issue.

## Threat model

This server holds a credential that can read every visitor session your Umami instance has ever
recorded, and — when the operator enables it — delete websites and users. Treat it accordingly.

**What the design assumes:**

- The operator controls the environment the server runs in. Credentials come from environment
  variables and are never written to disk by this server.
- The single `UMAMI_URL` is trusted. It is the only host contacted, and it is fixed at startup —
  it cannot be redirected by tool arguments or by anything a model says.
- **Analytics data is untrusted input.** Referrers, page titles, URLs and custom event names are
  written by visitors to your site, and they flow through this server into a model's context. A
  page title is a plausible place to hide a prompt injection. This is why the permission tiers
  withhold tools by *not registering them*: a tool absent from the tool list cannot be called, no
  matter what a model is persuaded to attempt.

**Server-side request forgery.** In multi-tenant mode any stranger can name the URL the server
will send credentials to. Left unchecked that makes the consent form a probe of the host's own
network — submit `http://127.0.0.1:6379` or `https://169.254.169.254` and read the difference
between "connection refused" and "credentials rejected" to enumerate internal services. The
consent handler therefore requires https and resolves the hostname, refusing loopback, private,
link-local and CGNAT addresses, and refusing hostnames that resolve to them. Single-tenant
deployments are unaffected: there the operator chose the URL, and pointing at localhost is a
legitimate development setup.

*Residual risk:* the address is validated when the token is issued, not on every request, so a
hostname whose DNS changes afterwards could later point somewhere internal. Closing that fully
needs pinning the resolved address into the token; it is not done today.

**What it does not protect against:**

- The HTTP transport has **no authentication of its own**. Anyone who can reach the port can use
  your Umami credentials. Bind it to loopback and reach it over an SSH tunnel, or place an
  authenticating reverse proxy in front. The server logs a warning when bound to a non-loopback
  address.
- A compromised host. If an attacker can read your environment or your process memory, they have
  your Umami credentials regardless of anything here.
- An operator who sets `UMAMI_MCP_MODE=admin` with `UMAMI_MCP_ALLOW_DESTRUCTIVE=true` and then
  connects an untrusted model. The confirmation guards raise the bar; they are not a substitute
  for least privilege.

## Recommendations

- Run as `read` unless you have a specific reason not to. That is the default.
- Give the server a **dedicated Umami account**, not your admin login, scoped to the websites it
  needs. If the credential leaks, you delete one bot account instead of rotating your own.
- Keep `UMAMI_MCP_ALLOW_DESTRUCTIVE=false` in anything long-running. Enable it for the single
  session where you actually need to delete something.
