// Un navigateur minimal pour les modules qui lisent la fenêtre au chargement :
// la langue (`i18n`) écrit `document.documentElement.lang`, les réglages lisent
// `localStorage`. Rien de plus — les tests portent sur des calculs.
const store = new Map<string, string>();
const g = globalThis as Record<string, unknown>;
// Défini d'office, sans lire l'existant : Node expose un `localStorage`
// expérimental dont la simple lecture émet un avertissement à chaque fichier.
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  },
});
g.window ??= globalThis;
g.document ??= {
  documentElement: { lang: "fr" },
  addEventListener: () => {},
  visibilityState: "visible",
};
g.addEventListener ??= () => {};
g.removeEventListener ??= () => {};
g.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
