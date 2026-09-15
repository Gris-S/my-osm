// ---------------------------------------------------------------------------
// Ce que l'application empaquetée (APK) sait faire de plus qu'un navigateur.
//
// La page ne dépend pas de `@capacitor/core` : elle atteint les greffons par
// `window.Capacitor`, qu'Android injecte, et se comporte en site web ordinaire
// quand il n'est pas là.
//
// **Les relais.** Deux services n'autorisent pas l'origine croisée — le flux
// Bison Futé et le point d'authentification de Météo-France — et passent, en
// développement, par le serveur de Vite (`vite.config.ts`). Dans l'APK il n'y a
// pas de serveur : l'adresse relative tombait sur l'application elle-même, qui
// répondait par sa propre page HTML — vérifié sur le téléphone, 200 et
// `text/html` pour les deux. Le greffon `CapacitorHttp` fait la requête côté
// natif, hors des règles d'origine du navigateur ; vérifié aussi : 200 et le
// flux XML de 4,8 Mo.
//
// Le greffon n'est **pas** activé pour tout `fetch` (`CapacitorHttp.enabled`) :
// il ferait passer chaque requête de l'application — tuiles comprises — par le
// pont natif. Seuls les appels relayés l'empruntent.
// ---------------------------------------------------------------------------

import { CONFIG } from "../config";

interface CapacitorHttpResponse {
  status: number;
  data: unknown;
  headers: Record<string, string>;
}

interface CapacitorHttpPlugin {
  request(options: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    responseType?: "text" | "json";
  }): Promise<CapacitorHttpResponse>;
}

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  Plugins?: Record<string, unknown>;
}

function capacitor(): CapacitorGlobal | undefined {
  return (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
}

/** Vrai dans l'application Android, faux dans un navigateur. */
export function isNativeApp(): boolean {
  return capacitor()?.isNativePlatform?.() === true;
}

/** La réponse d'un appel relayé : le strict nécessaire de `Response`. */
export interface RelayedResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json<T>(): Promise<T>;
}

/**
 * Appelle un service relayé.
 *
 * Dans un navigateur, l'adresse relative (`/api/…`) part au serveur, qui relaie.
 * Dans l'APK, elle est traduite en adresse réelle (`CONFIG.RELAY_TARGETS`) et
 * la requête part du natif. La chaîne de requête suit dans les deux cas.
 */
export async function relayedFetch(
  path: string,
  init: { method?: "GET" | "POST"; headers?: Record<string, string>; signal?: AbortSignal } = {},
): Promise<RelayedResponse> {
  const http = isNativeApp() ? (capacitor()?.Plugins?.CapacitorHttp as CapacitorHttpPlugin | undefined) : undefined;
  if (!http) return fetch(path, init);

  const prefix = Object.keys(CONFIG.RELAY_TARGETS).find((relay) => path.startsWith(relay));
  if (!prefix) return fetch(path, init);
  const url = CONFIG.RELAY_TARGETS[prefix] + path.slice(prefix.length);

  // Le greffon ne sait pas s'interrompre : on respecte au moins l'annulation
  // avant et après l'appel.
  if (init.signal?.aborted) throw new DOMException("Annulé", "AbortError");
  const res = await http.request({ url, method: init.method ?? "GET", headers: init.headers, responseType: "text" });
  if (init.signal?.aborted) throw new DOMException("Annulé", "AbortError");

  // Le greffon rend parfois un objet déjà lu quand la réponse est du JSON.
  const asText = () => (typeof res.data === "string" ? res.data : JSON.stringify(res.data));
  return {
    ok: res.status >= 200 && res.status < 300,
    status: res.status,
    text: async () => asText(),
    json: async <T,>() => (typeof res.data === "string" ? JSON.parse(res.data) : res.data) as T,
  };
}

/**
 * Confie le geste « retour » d'Android à `onBack`. Tant qu'une écoute est
 * posée, le greffon `App` n'applique plus son comportement par défaut, qui
 * fermait l'application (voir `hooks/useBackClose.ts`). Dans un navigateur, il
 * n'y a rien à écouter.
 */
export function installBackGesture(onBack: () => void): void {
  const app = isNativeApp()
    ? (capacitor()?.Plugins?.App as { addListener(event: "backButton", listener: () => void): unknown } | undefined)
    : undefined;
  if (!app) return;
  // Le proxy du pont natif ne rend pas toujours une promesse (voir `ambientLight.ts`).
  void Promise.resolve(app.addListener("backButton", onBack)).catch(() => {});
}

interface AppUrlPlugin {
  getLaunchUrl(): unknown;
  addListener(event: "appUrlOpen", listener: (data: { url?: unknown } | null) => void): unknown;
}

function appPlugin(): AppUrlPlugin | undefined {
  return isNativeApp() ? (capacitor()?.Plugins?.App as AppUrlPlugin | undefined) : undefined;
}

function removeHandle(handle: unknown) {
  try {
    const remove = (handle as { remove?: unknown } | null)?.remove;
    if (typeof remove === "function") void Promise.resolve(remove.call(handle)).catch(() => {});
  } catch {
    /* rien à retirer */
  }
}

/**
 * L'adresse qui a lancé l'application — un lien `geo:` touché dans une autre
 * application, un texte partagé (voir `services/incoming.ts`). `null` hors APK
 * ou pour un lancement ordinaire.
 */
export async function launchUrl(): Promise<string | null> {
  const app = appPlugin();
  if (!app) return null;
  try {
    const url = ((await Promise.resolve(app.getLaunchUrl())) as { url?: unknown } | null)?.url;
    return typeof url === "string" && url ? url : null;
  } catch {
    return null;
  }
}

/** Les adresses reçues pendant que l'application tourne. Rend la fonction qui arrête l'écoute. */
export function listenAppUrls(onUrl: (url: string) => void): () => void {
  const app = appPlugin();
  if (!app) return () => {};
  let handle: unknown = null;
  let stopped = false;
  try {
    void Promise.resolve(
      app.addListener("appUrlOpen", (data) => {
        if (typeof data?.url === "string") onUrl(data.url);
      })
    ).then(
      (resolved) => {
        if (stopped) removeHandle(resolved);
        else handle = resolved;
      },
      () => {}
    );
  } catch {
    /* greffon absent : rien à écouter */
  }
  return () => {
    stopped = true;
    if (handle) removeHandle(handle);
  };
}
