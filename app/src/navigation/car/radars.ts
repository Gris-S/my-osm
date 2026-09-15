import { projectOnSegment } from "../geo";
import type { CarRoute } from "./carRoute";
import type { RadarKind } from "./data/radars";

// ---------------------------------------------------------------------------
// Les radars du parcours, et le seul son de l'application.
//
// La source est la liste officielle des radars fixes publiée par le ministère
// de l'Intérieur (décembre 2025, 3 309 radars, position, famille et vitesse
// autorisée). Elle est engendrée dans `data/radars.ts` et chargée par import
// dynamique au premier trajet voiture.
//
// **Le son est réservé à cela.** C'était la demande, et c'est aussi la seule
// façon de garder un avertissement utile : une application qui parle à chaque
// virage finit qu'on la coupe, et le seul moment où l'on veut vraiment être
// prévenu sans regarder l'écran passe alors inaperçu. Le reste du guidage est
// muet, par construction.
//
// Le son n'est pas un fichier mais deux brèves notes synthétisées (Web Audio) :
// rien à charger, rien à mettre en cache, et le module reste supprimable d'un
// `rm -rf` sans laisser d'actif derrière lui.
// ---------------------------------------------------------------------------

/**
 * Distance maximale entre un radar et le tracé pour le tenir sur le parcours.
 *
 * Cent cinquante mètres : assez pour absorber l'imprécision d'un point relevé
 * au bord de la chaussée, assez peu pour ne pas annoncer le radar de la
 * nationale qui longe l'autoroute. Les radars de vitesse moyenne sont posés sur
 * l'ouvrage lui-même, les tourelles en bord de voie.
 */
const RADAR_RADIUS = 150;

/**
 * À quelle distance le radar est annoncé.
 *
 * Trois cents mètres, soit une dizaine de secondes à 110 km/h : le temps de
 * lever le pied sans freiner brusquement. Plus tôt, l'avertissement se perd de
 * vue avant d'être utile ; plus tard, il ne sert plus qu'à confirmer la photo.
 */
export const ALERT_METERS = 300;

/** Côté de la grille de recherche, en degrés (~1,1 km). */
const CELL = 0.01;

export interface RouteRadar {
  /** Distance depuis le départ à laquelle le radar est posté. */
  atMeters: number;
  kind: RadarKind;
  /** Vitesse annoncée, `null` quand la source ne la publie pas (« NA »). */
  kmh: number | null;
}

let loading: Promise<Array<[number, number, RadarKind, number]>> | null = null;

function load() {
  loading ??= import("./data/radars").then((module) => module.RADARS);
  return loading;
}

/**
 * Les radars posés le long d'un itinéraire, dans l'ordre du parcours.
 *
 * La recherche passe par une grille du tracé plutôt que par une boucle
 * imbriquée : trois mille radars contre cinq mille points de tracé feraient
 * seize millions de projections à chaque calcul. Rangés par cellules d'environ
 * un kilomètre, seuls les segments du voisinage de chaque radar sont examinés,
 * et le travail devient proportionnel au nombre de radars.
 */
export async function radarsAlong(route: CarRoute): Promise<RouteRadar[]> {
  const all = await load();

  const grid = new Map<string, number[]>();
  for (let i = 0; i < route.points.length - 1; i++) {
    const key = cellKey(route.points[i].lat, route.points[i].lon);
    const bucket = grid.get(key);
    if (bucket) bucket.push(i);
    else grid.set(key, [i]);
  }

  const found: RouteRadar[] = [];
  for (const [lat, lon, kind, kmh] of all) {
    let best = Infinity;
    let at = 0;
    // Le radar peut tomber près d'un segment rangé dans une cellule voisine :
    // on regarde les neuf cellules autour de la sienne.
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const bucket = grid.get(cellKey(lat + dy * CELL, lon + dx * CELL));
        if (!bucket) continue;
        for (const i of bucket) {
          const projection = projectOnSegment({ lon, lat }, route.points[i], route.points[i + 1]);
          if (projection.offset >= best) continue;
          best = projection.offset;
          const span = route.measures[i + 1] - route.measures[i];
          at = route.measures[i] + span * projection.t;
        }
      }
    }
    if (best <= RADAR_RADIUS) found.push({ atMeters: at, kind, kmh: kmh > 0 ? kmh : null });
  }

  found.sort((a, b) => a.atMeters - b.atMeters);
  return found;
}

function cellKey(lat: number, lon: number): string {
  return `${Math.floor(lat / CELL)}:${Math.floor(lon / CELL)}`;
}

/**
 * Le radar à annoncer maintenant : le premier devant soi qui soit à portée.
 *
 * La liste étant triée, la recherche part du dernier rang atteint plutôt que du
 * début — un trajet en compte parfois une quarantaine, et cette fonction est
 * appelée à chaque relevé.
 */
export function radarAhead(
  radars: RouteRadar[],
  traveledMeters: number,
  from: number
): { radar: RouteRadar; index: number; distanceMeters: number } | null {
  for (let i = from; i < radars.length; i++) {
    const gap = radars[i].atMeters - traveledMeters;
    // Un radar dépassé de plus de cinquante mètres est derrière : le relevé GPS
    // flotte, et un radar qui redeviendrait « devant » rejouerait son signal.
    if (gap < -50) continue;
    return gap <= ALERT_METERS ? { radar: radars[i], index: i, distanceMeters: Math.max(0, gap) } : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Le son
// ---------------------------------------------------------------------------

let audio: AudioContext | null = null;

/**
 * Prépare la sortie audio. À appeler **dans le geste de l'utilisateur** qui
 * démarre la navigation : les navigateurs refusent de créer ou de réveiller un
 * contexte audio ailleurs, et le premier radar rencontré serait alors muet sans
 * que rien ne l'explique. Même raison, et même endroit, que la demande d'accès
 * aux capteurs de mouvement du guidage piéton.
 */
export function primeRadarSound(): void {
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume();
  } catch {
    // Pas de sortie audio (contexte non sécurisé, navigateur restreint) : le
    // guidage continue, l'avertissement reste visible à l'écran.
  }
}

/**
 * Deux notes brèves, montantes.
 *
 * Deux et non une : un bip isolé se confond avec ceux de la voiture. Montantes
 * parce qu'une alerte qui descend s'entend comme une fin — ici, c'est quelque
 * chose qui arrive.
 */
export function playRadarChime(): void {
  if (!audio || audio.state !== "running") return;
  const now = audio.currentTime;
  for (const [index, frequency] of [880, 1175].entries()) {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    const at = now + index * 0.16;
    // L'enveloppe est indispensable : une onde qu'on démarre et qu'on arrête
    // net produit un claquement qui s'entend plus que la note elle-même.
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.22, at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.14);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(at);
    oscillator.stop(at + 0.16);
  }
}

/** Libère la sortie audio à la fin du guidage. */
export function releaseRadarSound(): void {
  void audio?.close().catch(() => {});
  audio = null;
}
