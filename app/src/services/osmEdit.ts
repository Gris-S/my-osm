import { CONFIG } from "../config";
import type { TranslationKey } from "../i18n";
import { cleanAddress } from "./webPlace";
import { timeoutSignal } from "../utils/signals";

// ---------------------------------------------------------------------------
// Écrire dans OpenStreetMap : connexion OAuth 2, lieux voisins, création d'un
// point. Sert « + OSM », sur la fiche d'un lieu trouvé sur le web.
//
// Vérifié le 30 septembre 2026, depuis le prototype
// (`~/Documents/MY OSM Proto Contribuer`, sur le serveur de test d'OSM) :
// - OAuth 2 avec PKCE (S256) pour une application **non confidentielle** : une
//   application confidentielle exige un secret, et `/oauth2/token` répond
//   `invalid_client` sans lui (constaté) ;
// - `/oauth2/token` et l'API répondent au CORS, en-tête `Authorization` compris ;
// - créer un point : `PUT /changeset/create`, `POST /nodes`,
//   `PUT /changeset/#id/close`, en XML — le JSON n'est pas accepté en écriture ;
// - les lieux voisins : `GET /map.json?bbox=…`, sans jeton.
// ---------------------------------------------------------------------------

const WEB = CONFIG.OSM_EDIT.WEB;
const API = CONFIG.OSM_EDIT.API;

/** La page d'un objet OSM, pour un lien. */
export function osmObjectUrl(type: string, id: number): string {
  return `${WEB}/${type}/${id}`;
}

/** Là où l'application s'enregistre, pour obtenir son Client ID. */
export const OSM_REGISTER_URL = `${WEB}/oauth2/applications/new`;

// --- PKCE ------------------------------------------------------------------

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/**
 * SHA-256, écrit ici plutôt que demandé à `crypto.subtle` : celui-ci n'existe
 * qu'en contexte sûr, et la version Docker peut être servie en `http://` sur
 * le réseau local. Comparé à celui de Node dans `tests/osmEdit.test.ts`.
 */
export function sha256(data: Uint8Array): Uint8Array {
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const len = data.length;
  const padded = new Uint8Array(((len + 9 + 63) >> 6) << 6);
  padded.set(data);
  padded[len] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, len * 8);
  view.setUint32(padded.length - 8, Math.floor(len / 0x20000000));
  const W = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    H[0] += a;
    H[1] += b;
    H[2] += c;
    H[3] += d;
    H[4] += e;
    H[5] += f;
    H[6] += g;
    H[7] += h;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  H.forEach((v, i) => ov.setUint32(i * 4, v));
  return out;
}

export function makePkce(): { verifier: string; challenge: string } {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  return { verifier, challenge: base64url(sha256(new TextEncoder().encode(verifier))) };
}

// --- Connexion -------------------------------------------------------------

