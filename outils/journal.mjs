// Lit le journal de navigation de MY OSM sur le téléphone branché, par le
// débogage de la WebView (voir app/src/navigation/journal.ts).
// Appelé par outils/journal.sh, qui ouvre la connexion.
const [port, action = "lire"] = process.argv.slice(2);
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find((t) => t.type === "page");
if (!page) { console.error("Aucune page MY OSM trouvée."); process.exit(1); }

const expression = action === "vider"
  ? "window.__myosm?.journal ? (window.__myosm.journal.clear(), 'journal vidé') : 'journal absent'"
  : "JSON.stringify(window.__myosm?.journal ? window.__myosm.journal.read() : localStorage.getItem('osm-local:nav-journal') ? JSON.parse(localStorage.getItem('osm-local:nav-journal')) : [])";

const ws = new WebSocket(page.webSocketDebuggerUrl);
ws.addEventListener("open", () =>
  ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true } })));
ws.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id !== 1) return;
  ws.close();
  const value = message.result?.result?.value;
  if (action === "vider") { console.log(value); return; }
  const entries = JSON.parse(value ?? "[]");
  for (const entry of entries) {
    const time = new Date(entry.t).toLocaleString("fr-FR", { hour12: false });
    console.log(`${time}  ${entry.k.padEnd(22)} ${entry.d ? JSON.stringify(entry.d) : ""}`);
  }
  console.error(`${entries.length} entrée(s)`);
});
