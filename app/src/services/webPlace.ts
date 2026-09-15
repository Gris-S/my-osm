import type { Place } from "../types";

// ---------------------------------------------------------------------------
// Retrouver un lieu dans ce que montre le web : liens de cartes, coordonnées
// collées, données structurées d'une page.
//
// Fonctions pures, sans réseau ni DOM. Elles servent la recherche sur le web
// (`services/webSearch.ts`, navigateur intégré de l'APK) et la barre de
// recherche, qui reconnaît un lien de carte ou des coordonnées collés. **Rien
// ici n'appelle un service** : lire un lien Google Maps, c'est lire son texte,
// pas l'ouvrir.
// ---------------------------------------------------------------------------

/** Ce qu'une page, une sélection ou un lien apprend du lieu cherché. */
export interface WebCandidate {
  name?: string;
  address?: string;
  lat?: number;
  lon?: number;
  phone?: string;
  website?: string;
}

/** Ce qu'on tire d'un lien de carte. */
export type MapLink =
  | { kind: "point"; lat: number; lon: number; label?: string }
  | { kind: "query"; text: string }
  /** Lien raccourci (`maps.app.goo.gl`) : le lire demanderait d'interroger Google. */
  | { kind: "short" };

/** Ce que le script injecté relève dans une page (voir `webSearch.ts`). */
export interface WebPageData {
  url?: unknown;
  title?: unknown;
  ld?: unknown;
  addr?: unknown;
  metas?: unknown;
  links?: unknown;
  /** La fiche d'un lieu affichée seule par DuckDuckGo : nom, champs (`dd`), site. */
  card?: unknown;
}

/**
 * Liens que le navigateur intégré **n'ouvre pas** : il les passe à la page,
 * qui en lit la position. Syntaxe commune à JavaScript et à Java — le greffon
 * les compile telles quelles, sans casse. Tenir d'accord avec `parseMapLink`.
 */
export const WEB_LINK_PATTERNS: string[] = [
  "^geo:",
  "^google\\.navigation:",
  "^https?://(maps\\.app\\.goo\\.gl|goo\\.gl/maps)",
  "^https?://(www\\.)?google\\.[a-z.]+/maps",
  "^https?://maps\\.google\\.[a-z.]+",
  "^https?://maps\\.apple\\.com",
  "^https?://((www|ul)\\.)?waze\\.com/(ul|live-map)",
  "^https?://(www\\.)?bing\\.com/maps",
  "^https?://(www\\.)?(openstreetmap\\.org|osm\\.org)/",
  "^https?://(wego|share)\\.here\\.com",
];

/**
 * Hôtes refusés par le navigateur intégré, pour la page comme pour ses
 * ressources : **aucune requête ne leur part**. Google — polices, statistiques,
 * publicités, cartes et vidéos intégrées — et la mesure d'audience de
 * DuckDuckGo (`improving.duckduckgo.com`) : mesuré sur une page de résultats,
 * 24 envois (affichages, délais, accroches pour l'IA), qu'aucun réglage ne
 * coupe. Une page qui en dépend s'affiche moins bien, c'est le prix. Appliquée
 * au nom d'hôte seul, sans casse.
 */
export const WEB_BLOCKED_HOSTS =
  "(^|\\.)(google(\\.[a-z]{2,3}){1,2}|googleapis\\.com|gstatic\\.com|googletagmanager\\.com|google-analytics\\.com" +
  "|googlesyndication\\.com|googleadservices\\.com|doubleclick\\.net|googleusercontent\\.com|ggpht\\.com" +
  "|youtube\\.com|youtube-nocookie\\.com|ytimg\\.com|gvt[12]\\.com|recaptcha\\.net|goo\\.gl" +
  "|improving\\.duckduckgo\\.com)$";

/** Deux nombres décimaux côte à côte : latitude puis longitude. */
const COORDS = /(-?\d{1,2}\.\d+)\s*[,~_;\s]\s*(-?\d{1,3}\.\d+)/;

function validPoint(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0)
  );
}

function coordsIn(value: string | null | undefined): { lat: number; lon: number } | null {
  if (!value) return null;
  const match = COORDS.exec(value);
  if (!match) return null;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  return validPoint(lat, lon) ? { lat, lon } : null;
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
  }
}

function clean(value: string | null | undefined): string | undefined {
  const text = value?.replace(/\s+/g, " ").trim();
  return text ? text : undefined;
}

function point(at: { lat: number; lon: number }, label?: string | null): MapLink {
  return { kind: "point", lat: at.lat, lon: at.lon, label: clean(label) };
}

