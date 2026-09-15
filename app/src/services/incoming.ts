import { t } from "../i18n";
import type { Place } from "../types";
import { geocodeAddress } from "./geocode";
import { isNavigationLink, parseMapLink, placeFromCandidate, type WebCandidate } from "./webPlace";

// ---------------------------------------------------------------------------
// Ce qu'une autre application envoie à MY OSM.
//
// Android propose MY OSM quand on touche « Itinéraire » sur un site, une
// adresse dans un message ou un contact (liens `geo:` et `google.navigation:`,
// déclarés au manifeste), et dans le menu « Partager » (texte). L'activité
// réécrit un partage en adresse `myosm-share:?text=…` (`MainActivity`), si bien
// que tout arrive par le même chemin : le greffon `App` de Capacitor
// (`appUrlOpen`, `getLaunchUrl`), puis `useIncomingLinks`.
//
// Aucun lien n'est ouvert : une position se lit dans son texte, une adresse se
// géocode sans la position de l'appareil (`geocodeAddress`). Un lien Google
// raccourci (`maps.app.goo.gl`) ne se lit pas sans interroger Google : il est
// ignoré, et le texte qui l'accompagne sert à sa place.
// ---------------------------------------------------------------------------

/** Ce que l'application fait de ce qu'elle a reçu. */
export type IncomingAction = { kind: "place" | "route"; place: Place } | { kind: "search"; text: string };

/** Préfixe des partages de texte, réécrits par `MainActivity`. */
export const SHARE_URL_PREFIX = "myosm-share:";

const LINK = /(https?:\/\/|geo:|google\.navigation:)[^\s<>"]+/gi;

async function locate(candidate: WebCandidate): Promise<Place | null> {
  if (candidate.lat !== undefined) return placeFromCandidate(candidate, t("incoming.place"));
  if (!candidate.address) return null;
  const found = await geocodeAddress(candidate.address).catch(() => null);
  if (!found) return null;
  return placeFromCandidate({ ...candidate, lat: found.lat, lon: found.lon, name: candidate.name ?? found.name }, found.name);
}

function fromLink(url: string, name?: string): WebCandidate | null {
  const link = parseMapLink(url);
  if (link?.kind === "point") return { lat: link.lat, lon: link.lon, name: name ?? link.label };
  if (link?.kind === "query") return { address: link.text, name };
  return null;
}

/**
 * Un texte partagé : souvent un nom, une adresse et un lien (« McDonald's ·
 * 3 Rte de Lalande, 33450 Montussan · https://maps.app.goo.gl/… »). Un lien
 * lisible l'emporte ; sinon la première ligne est le nom et le reste
 * l'adresse. Un texte qu'on ne sait pas placer part en recherche sur le web.
 */
export async function resolveSharedText(text: string): Promise<IncomingAction | null> {
  const links = text.match(LINK) ?? [];
  const lines = text
    .replace(LINK, "\n")
    .split(/\n+|\s·\s/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const name = lines.length > 1 ? lines[0] : undefined;

  for (const link of links) {
    const candidate = fromLink(link, name);
    const place = candidate ? await locate(candidate) : null;
    if (place) return { kind: isNavigationLink(link) ? "route" : "place", place };
  }
  if (!lines.length) return null;
  const place = await locate({ name, address: (lines.length > 1 ? lines.slice(1) : lines).join(", ") });
  return place ? { kind: "place", place } : { kind: "search", text: lines.join(" ") };
}

/** Une adresse reçue au lancement ou pendant que l'application tourne. */
export async function resolveIncoming(url: string): Promise<IncomingAction | null> {
  if (url.startsWith(SHARE_URL_PREFIX)) {
    const text = new URLSearchParams(url.slice(SHARE_URL_PREFIX.length).replace(/^\?/, "")).get("text");
    return text ? resolveSharedText(text) : null;
  }
  const candidate = fromLink(url);
  const place = candidate ? await locate(candidate) : null;
  return place ? { kind: isNavigationLink(url) ? "route" : "place", place } : null;
}
