/// <reference types="vite/client" />

// Injecté par `vite-plugin-pwa` en mode `injectManifest` dans `src/sw.ts`.
declare global {
  /** Version de l'application, lue dans `package.json` par `vite.config.ts`. */
  const __APP_VERSION__: string;
  /** Faux dans la version release : pas d'objet de diagnostic `window.__myosm`. */
  const __DIAGNOSTICS__: boolean;
  /** Ce qu'on construit : l'APK, le site web, ou l'image Docker (`vite.config.ts`). */
  const __TARGET__: "apk" | "web" | "docker";
  /** Faux dans la version Docker, qui n'a pas de mode course. */
  const __RUN_MODE__: boolean;

  interface ServiceWorkerGlobalScope {
    __WB_MANIFEST: (string | { url: string; revision: string | null })[];
  }
}
export {};
