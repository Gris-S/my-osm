// Les éléments du DOM posés sur la carte : épingles d'étape, bulles des
// itinéraires proposés, repères d'incident, flèche de navigation. Sorti de
// `MapView.tsx` sans rien changer.

import { CONFIG } from "../../config";
import { safeColor } from "../../utils/safe";
import type { NavChoice, TrafficIncident } from "../../navigation";

/** Vert au départ, bleu aux étapes, rouge à l'arrivée — comme dans le panneau. */
export const STOP_COLOR = {
  origin: "#34C759",
  step: "#007AFF",
  destination: "#FF3B30",
} as const;

export function pinElement(color: string): HTMLDivElement {
  // La couleur d'un dossier vient du stockage : elle est validée avant d'entrer
  // dans le HTML du repère.
  const fill = safeColor(color, "#FF3B30");
  const el = document.createElement("div");
  el.className = "map-pin";
  el.innerHTML = `
    <svg width="34" height="44" viewBox="0 0 34 44" xmlns="http://www.w3.org/2000/svg">
      <path d="M17 0C7.6 0 0 7.6 0 17c0 12.7 17 27 17 27s17-14.3 17-27C34 7.6 26.4 0 17 0z" fill="${fill}"/>
      <circle cx="17" cy="17" r="6.5" fill="white"/>
    </svg>`;
  return el;
}

/**
 * Repère d'une étape : le même galet, le rang écrit dedans.
 *
 * Le numéro est indispensable — l'ordre des étapes est ce que l'utilisateur
 * règle dans le panneau, et deux points identiques sur la carte ne diraient pas
 * lequel vient d'abord. Le disque blanc du repère ordinaire laisse tout juste
 * la place d'un ou deux chiffres, d'où le plafond à quinze étapes.
 */
export function waypointPinElement(color: string, rank: number): HTMLDivElement {
  const fill = safeColor(color, "#FF9500");
  const el = document.createElement("div");
  el.className = "map-pin";
  el.innerHTML = `
    <svg width="34" height="44" viewBox="0 0 34 44" xmlns="http://www.w3.org/2000/svg">
      <path d="M17 0C7.6 0 0 7.6 0 17c0 12.7 17 27 17 27s17-14.3 17-27C34 7.6 26.4 0 17 0z" fill="${fill}"/>
      <circle cx="17" cy="17" r="9" fill="white"/>
      <text x="17" y="17" text-anchor="middle" dominant-baseline="central"
            font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="700"
            fill="${fill}">${Math.round(Number(rank)) || ""}</text>
    </svg>`;
  return el;
}

/**
 * Repère de la vue de rue : un point vert et le cône de ce qu'on regarde.
 *
 * Le cône est dessiné vers le haut ; c'est le marqueur qui le fait pivoter,
 * aligné sur la carte, de sorte qu'il montre toujours la bonne direction quand
 * on tourne la carte comme quand on tourne la caméra.
 */
export function streetViewElement(): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "street-view-marker";
  el.innerHTML = `
    <svg width="56" height="56" viewBox="0 0 56 56" xmlns="http://www.w3.org/2000/svg">
      <path d="M28 28 L8 4 A32 32 0 0 1 48 4 Z" fill="${CONFIG.MAPILLARY_COLOR}" fill-opacity="0.35"/>
      <circle cx="28" cy="28" r="7" fill="${CONFIG.MAPILLARY_COLOR}" stroke="#ffffff" stroke-width="3"/>
    </svg>`;
  return el;
}

export function dotElement(): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "user-dot-wrap";
  el.innerHTML = `<div class="user-dot-pulse"></div><div class="user-dot-core"></div>`;
  return el;
}

/**
 * La bulle d'un itinéraire proposé : la durée, le péage, et c'est elle qu'on
 * touche pour partir.
 *
 * C'est un élément du DOM et non une couche `symbol`, pour la même raison que
 * les repères d'étape : elle doit être **cliquable** et porter deux lignes de
 * texte de tailles différentes, ce qu'une couche de symboles rend mal. Elle est
 * ancrée par le bas, avec une petite pointe, pour désigner la route sous elle.
 */
export function choiceBubbleElement(choice: NavChoice): HTMLButtonElement {
  const element = document.createElement("button");
  element.className = `route-choice-bubble ${choice.active ? "is-active" : ""}`;
  element.type = "button";

  const title = document.createElement("strong");
  title.textContent = choice.title;
  element.appendChild(title);

  if (choice.detail) {
    const detail = document.createElement("span");
    detail.textContent = choice.detail;
    element.appendChild(detail);
  }

  // Le clic ne doit pas remonter à la carte : elle le prendrait pour un clic
  // dans le vide et ouvrirait la fiche d'un point du fond — même précaution
  // que pour les repères de lieux enregistrés.
  element.addEventListener("click", (event) => {
    event.stopPropagation();
    choice.onPick();
  });
  return element;
}

/** Pictogramme blanc de chaque nature d'incident, dans une case de 24. */
export const INCIDENT_ICONS: Record<TrafficIncident["kind"], string> = {
  // Un cône de chantier.
  roadworks:
    '<path d="M9.6 4h4.8l4.1 14H5.5z" fill="#fff"/><path d="M7.9 10.5h8.2M6.9 14.5h10.2" stroke="#ff9f0a" stroke-width="1.8"/><rect x="3.5" y="18" width="17" height="2.6" rx="1.2" fill="#fff"/>',
  // Le sens interdit : une barre.
  closure: '<rect x="5" y="10.3" width="14" height="3.4" rx="1.4" fill="#fff"/>',
  // Le triangle de danger.
  accident:
    '<path d="M12 4.5l8.5 15h-17z" fill="#fff"/><path d="M12 10v4.2" stroke="#ff3b30" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="17" r="1.2" fill="#ff3b30"/>',
  incident:
    '<path d="M12 4.5l8.5 15h-17z" fill="#fff"/><path d="M12 10v4.2" stroke="#ff9f0a" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="17" r="1.2" fill="#ff9f0a"/>',
};

export function incidentElement(incident: TrafficIncident): HTMLDivElement {
  const el = document.createElement("div");
  el.className = `traffic-incident is-${incident.kind}`;
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", incident.label);
  el.title = incident.label;
  el.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${INCIDENT_ICONS[incident.kind]}</svg>`;
  return el;
}

/** Taille de la flèche en voiture (`NavMapState.largeArrow`), contre 40 px à pied. */
export const NAV_ARROW_LARGE = 64;

/**
 * Repère du marcheur pendant la navigation guidée : une flèche, et non le point
 * de position ordinaire — en guidage, la direction dans laquelle on va compte
 * autant que l'endroit où l'on est.
 *
 * Elle est dessinée vers le haut ; c'est le marqueur qui la fait pivoter,
 * aligné sur la carte comme le cône de la vue de rue, de sorte qu'elle montre
 * la bonne direction même carte tournée ou inclinée.
 */
export function navArrowElement(large: boolean): HTMLDivElement {
  const size = large ? NAV_ARROW_LARGE : 40;
  const el = document.createElement("div");
  el.className = large ? "nav-marker is-large" : "nav-marker";
  el.dataset.large = String(large);
  el.innerHTML = `
    <svg width="${size}" height="${size}" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="20" r="15" fill="#007AFF" fill-opacity="0.18"/>
      <path d="M20 6 L30 30 L20 24.5 L10 30 Z" fill="#007AFF" stroke="#ffffff" stroke-width="2.2"
            stroke-linejoin="round"/>
    </svg>`;
  return el;
}