function query(text: string | null | undefined): MapLink | null {
  const cleaned = clean(text);
  return cleaned ? { kind: "query", text: cleaned } : null;
}

/** Coordonnées tapées ou collées : « 48.8566, 2.3522 », « 48.8566 2.3522 ». */
export function parseCoordinates(text: string): { lat: number; lon: number } | null {
  const match = /^\s*(-?\d{1,2}\.\d+)\s*[,;\s]\s*(-?\d{1,3}\.\d+)\s*$/.exec(text);
  if (!match) return null;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  return validPoint(lat, lon) ? { lat, lon } : null;
}

/**
 * La position ou l'adresse qu'un lien de carte désigne.
 *
 * Chaque service a sa façon de l'écrire, relevée sur leurs liens de partage et
 * d'itinéraire. Une position l'emporte sur un texte : elle se passe de
 * géocodage. Un lien qui n'est pas celui d'une carte rend `null`.
 */
export function parseMapLink(raw: string): MapLink | null {
  const text = raw.trim();

  if (/^geo:/i.test(text)) {
    const at = /^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i.exec(text);
    const q = /[?&]q=([^&]+)/.exec(text);
    const asked = q ? decode(q[1]) : undefined;
    // `geo:0,0?q=48.85,2.29(Tour Eiffel)` : la position est dans la question.
    const inQuestion = coordsIn(asked);
    if (inQuestion) return point(inQuestion, /\(([^)]+)\)\s*$/.exec(asked ?? "")?.[1]);
    if (at) {
      const lat = Number(at[1]);
      const lon = Number(at[2]);
      if (validPoint(lat, lon)) return point({ lat, lon });
    }
    return query(asked?.replace(/\([^)]*\)\s*$/, ""));
  }

  // L'intention « naviguer vers » d'Android : `google.navigation:q=…`.
  if (/^google\.navigation:/i.test(text)) {
    const params = new URLSearchParams(text.slice(text.indexOf(":") + 1));
    const at = coordsIn(params.get("ll")) ?? coordsIn(params.get("q"));
    return at ? point(at) : query(params.get("q"));
  }

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const params = url.searchParams;
  const path = decode(url.pathname);

  if (host === "maps.app.goo.gl" || (host === "goo.gl" && url.pathname.startsWith("/maps"))) return { kind: "short" };

  if (/^(maps\.)?google\.[a-z.]+$/.test(host) && (host.startsWith("maps.") || url.pathname.startsWith("/maps"))) {
    const name = /\/maps\/place\/([^/]+)/.exec(path)?.[1];
    // `!3d…!4d…` est le lieu lui-même ; `@lat,lon` n'est que le centre de la vue.
    const pin = /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/.exec(text);
    if (pin && validPoint(Number(pin[1]), Number(pin[2]))) return point({ lat: Number(pin[1]), lon: Number(pin[2]) }, name);
    for (const key of ["q", "query", "ll", "center", "daddr", "destination"]) {
      const at = coordsIn(params.get(key));
      if (at) return point(at, name);
    }
    const view = /@(-?\d+\.\d+),(-?\d+\.\d+)/.exec(path);
    if (view && validPoint(Number(view[1]), Number(view[2]))) return point({ lat: Number(view[1]), lon: Number(view[2]) }, name);
    return query(params.get("q") ?? params.get("query") ?? params.get("destination") ?? params.get("daddr") ?? name);
  }

  if (host === "maps.apple.com") {
    const label = params.get("name") ?? params.get("q");
    const at =
      coordsIn(params.get("coordinate")) ?? coordsIn(params.get("ll")) ?? coordsIn(params.get("daddr")) ?? coordsIn(params.get("sll"));
    if (at) return point(at, label);
    return query(params.get("address") ?? params.get("daddr") ?? params.get("q"));
  }

  if (host === "waze.com" || host === "ul.waze.com") {
    // `ul?ll=lat,lon`, ou `live-map/directions?to=ll.lat,lon` (lien de la fiche DuckDuckGo).
    const at = coordsIn(params.get("ll")) ?? coordsIn(params.get("latlng")) ?? coordsIn(params.get("to"));
    if (at) return point(at);
    return query(params.get("q"));
  }

  if (host === "openstreetmap.org" || host === "osm.org") {
    const lat = Number(params.get("mlat"));
    const lon = Number(params.get("mlon"));
    if (params.has("mlat") && validPoint(lat, lon)) return point({ lat, lon });
    const view = /map=\d+(?:\.\d+)?\/(-?\d+\.\d+)\/(-?\d+\.\d+)/.exec(url.hash);
    if (view && validPoint(Number(view[1]), Number(view[2]))) return point({ lat: Number(view[1]), lon: Number(view[2]) });
    return query(params.get("query"));
  }

  if (host === "bing.com" && url.pathname.startsWith("/maps")) {
    const at = coordsIn(params.get("cp")) ?? coordsIn(params.get("rtp"));
    if (at) return point(at);
    return query(params.get("where1") ?? params.get("q"));
  }

  if (host === "wego.here.com" || host === "share.here.com") {
    const at = coordsIn(params.get("map")) ?? coordsIn(path);
    return at ? point(at) : null;
  }

  return null;
}

