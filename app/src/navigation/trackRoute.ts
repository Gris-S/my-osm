import type { LonLat } from "../types";
import type { GeoFilePoint } from "../services/geoFile";
import { distance } from "./geo";
import { locateOnPath, type Path } from "./progress";
import type { NavMode, NavRoute, NavStep } from "./route";

// ---------------------------------------------------------------------------
// Le guidage **sur une trace** (GPX, KML…), et non sur un itinéraire calculé
// (demande explicite, 15 octobre 2026 : « tu as créé ton propre parcours alors
// que les points existent déjà »).
//
// Le tracé suivi est la trace elle-même, point par point. Les manœuvres :
//
//   - **les consignes du fichier** quand il en porte (un GPX exporté d'un
//     calculateur range « Tournez à gauche sur Rue de B… » en points le long
//     de la trace) : chacune est projetée sur la trace et dite telle quelle ;
//   - sinon, **les virages de la trace**, lus sur ses changements de cap.
//
// Le moteur d'itinéraire ne sert plus qu'à **rejoindre** la trace : depuis ma
// position au départ, et après un écart (`trackFrom`), jusqu'au point de la
// trace d'où l'on repart. Fonctions pures, testées (`tests/trackRoute.test.ts`).
// ---------------------------------------------------------------------------

/** Vitesse supposée sur la trace, pour le temps restant : 4,5 km/h à pied, 15 à vélo. */
const SPEED: Record<NavMode, number> = { walking: 1.25, cycling: 4.2 };

/** Une consigne plus loin que cela de la trace n'est pas la sienne. */
const GUIDANCE_METERS = 60;

/** Un changement de cap au-delà duquel la trace « tourne », en degrés. */
const TURN_DEGREES = 35;

/** Les mots d'une consigne qui disent de quel côté elle fait tourner. */
function modifierOf(text: string): string | undefined {
  const lower = text.toLowerCase();
  if (/demi-tour|u-turn|uturn/.test(lower)) return "uturn";
  const slight = /légèrement|slight|serrez|keep|restez/.test(lower);
  const sharp = /franchement|sharp/.test(lower);
  const side = /gauche|left/.test(lower) ? "left" : /droite|right/.test(lower) ? "right" : null;
  if (!side) return "straight";
  return sharp ? `sharp ${side}` : slight ? `slight ${side}` : side;
}

