// ---------------------------------------------------------------------------
// Garde-fous pour les valeurs venues d'ailleurs — données OSM, stockage relu —
// avant qu'elles n'atteignent un lien ou du HTML (audit de sécurité du
// 15 septembre 2026).
// ---------------------------------------------------------------------------

/** Une couleur CSS hexadécimale (`#rgb` à `#rrggbbaa`), sinon `fallback`. */
export function safeColor(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-f]{3,8}$/i.test(value) ? value : fallback;
}

/**
 * Un lien web cliquable, ou `undefined`. Seuls `http(s)` passent ; une adresse
 * sans schéma (« www.exemple.fr », fréquente dans OSM) reçoit `https://`.
 * `javascript:`, `intent:`, `data:`… sont refusés : React bloque le premier,
 * pas les autres.
 */
export function safeWebLink(value: string | undefined): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  if (/^https?:\/\/\S+$/i.test(text)) return text;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(text)) return `https://${text}`;
  return undefined;
}