/**
 * Vrai pour un lien qui demande un **itinéraire**, et pas seulement de montrer
 * un lieu : intention « naviguer », `…/maps/dir/`, `daddr`, `destination`,
 * `navigate=yes`.
 */
export function isNavigationLink(url: string): boolean {
  return /^google\.navigation:/i.test(url) || /\/maps\/dir\//i.test(url) || /[?&](daddr=|destination=|navigate=yes)/i.test(url);
}

/** Une position lisible dans un texte collé : coordonnées, ou lien de carte. */
export function pointFromText(text: string): { lat: number; lon: number; label?: string } | null {
  const at = parseCoordinates(text);
  if (at) return at;
  if (!/^(https?:\/\/|geo:)/i.test(text.trim())) return null;
  const link = parseMapLink(text);
  return link?.kind === "point" ? { lat: link.lat, lon: link.lon, label: link.label } : null;
}

/** Abréviations de voie qu'on lit sur les pages, et que les géocodeurs connaissent mal. */
const STREET_ABBREVIATIONS: [RegExp, string][] = [
  [/\bRte\b\.?/gi, "Route"],
  [/\b(Av|Ave)\b\.?/gi, "Avenue"],
  [/\b(Bd|Bld|Blvd)\b\.?/gi, "Boulevard"],
  [/\bChem\b\.?/gi, "Chemin"],
  [/\bImp\b\.?/gi, "Impasse"],
  [/\bPl\b\.?/gi, "Place"],
  [/\bFbg\b\.?/gi, "Faubourg"],
];

/**
 * Une adresse de page, remise en forme pour le géocodage : abréviations de voie
 * développées, code pays retiré. Mesuré sur la fiche DuckDuckGo d'un McDonald's
 * absent d'OSM, « 3 Rte de Lalande Nationale 89, Montussan, FR 33450 » : Photon
 * ne trouve rien tant que « Rte » et « FR 33450 » y sont, et trouve le numéro
 * une fois l'adresse nettoyée.
 */
export function cleanAddress(text: string): string {
  let address = text;
  for (const [pattern, full] of STREET_ABBREVIATIONS) address = address.replace(pattern, full);
  address = address.replace(/\b(FR|FRA)[\s-]+(\d{5})\b/g, "$2").replace(/,\s*(FR|FRA)\s*$/i, "");
  return address
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .replace(/^[,\s]+|[,\s]+$/g, "");
}

/** Le texte que l'utilisateur a sélectionné dans une page. */
export function candidateFromSelection(text: string): WebCandidate | null {
  const selected = clean(text);
  if (!selected || selected.length < 4 || selected.length > 300) return null;
  const at = parseCoordinates(selected);
  if (at) return { ...at };
  const link = /^(https?:|geo:)/i.test(selected) ? parseMapLink(selected) : null;
  if (link?.kind === "point") return { lat: link.lat, lon: link.lon, name: link.label };
  if (link?.kind === "query") return { address: link.text };
  return { address: selected };
}

function strings(value: unknown, max: number): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, max) : [];
}

function textOf(value: unknown): string | undefined {
  if (typeof value === "string") return clean(value);
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return textOf(value[0]);
  if (value && typeof value === "object") return textOf((value as Record<string, unknown>).name);
  return undefined;
}

/** Les objets d'un bloc JSON-LD, `@graph`, tableaux et établissements imbriqués dépliés. */
function ldNodes(value: unknown, out: Record<string, unknown>[] = [], depth = 0): Record<string, unknown>[] {
  if (depth > 5 || !value || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    for (const item of value) ldNodes(item, out, depth + 1);
    return out;
  }
  const node = value as Record<string, unknown>;
  out.push(node);
  for (const key of ["@graph", "mainEntity", "location", "department", "subOrganization", "containsPlace"]) {
    if (node[key]) ldNodes(node[key], out, depth + 1);
  }
  return out;
}