function bearing(from: LonLat, to: LonLat): number {
  const rad = Math.PI / 180;
  const y = Math.sin((to.lon - from.lon) * rad) * Math.cos(to.lat * rad);
  const x =
    Math.cos(from.lat * rad) * Math.sin(to.lat * rad) -
    Math.sin(from.lat * rad) * Math.cos(to.lat * rad) * Math.cos((to.lon - from.lon) * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

function pathOf(points: LonLat[]): Path {
  const kept: LonLat[] = [];
  const measures: number[] = [];
  let total = 0;
  for (const point of points) {
    const last = kept[kept.length - 1];
    if (last && last.lon === point.lon && last.lat === point.lat) continue;
    if (last) total += distance(last, point);
    kept.push(point);
    measures.push(total);
  }
  return { points: kept, measures };
}

/** Le point de la trace à `meters` du début. */
function pointAt(path: Path, meters: number): LonLat {
  const { points, measures } = path;
  for (let i = 1; i < points.length; i++) {
    if (measures[i] >= meters) {
      const span = measures[i] - measures[i - 1];
      const share = span > 0 ? (meters - measures[i - 1]) / span : 0;
      return {
        lon: points[i - 1].lon + (points[i].lon - points[i - 1].lon) * share,
        lat: points[i - 1].lat + (points[i].lat - points[i - 1].lat) * share,
      };
    }
  }
  return points[points.length - 1];
}

/** Les virages de la trace, faute de consignes : cap pris vingt mètres avant et après chaque sommet. */
function turnsOf(path: Path): { atMeters: number; modifier: string }[] {
  const turns: { atMeters: number; modifier: string }[] = [];
  const total = path.measures[path.measures.length - 1];
  let lastAt = -Infinity;
  for (let i = 1; i < path.points.length - 1; i++) {
    const at = path.measures[i];
    if (at < 20 || at > total - 20 || at - lastAt < 30) continue;
    const before = bearing(pointAt(path, at - 20), path.points[i]);
    const after = bearing(path.points[i], pointAt(path, at + 20));
    const delta = ((after - before + 540) % 360) - 180;
    const size = Math.abs(delta);
    if (size < TURN_DEGREES) continue;
    const side = delta < 0 ? "left" : "right";
    turns.push({ atMeters: at, modifier: size > 150 ? "uturn" : size > 110 ? `sharp ${side}` : size < 60 ? `slight ${side}` : side });
    lastAt = at;
  }
  return turns;
}

/**
 * Le trajet à suivre : `approach` pour rejoindre la trace (nul si l'on y est
 * déjà), puis la trace, ses consignes ou ses virages, et l'arrivée.
 */
export function trackNavRoute(track: LonLat[], guidance: GeoFilePoint[], mode: NavMode, approach: NavRoute | null): NavRoute {
  const path = pathOf(track);
  const length = path.measures[path.measures.length - 1] ?? 0;
  const speed = SPEED[mode];

  // Les manœuvres sur la trace, à leur distance depuis son début.
  const marks: { atMeters: number; modifier?: string; text?: string }[] = [];
  const named = guidance.filter((point) => !/^(start|end|départ|arrivée|finish)\b/i.test(point.name.trim()));
  if (named.length) {
    let from = 0;
    for (const point of named) {
      const match = locateOnPath(path, point, from);
      if (match.offset > GUIDANCE_METERS) continue;
      from = match.index;
      marks.push({ atMeters: match.measure, modifier: modifierOf(point.name), text: point.name });
    }
  } else {
    marks.push(...turnsOf(path));
  }
  marks.sort((a, b) => a.atMeters - b.atMeters);

  const offset = approach ? approach.distanceMeters : 0;
  const steps: NavStep[] = approach ? approach.steps.slice(0, -1) : [];
  const stops = [{ atMeters: 0, type: "depart" as const }, ...marks.map((mark) => ({ ...mark, type: "turn" as const })), { atMeters: length, type: "arrive" as const }];
  stops.forEach((stop, rank) => {
    const next = stops[rank + 1];
    const stretch = next ? next.atMeters - stop.atMeters : 0;
    steps.push({
      maneuver: {
        type: stop.type,
        modifier: "modifier" in stop ? stop.modifier : undefined,
        name: "",
        waypoint: null,
        text: "text" in stop ? stop.text : undefined,
      },
      atMeters: offset + stop.atMeters,
      distanceMeters: stretch,
      durationSeconds: stretch / speed,
      location: pointAt(path, stop.atMeters),
    });
  });

  const points = [...(approach ? approach.points : []), ...path.points];
  const measures = [...(approach ? approach.measures : []), ...path.measures.map((meters) => offset + meters)];
  // La jonction est écrite deux fois (fin de l'approche, début de la trace) : une seule suffit.
  if (approach && points.length > path.points.length) {
    const junction = approach.points.length;
    if (distance(points[junction - 1], points[junction]) < 0.5) {
      points.splice(junction, 1);
      measures.splice(junction, 1);
    }
  }

  const remainingAfter = new Array<number>(steps.length).fill(0);
  for (let i = steps.length - 2; i >= 0; i--) remainingAfter[i] = remainingAfter[i + 1] + steps[i + 1].durationSeconds;
  const total = offset + length;
  const durationSeconds = (approach?.durationSeconds ?? 0) + length / speed;

  return {
    points,
    measures,
    steps,
    remainingAfter,
    distanceMeters: total,
    durationSeconds,
    result: {
      mode,
      distanceMeters: total,
      durationSeconds,
      segments: [
        { geometry: { type: "LineString", coordinates: points.map((p) => [p.lon, p.lat]) }, color: "#007AFF", dashed: false },
      ],
    },
    profile: approach?.profile,
    source: approach?.source,
  };
}

/**
 * Ce qui reste de la trace depuis le point le plus proche de `here` : là où
 * l'on rejoint la trace après un écart. Le point projeté ouvre la suite.
 */
export function trackFrom(track: LonLat[], here: LonLat): LonLat[] {
  const path = pathOf(track);
  if (path.points.length < 2) return path.points;
  const match = locateOnPath(path, here, 0);
  return [match.point, ...path.points.slice(match.index + 1)];
}
