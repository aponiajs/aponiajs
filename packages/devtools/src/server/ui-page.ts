/**
 * The one page this surface serves: a read-only view of the endpoints beside it.
 *
 * It is a single string with no build step, no framework, and no external
 * request: every value reaches the page as text, so the application's own data
 * is never parsed as markup. The page polls the sibling endpoints whenever it is
 * loaded; it keeps no state and changes nothing.
 *
 * @returns The HTML page.
 *
 * @internal
 */
export function devtoolsUiHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Aponia Devtools</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; margin: 0; padding: 24px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p { margin: 0 0 20px; opacity: .7; }
  section { margin: 0 0 20px; }
  h2 { font-size: 13px; margin: 0 0 6px; text-transform: uppercase; letter-spacing: .08em; opacity: .7; }
  pre { margin: 0; padding: 12px; border: 1px solid color-mix(in srgb, currentColor 20%, transparent); border-radius: 6px; overflow: auto; max-height: 320px; white-space: pre-wrap; }
</style>
</head>
<body>
<h1>Aponia Devtools</h1>
<p>Read-only view of the running application. Reload to poll again.</p>
<main>
  <section><h2>Meta</h2><pre id="meta">loading…</pre></section>
  <section><h2>Routes</h2><pre id="routes">loading…</pre></section>
  <section><h2>Requests</h2><pre id="requests">loading…</pre></section>
  <section><h2>Logs</h2><pre id="logs">loading…</pre></section>
</main>
<script>
  const targets = [
    ["meta", "./meta"],
    ["routes", "./routes"],
    ["requests", "./requests"],
    ["logs", "./logs"],
  ];
  for (const [id, url] of targets) {
    fetch(url)
      .then((response) => (response.ok ? response.text() : "HTTP " + response.status))
      .then((text) => {
        document.getElementById(id).textContent = text;
      })
      .catch((error) => {
        document.getElementById(id).textContent = String(error);
      });
  }
</script>
</body>
</html>
`;
}