function postalAddress(value: unknown): string | undefined {
  if (typeof value === "string") return clean(value);
  if (Array.isArray(value)) return postalAddress(value[0]);
  if (!value || typeof value !== "object") return undefined;
  const address = value as Record<string, unknown>;
  const cityLine = clean([textOf(address.postalCode), textOf(address.addressLocality)].filter(Boolean).join(" "));
  // Un code pays (« FR ») n'aide pas le géocodage ; un nom de pays, si.
  const country = textOf(address.addressCountry);
  const parts = [textOf(address.streetAddress), cityLine, country && country.length > 3 ? country : undefined].filter(Boolean);
  return parts.length ? parts.join(", ") : undefined;
}

const PHONE = /^\+?[\d\s().-]{6,}$/;

/**
 * La fiche DuckDuckGo d'un lieu unique. Ses classes changent, pas sa forme :
 * un titre, puis des paires `dt`/`dd` (adresse, téléphone, horaires) dont les
 * libellés suivent la langue. L'adresse est donc reconnue à sa forme — des
 * chiffres, des lettres, une virgule — et non à son libellé.
 */
function cardCandidate(value: unknown): WebCandidate | null {
  if (!value || typeof value !== "object") return null;
  const card = value as Record<string, unknown>;
  const name = textOf(card.name);
  const fields = strings(card.fields, 12)
    .map(clean)
    .filter((field): field is string => !!field);
  const address = fields.find(
    (field) => field.length <= 200 && field.includes(",") && /\d/.test(field) && /\p{L}{3}/u.test(field) && !PHONE.test(field)
  );
  if (!name || !address) return null;
  const website = textOf(card.website);
  return {
    name,
    address,
    phone: fields.find((field) => PHONE.test(field)),
    website: website && /^https?:\/\//i.test(website) ? website : undefined,
  };
}

/** Types qui décrivent une entreprise ou une page, pas un établissement où se rendre. */
const NOT_A_PLACE = /^(Organization|Corporation|WebSite|WebPage|NewsMediaOrganization|BreadcrumbList|Brand)$/;

function ldCandidate(node: Record<string, unknown>): { candidate: WebCandidate; score: number } | null {
  const address = postalAddress(node.address);
  const geo = (Array.isArray(node.geo) ? node.geo[0] : node.geo) as Record<string, unknown> | undefined;
  const lat = Number(textOf(geo?.latitude));
  const lon = Number(textOf(geo?.longitude));
  const at = geo && validPoint(lat, lon) ? { lat, lon } : null;
  if (!address && !at) return null;

  const types = (Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]]).filter(
    (type): type is string => typeof type === "string"
  );
  const headOffice = types.length > 0 && types.every((type) => NOT_A_PLACE.test(type));
  const website = textOf(node.url);
  return {
    candidate: {
      name: textOf(node.name),
      address,
      ...(at ?? {}),
      phone: textOf(node.telephone),
      website: website && /^https?:\/\//i.test(website) ? website : undefined,
    },
    // Une position vaut mieux qu'une adresse, et l'adresse d'un siège social
    // n'est pas celle du restaurant qu'on cherche.
    score: (at ? 2 : 0) + (address ? 1 : 0) - (headOffice ? 2 : 0),
  };
}

function placeKey(candidate: WebCandidate): string {
  return candidate.lat !== undefined && candidate.lon !== undefined
    ? `${candidate.lat.toFixed(3)},${candidate.lon.toFixed(3)}`
    : (candidate.address ?? "").toLowerCase();
}

/**
 * Le lieu que décrit une page, **s'il n'y en a qu'un**.
 *
 * Par ordre de confiance : données structurées (schema.org), fiche d'un lieu
 * unique de DuckDuckGo, balises `meta` de
 * position, un unique lien de carte avec une position, une unique adresse
 * balisée. Une page qui en décrit plusieurs — un annuaire, une liste de
 * magasins — ne propose rien : c'est à l'utilisateur de désigner le bon, en
 * sélectionnant son adresse.
 */
