// ---------------------------------------------------------------------------
// Ce que l'application empaquetée (APK) sait faire de plus qu'un navigateur.
//
// La page ne dépend pas de `@capacitor/core` : elle atteint les greffons par
// `window.Capacitor`, qu'Android injecte, et se comporte en site web ordinaire
// quand il n'est pas là.
//
// **Les relais.** Le flux Bison Futé n'autorise pas l'origine croisée et passe,
// en développement, par le serveur de Vite (`vite.config.ts`). (Le point
// d'authentification de Météo-France était dans ce cas ; il a été retiré avec
// l'identifiant et le secret, le 17 septembre 2026.) Dans l'APK il n'y a
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
    data?: unknown;
    responseType?: "text" | "json" | "arraybuffer";
    connectTimeout?: number;
    readTimeout?: number;
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

// ---------------------------------------------------------------------------
// Le secours natif : quand la WebView refuse le réseau que le téléphone a.
//
// Constaté le 3 octobre 2026, en voiture : en quittant le wifi de la maison, la
// WebView s'est déclarée hors ligne (`navigator.onLine` faux) et **ne s'est
// jamais redéclarée en ligne**, vingt minutes durant, alors que le téléphone
// était en 4G et que la musique arrivait par le réseau. Dans cet état, tous
// ses `fetch` échouent : la carte est restée vide sous le trait bleu, et aucun
// recalcul n'a pu se faire. Seul un redémarrage de l'application l'en a sortie.
//
// L'état ne se reproduit pas à la demande — couper le wifi au câble donne une
// bascule propre. Il se **simule** en revanche (débogage de la WebView,
// `Network.emulateNetworkConditions`) : drapeau faux, `fetch` en échec,
// téléphone connecté. Et dans cet état simulé, la requête native aboutit
// (mesuré : une tuile de 125 ko en 46 ms). D'où ce secours, qui ne dépend pas
// de la cause : **on essaie toujours `fetch` d'abord**, et l'on ne passe par le
// natif que s'il échoue. Si le téléphone est vraiment hors ligne, le natif
// échoue aussi, tout de suite, et l'erreur d'origine remonte.
//
// Réservé à ce dont un trajet ne peut pas se passer — le fond de carte et le
// calcul d'itinéraire (`RESCUE_HOSTS`) : une requête native sort des règles
// d'origine et de la politique de contenu de la page, elle ne doit pas devenir
// la voie ordinaire. Dans un navigateur (version Docker), rien ne change.
// ---------------------------------------------------------------------------

const RESCUE_HOSTS = new Set([
  "tiles.openfreemap.org",
  new URL(CONFIG.TOMTOM_ROUTING_URL).host,
  new URL(CONFIG.OSRM_ROUTING.driving).host,
]);

/** Combien de requêtes sont passées par le secours — pour le journal et le diagnostic. */
export const nativeRescueStats = { used: 0, failed: 0 };

/**
 * Après un échec du natif, on ne le retente pas avant ce délai : le téléphone
 * est vraiment hors ligne, et chaque tentative met plusieurs secondes à
 * renoncer (sept, mesuré en mode avion) — autant de secondes pendant
 * lesquelles la carte attendrait pour rien avant de dire qu'elle n'a pas la
 * tuile.
 */
const RESCUE_RETRY_MS = 15_000;
let rescueDownUntil = 0;

const rescueListeners = new Set<() => void>();

/** Prévenu à chaque requête sauvée par le natif (le journal s'y abonne). */
export function onNativeRescue(listener: () => void): () => void {
  rescueListeners.add(listener);
  return () => {
    rescueListeners.delete(listener);
  };
}

function rescuePlugin(url: string): CapacitorHttpPlugin | undefined {
  if (!isNativeApp()) return undefined;
  try {
    if (!RESCUE_HOSTS.has(new URL(url).host)) return undefined;
  } catch {
    return undefined;
  }
  return capacitor()?.Plugins?.CapacitorHttp as CapacitorHttpPlugin | undefined;
}

