/**
 * The consent screen. This is where a user hands over their Umami credentials,
 * so it must be honest about what happens to them.
 */

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

export interface ConsentPageOptions {
  action: string;
  hiddenFields: Record<string, string>;
  clientName?: string;
  fixedUrl?: string;
  error?: string;
}

export function consentPage(o: ConsentPageOptions): string {
  const hidden = Object.entries(o.hiddenFields)
    .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`)
    .join('\n      ');

  const client = o.clientName ? escapeHtml(o.clientName) : 'An MCP client';

  const urlField = o.fixedUrl
    ? `<input type="hidden" name="umami_url" value="${escapeHtml(o.fixedUrl)}">
       <div class="fixed">Connecting to <strong>${escapeHtml(o.fixedUrl)}</strong></div>`
    : `<label>Your Umami URL
         <input type="url" name="umami_url" required placeholder="https://analytics.example.com"
                autocomplete="url" spellcheck="false">
       </label>`;

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect your Umami</title>
<style>
  :root { color-scheme: light dark; --bg:#fff; --fg:#111; --mut:#666; --line:#ddd; --acc:#2563eb; --warn:#8a5a00; --warnbg:#fff8e6; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#15171a; --fg:#e8e8e8; --mut:#9aa0a6; --line:#33363b; --acc:#5b8cff; --warn:#ffcf70; --warnbg:#2a2416; }
  }
  * { box-sizing: border-box; }
  body { margin:0; padding:2rem 1rem; background:var(--bg); color:var(--fg);
         font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  main { max-width: 27rem; margin: 0 auto; }
  h1 { font-size:1.25rem; margin:0 0 .35rem; }
  p.sub { color:var(--mut); margin:0 0 1.5rem; }
  label { display:block; margin:0 0 1rem; font-weight:500; }
  input[type=url],input[type=text],input[type=password],select {
    width:100%; margin-top:.35rem; padding:.6rem .7rem; font:inherit; font-weight:400;
    border:1px solid var(--line); border-radius:8px; background:var(--bg); color:var(--fg); }
  input:focus,select:focus { outline:2px solid var(--acc); outline-offset:1px; border-color:transparent; }
  button { width:100%; padding:.7rem; font:inherit; font-weight:600; color:#fff; background:var(--acc);
           border:0; border-radius:8px; cursor:pointer; margin-top:.5rem; }
  button:hover { filter:brightness(1.08); }
  .note { border:1px solid var(--line); border-radius:8px; padding:.8rem .9rem; margin:1.5rem 0 0;
          color:var(--mut); font-size:.85rem; }
  .note strong { color:var(--fg); }
  .warn { background:var(--warnbg); border-color:transparent; color:var(--warn); margin:0 0 1.25rem; }
  .err { background:#fdecea; color:#a4271c; border:0; border-radius:8px; padding:.7rem .9rem; margin:0 0 1rem; font-size:.9rem; }
  @media (prefers-color-scheme: dark) { .err { background:#3a1d1a; color:#ffb4a8; } }
  .fixed { padding:.6rem .7rem; border:1px solid var(--line); border-radius:8px; margin-bottom:1rem; font-size:.9rem; }
  hr { border:0; border-top:1px solid var(--line); margin:1.5rem 0; }
</style></head>
<body><main>
  <h1>Connect your Umami</h1>
  <p class="sub">${client} is asking to read your Umami Analytics.</p>

  ${o.error ? `<div class="err">${escapeHtml(o.error)}</div>` : ''}

  <div class="note warn">
    Self-hosted Umami has no API keys, so this is your <strong>account password</strong>.
    Only continue if you trust whoever runs this server. Prefer a dedicated,
    limited Umami account over your admin login.
  </div>

  <form method="POST" autocomplete="off">
      ${hidden}
      ${urlField}
      <label>Username
        <input type="text" name="umami_username" required autocomplete="username" spellcheck="false">
      </label>
      <label>Password
        <input type="password" name="umami_password" required autocomplete="current-password">
      </label>
      <label>Permission
        <select name="mode">
          <option value="read" selected>Read only &mdash; analytics and reports</option>
          <option value="write">Read and write &mdash; also create and update websites</option>
          <option value="admin">Admin &mdash; also manage users</option>
        </select>
      </label>
      <button type="submit">Connect</button>
  </form>

  <div class="note">
    <strong>What happens to your password:</strong> it is verified against the Umami URL you
    entered, then encrypted into the access token itself. This server keeps no database and
    stores no credentials. Irreversible operations &mdash; deleting a website, wiping its data,
    removing a user &mdash; are never available through this connection, whichever permission
    you pick.
  </div>
</main></body></html>`;
}

export function errorPage(title: string, detail: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>:root{color-scheme:light dark}body{margin:0;padding:3rem 1rem;font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;text-align:center}
h1{font-size:1.15rem;margin:0 0 .5rem}p{color:#666;max-width:30rem;margin:0 auto}</style></head>
<body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(detail)}</p></body></html>`;
}
