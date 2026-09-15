// ---------------------------------------------------------------------------
// Politique de sécurité du contenu (CSP), posée au démarrage de la page.
//
// Aucune faille d'injection n'est connue (audit du 15 septembre 2026) ; c'est
// une ceinture : si du HTML venu d'ailleurs parvenait un jour à s'exécuter dans
// la WebView, il aurait accès au pont natif (fichiers, navigateur intégré…) et
// au stockage. La politique n'autorise que les scripts de l'application — ni
// script en ligne, ni `eval`, ni script d'un autre domaine.
//
// **Posée par le code, pas dans `index.html`**, et c'est voulu : sur une WebView
// ancienne (sans `DOCUMENT_START_SCRIPT`), Capacitor injecte son pont par un
// `<script>` en ligne dans la page (`JSInjector`, lu dans `Bridge.java`) ; une
// balise dans le HTML le bloquerait et l'application perdrait tout accès natif.
// Posée ici, après le pont, elle vaut pour tout ce qui suit. En développement,
// pas de politique : Vite injecte ses propres scripts en ligne et un WebSocket.
//
// Réseau et images restent ouverts à `https:` : les services sont nombreux et
// leurs adresses réglables (`config.ts`) ; une liste fermée casserait au premier
// changement sans rien protéger de plus. Ce sont les scripts qui comptent.
// ---------------------------------------------------------------------------

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "connect-src 'self' https: data: blob:",
  "img-src 'self' https: data: blob:",
  "media-src 'self' https: data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' https: data:",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

/** Pose la politique, en production seulement. */
export function installContentSecurityPolicy(): void {
  if (!import.meta.env.PROD) return;
  const meta = document.createElement("meta");
  meta.httpEquiv = "Content-Security-Policy";
  meta.content = CONTENT_SECURITY_POLICY;
  document.head.prepend(meta);
}