/** Vrai si une requête vers cette adresse a un secours natif — donc s'il vaut la peine d'essayer même « hors ligne ». */
export function hasNativeRescue(url: string): boolean {
  return rescuePlugin(url) !== undefined;
}

function bytesFromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Le corps d'une réponse native, tel que `Response` le veut.
 *
 * Le greffon ne rend du base64 que pour ce qui n'est **ni du JSON ni une
 * erreur**, quoi qu'on lui demande (mesuré sur le téléphone, `responseType:
 * "arraybuffer"` dans les trois cas) : une tuile arrive en base64, la réponse
 * de TomTom en **objet déjà lu**, et le corps d'un 401 en texte. La première
 * version n'attendait que du base64 : les tuiles passaient, et chaque recalcul
 * était rejeté comme illisible — puis annoncé « hors ligne ».
 */
function rescuedBody(res: CapacitorHttpResponse): BodyInit {
  if (typeof res.data !== "string") return JSON.stringify(res.data ?? null);
  const type = Object.entries(res.headers ?? {}).find(([name]) => name.toLowerCase() === "content-type")?.[1] ?? "";
  const textual = /json|text|xml|html/i.test(type) || res.status < 200 || res.status >= 300;
  if (textual) return res.data;
  try {
    return bytesFromBase64(res.data);
  } catch {
    return res.data;
  }
}

/**
 * Ce que l'application dit d'elle-même aux services qu'elle interroge : son
 * nom, sa version, et l'adresse publique du projet comme contact — jamais une
 * adresse personnelle. Les politiques d'usage d'OSM l'exigent (Nominatim :
 * « stock User-Agents will not do »).
 */
export function appUserAgent(): string {
  return `MY-OSM/${__APP_VERSION__} (+${CONFIG.PROJECT_URL})`;
}

/** Ce qu'on sait demander au natif : le sous-ensemble de `RequestInit` dont l'application se sert. */
export type NativeInit = { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal | null };

/** Une requête par le greffon natif, rendue en vraie `Response`. Lève si le réseau manque. */
async function nativeRequest(http: CapacitorHttpPlugin, url: string, init: NativeInit): Promise<Response> {
  const { signal } = init;
  // Le greffon ne sait pas s'interrompre : on respecte l'annulation avant
  // l'appel, et pendant (voir plus bas).
  if (signal?.aborted) throw new DOMException("Annulé", "AbortError");
  const sent: Record<string, string> = { "User-Agent": appUserAgent(), ...init.headers };
  // `fetch` annonce de lui-même un corps de texte ; le greffon, non.
  if (init.body !== undefined && !Object.keys(sent).some((name) => name.toLowerCase() === "content-type")) {
    sent["Content-Type"] = "text/plain;charset=UTF-8";
  }
  const isJson = /json/i.test(Object.entries(sent).find(([name]) => name.toLowerCase() === "content-type")?.[1] ?? "");
  // Le corps brut, en base64 : le greffon lirait sinon le JSON à sa façon,
  // et une tuile binaire ne survivrait pas à un passage par du texte.
  const request = http.request({
    url,
    method: init.method ?? "GET",
    headers: sent,
    ...(init.body !== undefined ? { data: isJson ? JSON.parse(init.body) : init.body } : {}),
    responseType: "arraybuffer",
    connectTimeout: 20_000,
    readTimeout: 60_000,
  });
  // Une annulation **rend la main tout de suite**, comme avec `fetch` : les
  // délais d'attente de l'application (Overpass, vingt-cinq secondes) passent
  // par elle. La requête native, elle, va à son terme dans le vide.
  const res = await (signal
    ? Promise.race([
        request,
        new Promise<never>((_, reject) =>
          signal.addEventListener("abort", () => reject(new DOMException("Annulé", "AbortError")), { once: true }),
        ),
      ])
    : request);
  const headers = new Headers();
  for (const [name, value] of Object.entries(res.headers ?? {})) {
    // `Content-Encoding` : le natif a déjà décompressé. Les en-têtes
    // `X-Android-…` et les noms invalides ne regardent personne.
    if (/^(content-encoding|content-length)$/i.test(name) || /^x-android-/i.test(name)) continue;
    try {
      headers.set(name, value);
    } catch {
      /* en-tête que `Headers` refuse */
    }
  }
  // 204 et 304 n'ont pas de corps, et `Response` refuse qu'on leur en donne un.
  const empty = res.status === 204 || res.status === 304;
  return new Response(empty ? null : rescuedBody(res), { status: res.status, headers });
}

// ---------------------------------------------------------------------------
// Les services de la communauté OSM, interrogés **en se nommant**.
//
// Demande de la relecture F-Droid (3 octobre 2026) : Nominatim, OSRM et
// Valhalla de la FOSSGIS et Overpass partaient en `fetch` ordinaire, donc avec
// le `User-Agent` de série de la WebView — ce que la politique de Nominatim
// refuse en toutes lettres. Une WebView ne peut pas fixer cet en-tête ; le
// greffon natif, si. Dans l'APK, ces hôtes passent donc **toujours** par lui,
// avec `MY-OSM/<version>`.
//
// Dans un navigateur (version Docker), rien ne change : `fetch`, avec le
// `User-Agent` du navigateur et le `Referer` du site, ce que ces mêmes
// politiques acceptent d'une page web.
// ---------------------------------------------------------------------------

const OSM_HOSTS = new Set(
  [
    CONFIG.NOMINATIM_REVERSE_URL,
    CONFIG.NOMINATIM_LOOKUP_URL,
    CONFIG.OSRM_ROUTING.driving,
    CONFIG.OSRM_ROUTING.walking,
    CONFIG.BIKE_ROUTING.VALHALLA_URL,
    CONFIG.BIKE_ROUTING.TRACE_ATTRIBUTES_URL,
    CONFIG.BIKE_ROUTING.BROUTER_URL,
    ...CONFIG.OVERPASS_URLS,
  ].map((url) => new URL(url).host),
);

/** Vrai si cette adresse est celle d'un service de la communauté OSM. */
export function isOsmService(url: string): boolean {
  try {
    return OSM_HOSTS.has(new URL(url).host);
  } catch {
    return false;
  }
}

/**
 * `fetch` vers un service d'OSM : par le natif dans l'APK, pour s'y nommer.
 * Même signature utile que `fetch`, même `Response`, mêmes erreurs de réseau.
 */
export async function osmFetch(url: string | URL, init: NativeInit = {}): Promise<Response> {
  const address = url.toString();
  const http =
    isNativeApp() && isOsmService(address)
      ? (capacitor()?.Plugins?.CapacitorHttp as CapacitorHttpPlugin | undefined)
      : undefined;
  if (!http) {
    const { signal, ...rest } = init;
    return fetch(address, { ...rest, signal: signal ?? undefined });
  }
  return nativeRequest(http, address, init);
}

/**
 * `fetch`, puis le natif si `fetch` échoue faute de réseau.
 *
 * Rend une vraie `Response` dans les deux cas : l'appelant ne voit pas la
 * différence. Une annulation remonte telle quelle, sans secours. Un service
 * d'OSM, lui, passe d'emblée par le natif (`osmFetch`) : il n'y a alors rien
 * à secourir.
 */
export async function rescuedFetch(url: string, init: NativeInit = {}): Promise<Response> {
  if (isNativeApp() && isOsmService(url)) return osmFetch(url, init);
  const { signal, ...rest } = init;
  try {
    return await fetch(url, { ...rest, signal: signal ?? undefined });
  } catch (error) {
    if (signal?.aborted) throw error;
    const http = rescuePlugin(url);
    if (!http || Date.now() < rescueDownUntil) throw error;
    try {
      const response = await nativeRequest(http, url, init);
      nativeRescueStats.used += 1;
      rescueListeners.forEach((listener) => listener());
      return response;
    } catch (rescueError) {
      if (signal?.aborted) throw rescueError;
      nativeRescueStats.failed += 1;
      rescueDownUntil = Date.now() + RESCUE_RETRY_MS;
      // Le natif n'a pas mieux réussi : le téléphone est bien hors ligne.
      throw error;
    }
  }
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