export function authorizeUrl(clientId: string, challenge: string, redirect: string): string {
  const url = new URL(`${WEB}/oauth2/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirect);
  url.searchParams.set("scope", "read_prefs write_api");
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

/**
 * Le code porté par l'adresse de retour, ou l'erreur qu'OSM y a mise (refus
 * de l'utilisateur : `error=access_denied`). `null` si l'adresse n'est pas
 * celle du retour.
 */
export function codeFromRedirect(url: string, redirect: string): { code: string } | { error: string } | null {
  if (!url.startsWith(redirect)) return null;
  let params: URLSearchParams;
  try {
    params = new URL(url).searchParams;
  } catch {
    return null;
  }
  const code = params.get("code");
  if (code) return { code };
  return { error: params.get("error") ?? "unknown" };
}

/** Une erreur dont le message est une clé de traduction : l'interface la dit dans sa langue. */
export class OsmError extends Error {
  readonly key: TranslationKey;
  readonly detail?: string;
  constructor(key: TranslationKey, detail?: string) {
    super(detail ? `${key}: ${detail}` : key);
    this.key = key;
    this.detail = detail;
  }
}

export async function exchangeCode(clientId: string, code: string, verifier: string, redirect: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: code.trim(),
    redirect_uri: redirect,
    client_id: clientId,
    code_verifier: verifier,
  });
  const res = await fetch(`${WEB}/oauth2/token`, { method: "POST", body, signal: timeoutSignal(15000) });
  const text = await res.text();
  // Le cas rencontré en vrai : la case « Confidential application? » est
  // cochée par défaut sur OSM, et le code est alors refusé faute de secret.
  if (res.status === 401 && text.includes("invalid_client")) throw new OsmError("osm.error.confidential");
  if (res.status === 400 && text.includes("invalid_grant")) throw new OsmError("osm.error.codeExpired");
  if (!res.ok) throw new OsmError("osm.error.http", `${res.status} ${text.slice(0, 160)}`);
  const token = (JSON.parse(text) as { access_token?: string }).access_token;
  if (!token) throw new OsmError("osm.error.http", "no access_token");
  return token;
}

/** Le pseudo du compte : l'état du jeton est établi par un appel réel, comme pour les clés d'API. */
export async function whoAmI(token: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(`${API}/user/details.json`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: signal ?? timeoutSignal(15000),
  });
  if (res.status === 401 || res.status === 403) throw new OsmError("osm.error.revoked");
  if (!res.ok) throw new OsmError("osm.error.unreachable", String(res.status));
  const data = (await res.json()) as { user?: { display_name?: string } };
  return data.user?.display_name ?? "?";
}

// --- Lieux voisins ---------------------------------------------------------

export interface Nearby {
  id: number;
  type: string;
  name: string;
  distance: number;
  /** Sans doute le même lieu (`sameName`, accents et casse ignorés). */
  similar: boolean;
}

export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function metres(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

interface MapElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  tags?: Record<string, string>;
}

/**
 * Deux noms (déjà normalisés) qui désignent sans doute le même lieu : l'un
 * contient l'autre, **et** le plus court en fait au moins la moitié.
 * « McDonald's » et « McDonald's Montussan » se reconnaissent ; « Test » et
 * « Boulangerie Test » non — constaté sur le serveur de test, où un point
 * « test » passait pour un doublon de toute boulangerie de ce nom.
 */
export function sameName(a: string, b: string): boolean {
  if (!a || !b) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return long.includes(short) && short.length * 2 >= long.length;
}

/** Tri des lieux nommés rendus par `/map.json` — fonction pure, testée. */
export function namedAround(elements: MapElement[], lat: number, lon: number, name: string): Nearby[] {
  const nodes = new Map<number, { lat: number; lon: number }>();
  for (const e of elements) if (e.type === "node" && e.lat !== undefined && e.lon !== undefined) nodes.set(e.id, { lat: e.lat, lon: e.lon });
  const wanted = normalizeName(name);
  const out: Nearby[] = [];
  for (const e of elements) {
    const n = e.tags?.name;
    // Une rue porte un nom, mais ce n'est pas un doublon d'un commerce.
    if (!n || e.type === "relation" || e.tags?.highway) continue;
    // Un bâtiment (chemin) est placé à son premier nœud : assez près pour 100 m.
    const pos = e.type === "node" ? nodes.get(e.id) : e.nodes?.length ? nodes.get(e.nodes[0]) : undefined;
    if (!pos) continue;
    const similar = sameName(wanted, normalizeName(n));
    out.push({ id: e.id, type: e.type, name: n, distance: Math.round(metres(lat, lon, pos.lat, pos.lon)), similar });
  }
  return out.sort((a, b) => Number(b.similar) - Number(a.similar) || a.distance - b.distance);
}

/** Les lieux nommés à ~100 m, lus sur OSM. */
export async function nearbyNamed(lat: number, lon: number, name: string, signal?: AbortSignal): Promise<Nearby[]> {
  const dLat = 0.0009;
  const dLon = 0.0009 / Math.cos((lat * Math.PI) / 180);
  const bbox = [lon - dLon, lat - dLat, lon + dLon, lat + dLat].map((v) => v.toFixed(6)).join(",");
  const res = await fetch(`${API}/map.json?bbox=${bbox}`, { signal });
  if (!res.ok) throw new OsmError("osm.error.unreachable", String(res.status));
  const data = (await res.json()) as { elements: MapElement[] };
  return namedAround(data.elements, lat, lon, name);
}

// --- Ce qui sera écrit -----------------------------------------------------

/**
 * Les catégories proposées : les balises OSM les plus courantes pour un
 * commerce. Sans elle, un point n'a que son nom — ni icône, ni recherche par
 * type —, d'où l'obligation d'en choisir une.
 */
export const OSM_CATEGORIES: { id: string; label: TranslationKey; tag: [string, string] }[] = [
  { id: "restaurant", label: "osm.cat.restaurant", tag: ["amenity", "restaurant"] },
  { id: "fast_food", label: "osm.cat.fastFood", tag: ["amenity", "fast_food"] },
  { id: "cafe", label: "osm.cat.cafe", tag: ["amenity", "cafe"] },
  { id: "bar", label: "osm.cat.bar", tag: ["amenity", "bar"] },
  { id: "pharmacy", label: "osm.cat.pharmacy", tag: ["amenity", "pharmacy"] },
  { id: "bakery", label: "osm.cat.bakery", tag: ["shop", "bakery"] },
  { id: "pastry", label: "osm.cat.pastry", tag: ["shop", "pastry"] },
  { id: "cheese", label: "osm.cat.cheese", tag: ["shop", "cheese"] },
  { id: "butcher", label: "osm.cat.butcher", tag: ["shop", "butcher"] },
  { id: "seafood", label: "osm.cat.seafood", tag: ["shop", "seafood"] },
  { id: "greengrocer", label: "osm.cat.greengrocer", tag: ["shop", "greengrocer"] },
  { id: "deli", label: "osm.cat.deli", tag: ["shop", "deli"] },
  { id: "wine", label: "osm.cat.wine", tag: ["shop", "wine"] },
  { id: "supermarket", label: "osm.cat.supermarket", tag: ["shop", "supermarket"] },
  { id: "convenience", label: "osm.cat.convenience", tag: ["shop", "convenience"] },
  { id: "hairdresser", label: "osm.cat.hairdresser", tag: ["shop", "hairdresser"] },
  { id: "clothes", label: "osm.cat.clothes", tag: ["shop", "clothes"] },
  { id: "hotel", label: "osm.cat.hotel", tag: ["tourism", "hotel"] },
  { id: "shop", label: "osm.cat.shop", tag: ["shop", "yes"] },
];

export interface ContribForm {
  name: string;
  category: string;
  housenumber: string;
  street: string;
  postcode: string;
  city: string;
  phone: string;
  website: string;
}

/** Téléphone au format international que recommande OSM : `+33 1 23 45 67 89`. */
export function phoneForOsm(raw: string): string {
  const compact = raw.replace(/[^\d+]/g, "");
  const national = compact.match(/^0(\d{9})$/) ?? compact.match(/^\+33(\d{9})$/) ?? compact.match(/^0033(\d{9})$/);
  if (national) return `+33 ${national[1].replace(/^(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/, "$1 $2 $3 $4 $5")}`;
  return raw.trim();
}

export function websiteForOsm(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

export function tagsFor(form: ContribForm): Record<string, string> {
  const tags: Record<string, string> = {};
  const category = OSM_CATEGORIES.find((c) => c.id === form.category);
  if (category) tags[category.tag[0]] = category.tag[1];
  const set = (key: string, value: string) => {
    const v = value.trim();
    if (v) tags[key] = v;
  };
  set("name", form.name);
  set("addr:housenumber", form.housenumber);
  set("addr:street", form.street);
  set("addr:postcode", form.postcode);
  set("addr:city", form.city);
  set("phone", phoneForOsm(form.phone));
  set("website", websiteForOsm(form.website));
  return tags;
}

/**
 * Une adresse française d'une ligne découpée en champs : « 12 Rue de Rivoli,
 * 75004 Paris », ou telle que DuckDuckGo la donne, « 3 Rte de Lalande Nationale
 * 89, Montussan, FR 33450 » (nettoyée d'abord par `cleanAddress`), ou sans
 * virgule, « 19 rue du Midi 94300 Vincennes ». Ce qu'on ne
 * reconnaît pas reste vide, à compléter à la main, plutôt que d'être deviné.
 */
export function splitAddress(address: string): Pick<ContribForm, "housenumber" | "street" | "postcode" | "city"> {
  const out = { housenumber: "", street: "", postcode: "", city: "" };
  const parts = cleanAddress(address)
    // Le code postal ouvre toujours un morceau : une adresse de page arrive
    // souvent sans virgule — « 19 rue du Midi 94300 Vincennes » (constaté) —,
    // et tout finissait dans la rue.
    .replace(/\s+(\d{5})(?=\s|$)/g, ", $1")
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p && !/^(france|fr)$/i.test(p));
  if (!parts.length) return out;
  const first = parts[0].match(/^(\d+(?:\s?(?:bis|ter|[a-d]))?)\s+(\D.*)$/i);
  if (first) {
    out.housenumber = first[1].replace(/\s+/g, "");
    out.street = first[2];
  } else if (!/\b\d{5}\b/.test(parts[0])) {
    out.street = parts[0];
  }
  for (const part of parts.slice(1)) {
    let m: RegExpMatchArray | null;
    if ((m = part.match(/^(\d{5})\s+(\D.*)$/))) {
      out.postcode = m[1];
      out.city = m[2];
    } else if ((m = part.match(/^(\D.*?)\s+(\d{5})$/))) {
      out.city = m[1];
      out.postcode = m[2];
    } else if (/^\d{5}$/.test(part)) {
      out.postcode = part;
    } else if (!/\d/.test(part) && !out.city) {
      out.city = part;
    }
  }
  out.street = capitalizeStreet(out.street);
  // « 75004 Paris » seul en première partie : ni numéro ni rue.
  if (!first && /\b\d{5}\b/.test(parts[0])) {
    const m = parts[0].match(/^(\d{5})\s+(\D.*)$/);
    if (m) {
      out.postcode = m[1];
      out.city = m[2];
    }
  }
  return out;
}

/**
 * La majuscule initiale d'une rue, telle qu'OSM l'écrit : une page web donne
 * souvent « rue du Midi », OSM « Rue du Midi ». C'est la règle des pays que
 * l'application couvre (France, mais aussi « Via Roma », « Calle Mayor »,
 * « Hauptstraße », « High Street » — le nom commence par une majuscule).
 * Seule la **première lettre** change, jamais le reste (« de », « du »…), et
 * **pas après une apostrophe** : aux Pays-Bas, « 's-Gravendijkwal » s'écrit
 * avec un s minuscule.
 */
export function capitalizeStreet(street: string): string {
  const first = street.charAt(0);
  if (!first || first === "'" || first === "’") return street;
  return first.toLocaleUpperCase() + street.slice(1);
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function tagsXml(tags: Record<string, string>): string {
  return Object.entries(tags)
    .map(([k, v]) => `<tag k="${esc(k)}" v="${esc(v)}"/>`)
    .join("");
}

async function call(token: string, method: string, path: string, body?: string): Promise<string> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/xml; charset=utf-8" },
    body,
    signal: timeoutSignal(20000),
  });
  const text = await res.text();
  if (res.status === 401 || res.status === 403) throw new OsmError("osm.error.revoked", text.slice(0, 160));
  if (!res.ok) throw new OsmError("osm.error.http", `${method} ${path} → ${res.status} ${text.slice(0, 160)}`);
  return text.trim();
}

export type SendStep = "changeset" | "node" | "close";

/**
 * Un lieu = un groupe de modifications avec un seul point. Le groupe est
 * refermé même si le point échoue : ouvert, il se fermerait seul au bout
 * d'une heure, mais autant ne rien laisser traîner.
 */
export async function createPlace(
  token: string,
  lat: number,
  lon: number,
  tags: Record<string, string>,
  version: string,
  onStep: (step: SendStep) => void
): Promise<{ node: number; changeset: number }> {
  onStep("changeset");
  const changesetTags = { created_by: `MY OSM ${version}`, comment: `Add ${tags.name ?? "place"}` };
  const changeset = Number(await call(token, "PUT", "/changeset/create", `<osm><changeset>${tagsXml(changesetTags)}</changeset></osm>`));
  if (!Number.isFinite(changeset) || changeset <= 0) throw new OsmError("osm.error.http", "changeset id");
  try {
    onStep("node");
    const node = Number(
      await call(
        token,
        "POST",
        "/nodes",
        `<osm><node changeset="${changeset}" lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}">${tagsXml(tags)}</node></osm>`
      )
    );
    if (!Number.isFinite(node) || node <= 0) throw new OsmError("osm.error.http", "node id");
    return { node, changeset };
  } finally {
    onStep("close");
    await call(token, "PUT", `/changeset/${changeset}/close`).catch(() => {});
  }
}