export function candidateFromPage(page: WebPageData): WebCandidate | null {
  const found: { candidate: WebCandidate; score: number }[] = [];
  for (const block of strings(page.ld, 20)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block);
    } catch {
      continue;
    }
    for (const node of ldNodes(parsed)) {
      const candidate = ldCandidate(node);
      if (candidate) found.push(candidate);
    }
  }
  if (found.length) {
    const best = Math.max(...found.map((item) => item.score));
    const top = found.filter((item) => item.score === best);
    if (best >= 1 && new Set(top.map((item) => placeKey(item.candidate))).size === 1) return top[0].candidate;
  }

  const card = cardCandidate(page.card);
  if (card) return card;

  const metas = page.metas && typeof page.metas === "object" ? (page.metas as Record<string, unknown>) : {};
  const lat = Number(textOf(metas["place:location:latitude"] ?? metas["og:latitude"]));
  const lon = Number(textOf(metas["place:location:longitude"] ?? metas["og:longitude"]));
  const fromMeta = validPoint(lat, lon) ? { lat, lon } : coordsIn(textOf(metas["geo.position"]) ?? textOf(metas.ICBM));
  if (fromMeta) return { ...fromMeta, name: textOf(metas["og:title"]) };

  const points = new Map<string, WebCandidate>();
  for (const href of strings(page.links, 30)) {
    const link = parseMapLink(href);
    if (link?.kind === "point") points.set(`${link.lat.toFixed(4)},${link.lon.toFixed(4)}`, { lat: link.lat, lon: link.lon, name: link.label });
  }
  if (points.size === 1) return [...points.values()][0];

  const addresses = [
    ...new Set(strings(page.addr, 5).map(clean).filter((address): address is string => !!address && address.length <= 200)),
  ];
  if (addresses.length === 1) return { address: addresses[0] };
  return null;
}

/**
 * Le lieu à ouvrir sur la carte. Son identifiant `web/…` n'est pas une
 * référence OSM : la fiche n'ira chercher ni horaires ni détails.
 */
export function placeFromCandidate(candidate: WebCandidate, fallbackName: string): Place | null {
  const { lat, lon } = candidate;
  if (lat === undefined || lon === undefined || !validPoint(lat, lon)) return null;
  const name = clean(candidate.name) ?? clean(candidate.address) ?? fallbackName;
  const address = clean(candidate.address);
  return {
    id: `web/${lat.toFixed(5)},${lon.toFixed(5)}`,
    name,
    group: null,
    lat,
    lon,
    address: address === name ? undefined : address,
    phone: clean(candidate.phone),
    website: candidate.website && /^https?:\/\//i.test(candidate.website) ? candidate.website : undefined,
  };
}

/**
 * Réglages DuckDuckGo passés dans l'adresse, à chaque ouverture : les cookies
 * sont effacés à la fermeture du navigateur, il n'y a rien à retenir entre deux
 * recherches. Relevés sur la page des réglages elle-même (onglets Général,
 * Confidentialité, AI Features), la documentation n'en listant qu'une partie.
 */
const DUCKDUCKGO_PRIVACY: Record<string, string> = {
  kat: "-1", // Emplacement : ne pas demander la localisation approximative
  kac: "-1", // Suggestions de saisie : les frappes ne partent pas une à une
  kg: "p", // Recherches refaites sur la page en POST : hors de l'adresse
  kd: "1", // Redirection : le site cliqué ne voit pas la recherche
  k5: "-1", // Lecture vidéo : demander
  kbn: "-1", // Aperçu vidéo au survol : coupé
  kbg: "-1", // Duck.ai : coupé
  kbe: "0", // Search Assist (réponses IA) : jamais
  kbj: "1", // Masquer les images générées par l'IA
  k1: "-1", // Publicités : coupées
  kak: "-1", // Invitations à installer DuckDuckGo
  kax: "-1", // Rappels pour l'installer
  kaq: "-1", // Formulaires de lettre d'information
  kap: "-1", // Rappels de lettre d'information
  kao: "-1", // Conseils de confidentialité en page d'accueil
  kau: "-1", // Demandes d'avis
  kpsb: "-1", // Rappel « Protégé »
  kz: "1", // Réponses instantanées : gardées, la fiche du lieu en est une
  // Application d'itinéraire : Waze. Son lien n'est jamais ouvert (voir
  // `WEB_LINK_PATTERNS`), et il porte les coordonnées — pas de géocodage.
  kbk: "waze",
};

/**
 * L'adresse de la recherche : les réglages de confidentialité ci-dessus, la
 * région suivant la langue (une préférence de pays, pas une localisation) et
 * le thème sombre suivant l'application.
 */
export function webSearchUrl(base: string, text: string, options: { lang: "fr" | "en"; dark: boolean }): string {
  const url = new URL(base);
  url.searchParams.set("q", text);
  url.searchParams.set("kl", options.lang === "fr" ? "fr-fr" : "wt-wt");
  for (const [key, value] of Object.entries(DUCKDUCKGO_PRIVACY)) url.searchParams.set(key, value);
  if (options.dark) url.searchParams.set("kae", "d");
  return url.toString();
}
