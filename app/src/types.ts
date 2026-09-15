import type { FilterGroupId } from "./filters";

export interface LonLat {
  lon: number;
  lat: number;
}

/** Un lieu affiché sur la carte : résultat de recherche, POI, ou commerce. */
export interface Place {
  id: string;
  name: string;
  /** Catégorie de filtrage (voir `src/filters.ts`) ; `null` si non classé. */
  group: FilterGroupId | null;
  rawType?: string; // ex: "restaurant", "pharmacy", "supermarket"
  lon: number;
  lat: number;
  address?: string;
  openingHours?: string; // valeur brute de la balise OSM opening_hours
  /**
   * Importance du lieu telle que la calcule OpenMapTiles (1 = le plus
   * important). Elle sert d'ordre de placement sur la carte : quand deux
   * pastilles se disputent la même place, la plus importante l'emporte, et
   * toujours la même d'une relecture à l'autre.
   */
  rank?: number;
  phone?: string;
  website?: string;
}

/**
 * Un point du parcours d'un itinéraire : un lieu choisi, ou la position de
 * l'appareil.
 *
 * « Ma position » est un point comme un autre, et non un cas particulier du
 * départ : c'est ce qui permet de la déplacer dans l'ordre, voire d'en faire
 * l'arrivée — rentrer chez soi après une course est un parcours ordinaire.
 * Elle n'a pas de coordonnées propres : elles sont résolues au rendu, et
 * manquent tant que la géolocalisation n'a pas répondu.
 */
export type RouteStop = { kind: "current" } | { kind: "place"; place: Place };

/**
 * La question posée par le panneau d'itinéraire, s'il y en a une : le rang du
 * point qu'on modifie, ou `"new"` pour l'étape qu'on ajoute.
 *
 * Elle est tenue par `App` et non par le panneau, parce qu'elle **arme la
 * carte** : tant qu'une question est ouverte, un clic sur la carte y répond au
 * lieu d'ouvrir une fiche. Le panneau et la carte doivent donc en avoir la
 * même lecture.
 */
export type StopEdit = number | "new";

/**
 * Un point du parcours tel que la carte le dessine : ses coordonnées, son rôle
 * et son rang.
 *
 * Le rôle est celui du **rang dans le parcours entier** et non de la place
 * dans la liste des repères : un point dont la position est encore inconnue
 * n'est pas dessiné, sans que ses voisins changent de couleur pour autant.
 */
export interface RouteStopMarker extends LonLat {
  role: "origin" | "step" | "destination";
  /** Rang dans le parcours, l'arrivée comprise : c'est le numéro affiché. */
  rank: number;
}

/**
 * Un tronçon du trajet, tel qu'il est dessiné sur la carte.
 *
 * Un itinéraire routier n'en a qu'un ; un trajet en transports en a un par
 * étape, à la couleur de la ligne empruntée, la marche en pointillés.
 */
export interface RouteSegment {
  geometry: GeoJSON.LineString;
  color: string;
  dashed: boolean;
}

export interface RouteResult {
  mode: import("./config").TravelMode;
  /**
   * Distance parcourue, quand elle a un sens : `null` en transports en commun,
   * où seule la marche est mesurée — l'annoncer se lirait comme la longueur du
   * trajet.
   */
  distanceMeters: number | null;
  durationSeconds: number;
  segments: RouteSegment[];
}
