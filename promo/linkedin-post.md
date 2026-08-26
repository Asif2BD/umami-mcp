[ATTACH: demo/umami-mcp-demo.gif]

---

I needed a tool that didn't exist.

So I built it in a day, and gave it away.

Here's what happened.

I run Umami for analytics across 21 sites. Self-hosted, privacy-first, open source. On xCloud it's a one-click deploy, which is why I never moved to anything else.

Last week I wanted to stop opening the dashboard.

I just wanted to ask: "how did this site do last week, and where did the traffic come from?"

For that, a tool needs an MCP server. That's the piece that lets an AI actually use your software instead of describing it.

Umami didn't have one.

A few people had built community versions. I tried them.

Here's the part that cost me an afternoon:

They were written for Umami v2. Umami is on v3 now, and v3 renamed things.

↳ They don't crash
↳ They return a clean, confident response
↳ With data for the wrong thing

That's a worse failure than an error. An error you notice. A wrong number you repeat in a meeting.

So I built my own. One day.

And the first thing it told me wasn't a number.

It flagged a broken link on my own site. Something had been following it for weeks. No dashboard would ever have shown me that, because it isn't a metric. It's a detail sitting in a list nobody scrolls.

Then I looked at what I'd made and felt slightly stupid.

Umami is free. Open source. The entire promise is that you own your data.

And I'd just built the missing piece for myself and stopped there.

So I released it.

↳ 28 tools, covering every report type in Umami v3
↳ Read-only by default, write access is opt-in
↳ Runs on your machine, credentials never leave it
↳ MIT licensed, free forever

One line:

npx -y @asif2bd/umami-mcp

Here's what I actually took from this.

In the agent era, open source has an advantage nobody has priced in yet.

When a closed tool is missing something, you file a feature request and wait two quarters.

When an open one is missing something, you build it. Then you hand it back, and it's there for everyone who comes after you.

Umami had no MCP server on Monday. It has one now.

That's the whole difference.

Which tool do you use every day that still has no MCP?

Name it below. I'm genuinely curious which gap is worth closing next.

---

[FIRST COMMENT — links go here, not in the post body.
 LinkedIn throttles reach on posts with outbound links.]

GitHub: https://github.com/Asif2BD/umami-mcp
npm: https://www.npmjs.com/package/@asif2bd/umami-mcp
Official MCP Registry: https://registry.modelcontextprotocol.io/?q=umami
Umami: https://umami.is
