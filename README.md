# Umami MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server for [Umami Analytics](https://umami.is).
Ask Claude, Cursor or any MCP client about your traffic — and let it create and manage websites — while your
credentials stay on your own machine.

[![npm](https://img.shields.io/npm/v/@asif2bd/umami-mcp?color=cb3837&logo=npm)](https://www.npmjs.com/package/@asif2bd/umami-mcp)
[![npm downloads](https://img.shields.io/npm/dm/@asif2bd/umami-mcp?color=cb3837)](https://www.npmjs.com/package/@asif2bd/umami-mcp)
[![CI](https://github.com/Asif2BD/umami-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Asif2BD/umami-mcp/actions/workflows/ci.yml)
[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-published-0E7C86)](https://registry.modelcontextprotocol.io/?q=umami)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)
![Umami](https://img.shields.io/badge/Umami-v3-blue)

```
"Which pages drove the most visitors last month, and where did that traffic come from?"
"Build a funnel from /pricing to /signup to /welcome for the last 30 days."
"Add analytics for my new site blog.example.com and give me the tracking snippet."
```

<!-- Absolute URL so the image also renders on npmjs.com, which does not
     resolve repository-relative paths. -->
![umami-mcp answering questions about live traffic](https://raw.githubusercontent.com/Asif2BD/umami-mcp/main/demo/umami-mcp-demo.gif)

<sub>A throwaway site with generated traffic, on a live Umami 3.3.1 instance, read by a
view-only service account — so the counts are small and mean nothing, but every one of them was
really collected and really queried. Regenerate with `vhs demo/demo.tape`.</sub>

## Why this exists

Umami has no official MCP server. Several community ones exist, and if you just want broad API
coverage you should look at [`0xtlt/umami-mcp`](https://github.com/0xtlt/umami-mcp) first — it
wraps more of the API than this does. Some of the older servers
([`jakeyShakey`](https://github.com/jakeyShakey/umami_mcp_server),
[`mikusnuz`](https://github.com/mikusnuz/umami-mcp),
[`mittwald`](https://github.com/mittwald/umami-mcp),
[`Macawls`](https://github.com/Macawls/umami-mcp-server)) were written against the **v2** API and
break on a modern instance, because v3 renamed things without aliases:

| | Umami v2 | Umami v3 |
|---|---|---|
| Top pages | `/metrics?type=url` | `/metrics?type=path` |
| Hostnames | `/metrics?type=host` | `/metrics?type=hostname` |
| UTM data | `/metrics?type=utm_source` | `POST /api/reports/utm` |
| Funnels, retention, journeys, attribution, revenue | — | `POST /api/reports/*` |

This server exists for two things the others do not do:

**1. Complete, verified v3 report coverage.** All seven v3 report types — funnel, retention,
journey, goal, revenue, attribution and UTM — were exercised against a live **Umami 3.3.1**
instance. The report envelope is easy to get wrong: dates go in `parameters` as ISO-8601 strings,
not in `filters`, and not as the epoch milliseconds the rest of the API uses. Attribution takes
`first-click` / `last-click`, not the camelCase spellings you would guess.

**2. A capability model rather than a boolean.** See below.

## Security model

An analytics MCP server holds a credential that can read every visitor session you have ever
recorded — and, if you let it, delete the lot. The design follows from that.

**Your credentials never leave your environment.** Configuration is read only from the process
environment. There is no telemetry, no phone-home, and no hosted relay. The only host this
server ever contacts is the `UMAMI_URL` you set. If you self-host it, nothing about your
analytics ever reaches a third party — including the author of this software.

> Be wary of any Umami MCP that offers a hosted endpoint you point at your instance.
> Self-hosted Umami has no API keys, so "convenient" hosting means mailing your **admin
> password** to someone else's server.

**Least privilege by default.** The server starts in `read` mode. Widening is a deliberate act:

| Mode | Adds |
|---|---|
| `read` *(default)* | Analytics, reports, listing websites |
| `write` | Create and update websites and teams |
| `admin` | User management |
| `+ UMAMI_MCP_ALLOW_DESTRUCTIVE=true` | Delete website, reset data, delete user |

Withheld tools are **not registered at all**, so they never appear in the model's tool list.
This is the part that differs from a `READONLY=true` flag: a tool that was never advertised
cannot be invoked by a prompt-injected instruction hidden in, say, a referrer string or a page
title inside your own analytics data. There is no runtime check to forget or bypass, because
there is no tool.

**Destructive actions need a typed confirmation checked against reality.** `umami_delete_website`
takes a `confirmDomain` argument, fetches the live record, and refuses unless they match. A model
that reaches for the wrong website UUID gets an error, not a wiped dataset.

**Credentials stay out of client config.** Rather than requiring your password inside
`~/.claude.json` or `mcp.json`, the server reads it from a file you control at
`~/.config/umami-mcp/env`, and warns if that file is readable by other users. See
[Credentials](#credentials).

**Secrets are scrubbed from output.** MCP output flows into a model and often into a chat
transcript, which cannot be un-said. Passwords, bearer tokens and JWTs are redacted from every
error and response before they leave the process.

**Refuses to leak credentials over the wire.** Plaintext HTTP to a remote host is rejected at
startup; it is permitted only for `localhost`, for local development.

## Install

Three ways to run it. **Self-hosting is the default and the recommended one** — the hosted
instance exists so you can try it in two minutes without cloning anything.

| | Runs where | Credentials live | Best for |
|---|---|---|---|
| **Hosted** | asif.dev | Sealed in your token, never stored | Trying it out; Claude web and Cowork |
| **Source** | Your machine | A file only you can read | Daily use in Claude Code |
| **Docker** | Your server | Your `.env` | Teams, always-on |

If you self-host and want it in Claude web, run it with `UMAMI_MCP_OAUTH=true` behind your own
domain — then nothing of yours touches anyone else's infrastructure.

### 1. Use the hosted instance (nothing to install)

Add a custom connector in Claude pointing at:

```
https://umami-mcp.asif.dev/mcp
```

You will be asked for your own Umami URL and login on a consent screen. See
[Claude web, Cowork, and Claude Code on web](#claude-web-cowork-and-claude-code-on-web)
for how the credentials are handled.

### 2. From source

```bash
git clone https://github.com/Asif2BD/umami-mcp.git
cd umami-mcp
npm install && npm run build
```

Then set up [credentials](#credentials) and register it with your client:

```bash
claude mcp add umami --scope user -- node "$PWD/dist/index.js"
```

Requires Node 20 or newer.

### 3. Docker

```bash
git clone https://github.com/Asif2BD/umami-mcp.git
cd umami-mcp
cp .env.example .env    # then edit .env
docker compose up -d
```

> **npm:** not published yet. Once it is, `npx -y @asif2bd/umami-mcp` will replace the
> clone-and-build step above. Until then use source or Docker.

## Credentials

Self-hosted Umami has no API keys, so the credential this server holds is a **real account
password**. MCP clients normally want that embedded in their config JSON — `~/.claude.json`,
`mcp.json` and friends — which are widely readable, get pasted into issues and screen-shares, and
are synced between machines by some clients.

So this server reads credentials from a file you control instead. Create it once:

```bash
mkdir -p ~/.config/umami-mcp
cat > ~/.config/umami-mcp/env <<'EOF'
UMAMI_URL=https://analytics.example.com
UMAMI_USERNAME=mcp-bot
UMAMI_PASSWORD=your-password
UMAMI_MCP_MODE=read
EOF
chmod 600 ~/.config/umami-mcp/env
```

The server loads it automatically. It warns on startup if the file is readable by other users.

Lookup order — the first file found wins, and **real environment variables always override the
file**, so you can still pass settings from the client config when you want to:

1. `$UMAMI_MCP_ENV_FILE`, if set
2. `~/.config/umami-mcp/env` (or `$XDG_CONFIG_HOME/umami-mcp/env`)
3. `./.env` in the working directory

## Connect your client

### Claude Code

With the credentials file above, the registration carries no secrets at all:

```bash
claude mcp add umami --scope user -- node ~/umami-mcp/dist/index.js
```

Use the absolute path to your checkout. If your Node lives under nvm, give the full
interpreter path too, since MCP clients do not load your shell profile:

```bash
claude mcp add umami --scope user -- ~/.nvm/versions/node/v22.22.0/bin/node ~/umami-mcp/dist/index.js
```

### Claude Desktop / Cursor / VS Code

```json
{
  "mcpServers": {
    "umami": {
      "command": "node",
      "args": ["/absolute/path/to/umami-mcp/dist/index.js"]
    }
  }
}
```

If you would rather keep everything in one place, environment variables still work and take
precedence over the file:

```json
{
  "mcpServers": {
    "umami": {
      "command": "node",
      "args": ["/absolute/path/to/umami-mcp/dist/index.js"],
      "env": {
        "UMAMI_URL": "https://analytics.example.com",
        "UMAMI_USERNAME": "mcp-bot",
        "UMAMI_PASSWORD": "your-password"
      }
    }
  }
}
```

### Check it works

Ask your client to run `umami_whoami`. It reports the instance, the account, and the permission
mode — the fastest way to confirm the connection and see how much the server is allowed to do:

```json
{
  "instance": "https://analytics.example.com",
  "authenticatedAs": "mcp-bot",
  "role": "admin",
  "serverMode": "read",
  "destructiveOperations": "disabled"
}
```

Then try: *"List my Umami websites"*, or *"What were my top pages last week?"*

## Claude web, Cowork, and Claude Code on web

Those clients cannot launch a local process, so they need a public HTTPS MCP server — and their
connector UI accepts **OAuth only**, with no field for a static bearer token or custom header.

Hosting the obvious way, with one set of Umami credentials baked in and no authentication, turns
the URL into an open proxy to that Umami. So this server does OAuth instead, and does it without
becoming a credential store.

### Use the hosted instance

Add a custom connector in Claude with this URL:

```
https://umami-mcp.asif.dev/mcp
```

Claude registers itself, sends you to a consent screen, and asks for **your own** Umami URL,
username and password. Nothing is shared with other users of the host.

### Host your own

```bash
UMAMI_MCP_OAUTH=true
UMAMI_MCP_TRANSPORT=http
UMAMI_MCP_ISSUER=https://mcp.example.com      # public HTTPS URL of this server
UMAMI_MCP_TOKEN_KEY=<32 random bytes>          # keep stable; see below
UMAMI_MCP_TOKEN_TTL=2592000                    # 30 days
```

Generate the key once and keep it:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Set `UMAMI_URL` as well to pin every user to one instance instead of letting them choose.

### How the credentials are handled

The consent screen verifies the credentials against the Umami instance the user named, then seals
them into the access token with AES-256-GCM. The server keeps **no session table and stores no
credentials**: each request decrypts the token, builds an MCP server scoped to that one user,
serves the call, and discards it.

The honest trade-off: whoever holds `UMAMI_MCP_TOKEN_KEY` can decrypt any token they capture.
Treat it as the most sensitive value in the deployment. Rotating it invalidates every issued
token, which is the intended blast-radius control.

Destructive tools are **never** exposed over OAuth, whatever permission the user picks. Their
typed-confirmation guard assumes a local operator who can see what they are about to delete, and
a remote caller cannot be shown that.

## Running it as a plain HTTP service

Set `UMAMI_MCP_TRANSPORT=http` without `UMAMI_MCP_OAUTH` for a single-tenant endpoint at `/mcp`,
plus `/health`.

**In this mode the server has no authentication of its own.** Anyone who can reach the port can
use your Umami credentials. Keep it on loopback and tunnel to it:

```bash
ssh -N -L 3334:127.0.0.1:3334 you@your-server
claude mcp add --transport http umami http://127.0.0.1:3334/mcp
```

The server warns at startup when it is bound to anything other than loopback.

## Tools

| Tool | Requires | Description |
|---|---|---|
| `umami_list_websites` | read | List the websites tracked by this Umami instance, with their UUIDs |
| `umami_get_website` | read | Fetch a single website by UUID, including its domain, owner and creation date. |
| `umami_create_website` | write | Register a new website for tracking and return its UUID, which is the value to put in the data-website-id attribute of the Umami tracking script. |
| `umami_update_website` | write | Change a website's name, domain or share slug |
| `umami_reset_website` | destructive | PERMANENTLY DELETE all collected analytics data for a website, keeping the website itself |
| `umami_delete_website` | destructive | PERMANENTLY DELETE a website and every event ever recorded for it |
| `umami_get_tracking_snippet` | read | Return the ready-to-paste HTML script tag that sends data to this Umami instance for a given website. |
| `umami_get_stats` | read | Headline totals for a website over a period: pageviews, visitors, visits, bounces and total time on site |
| `umami_get_pageviews` | read | Pageviews and sessions bucketed over time, for charting traffic |
| `umami_get_metrics` | read | Top values for one dimension, ranked by visitor count -- top pages, referrers, countries, browsers and so on |
| `umami_get_active_visitors` | read | Number of visitors active on the site in the last few minutes |
| `umami_get_realtime` | read | Live snapshot of current activity: recent events with country, URL, browser and device, plus rollups by country, URL and referrer |
| `umami_get_event_stats` | read | Totals for custom tracked events over a period: event count, unique event names, visitors and visits, with a comparison against the preceding period. |
| `umami_list_sessions` | read | Individual visitor sessions with browser, OS, device, country and region |
| `umami_get_session_activity` | read | The ordered sequence of pageviews and events for one visitor session -- their path through the site. |
| `umami_report_utm` | read | Breakdown of traffic by UTM parameters: source, medium, campaign, term and content |
| `umami_report_funnel` | read | Step-by-step conversion funnel |
| `umami_report_retention` | read | Cohort retention: of the visitors first seen on a given day, how many returned on each subsequent day. |
| `umami_report_journey` | read | Most common ordered paths visitors take through the site, as sequences of pages with a count for each. |
| `umami_report_goal` | read | Progress toward a single goal: how many visitors hit a given path or custom event. |
| `umami_report_revenue` | read | Revenue over time from events carrying a revenue property, broken down by country, region, referrer and channel |
| `umami_report_attribution` | read | Credits conversions to acquisition channels -- referrer, paid ads and UTM parameters -- under either a first-click or last-click model. |
| `umami_list_users` | admin | List Umami user accounts with their roles |
| `umami_create_user` | admin | Create a Umami user account |
| `umami_delete_user` | destructive | PERMANENTLY DELETE a user account and the websites they own |
| `umami_list_teams` | read | List teams and their members. |
| `umami_create_team` | write | Create a team so websites can be shared between users. |
| `umami_whoami` | read | Verify that this MCP server can reach the configured Umami instance and report which account it is authenticated as, plus the permission mode the server is running in |

### Time ranges

Every analytics tool accepts a `period` shorthand — `24h`, `7d`, `30d`, `12m`, `today`,
`yesterday` — instead of epoch milliseconds. Models are reliably good at "last 30 days" and
unreliably good at timestamp arithmetic, and a miscalculated epoch returns data for the wrong
window *without erroring*. Explicit `startAt`/`endAt` in epoch milliseconds still work and take
precedence.

## Configuration

See [.env.example](.env.example) for every option. The essentials:

| Variable | Default | Purpose |
|---|---|---|
| `UMAMI_URL` | *required* | Your Umami instance |
| `UMAMI_USERNAME` / `UMAMI_PASSWORD` | | Self-hosted login |
| `UMAMI_API_KEY` | | Umami Cloud alternative |
| `UMAMI_MCP_MODE` | `read` | `read` / `write` / `admin` |
| `UMAMI_MCP_ALLOW_DESTRUCTIVE` | `false` | Unlock delete and reset |
| `UMAMI_MCP_TRANSPORT` | `stdio` | `stdio` or `http` |
| `UMAMI_MCP_HOST` | `127.0.0.1` | HTTP bind address |
| `UMAMI_MCP_PORT` | `3334` | HTTP port |
| `UMAMI_MCP_ENV_FILE` | | Explicit path to a credentials file |

## Recommended setup

Create a dedicated Umami account for the MCP server rather than reusing your admin login, and
give it only the websites it needs. Then, if the credential is ever exposed, the blast radius is
one bot account you can delete — not your administrator.

## Compatibility

Verified against **Umami 3.3.1** (self-hosted, PostgreSQL). Umami Cloud works via `UMAMI_API_KEY`.
Umami v2 is not supported: the renamed metric types above mean v2 and v3 need different clients,
and this one targets v3.

## Development

```bash
npm install
npm run build
npm test          # unit tests, no network required
```

`test/e2e.mjs` and `test/write-e2e.mjs` drive the built server through a real MCP client against
a live instance. The write test creates a throwaway website on a `.invalid` domain and deletes it
again; point it at a non-production instance.

## Contributing

Issues and pull requests welcome. Umami v3 exposes around 127 API routes and this server covers
the most useful ones — session replay, heatmaps, pixels, link tracking, boards and segments are
all still unmapped. If you add tools, keep the tier and `destructive` flags honest, because the
whole safety model rests on them.

If the Umami team would like to adopt, fork or upstream this, please open an issue — that is the
outcome this was built for.

## License

MIT © M Asif Rahman
