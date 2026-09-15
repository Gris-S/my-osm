import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import type { Map as MLMap, StyleSpecification } from "maplibre-gl";
import { CONFIG } from "../config";
import { APPLE_DARK_STYLE } from "../styles/appleDark";
import type { Theme } from "../hooks/useTheme";
import type { LonLat } from "../types";
import { useLatest } from "../hooks/useLatest";

// ---------------------------------------------------------------------------
// Le tracé d'un trajet enregistré, sur une vraie carte.
//
// C'est une **seconde instance MapLibre**, indépendante de celle de
// l'application : la carte principale montre l'endroit où l'on se trouve, celle
// d'ici montre un parcours d'il y a six mois, à l'autre bout de la ville. Les
// deux ne peuvent pas être la même, et la faire voyager reviendrait à perdre la
// vue en cours pour ouvrir un souvenir.
//
// Elle est créée avec `preserveDrawingBuffer` : sans cette option, WebGL est
// libre de vider son tampon après chaque image et `toBlob()` rend un carré
// vide. C'est ce qui permet de partager le parcours en image. L'option coûte un
// peu de mémoire et un peu de temps par image — acceptable sur une carte
// immobile qui ne se redessine pas, inacceptable sur la carte principale, d'où
// cette instance à part.
// ---------------------------------------------------------------------------

const TRACE_SOURCE = "trip-trace";
const TRACE_LAYER = "trip-trace-line";
const TRACE_CASING = "trip-trace-casing";

/** Bleu d'itinéraire, celui du guidage. */
const TRACE_COLOR = "#007AFF";

const START_COLOR = "#34C759";
const END_COLOR = "#FF3B30";

function styleFor(theme: Theme): string | StyleSpecification {
  return theme === "dark" ? APPLE_DARK_STYLE : CONFIG.MAP_STYLE_URL;
}

function traceData(points: LonLat[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: points.map((p) => [p.lon, p.lat]) },
      },
    ],
  };
}

function boundsOf(points: LonLat[]): maplibregl.LngLatBounds {
  const bounds = new maplibregl.LngLatBounds();
  for (const point of points) bounds.extend([point.lon, point.lat]);
  return bounds;
}

/** Pose le tracé et ses deux extrémités sur une carte dont le style est chargé. */
function installTrace(map: MLMap, points: LonLat[], color: string) {
  if (!map.getSource(TRACE_SOURCE)) {
    map.addSource(TRACE_SOURCE, { type: "geojson", data: traceData(points) });
  }
  if (!map.getLayer(TRACE_CASING)) {
    // Un liseré sombre sous le trait : sans lui, le bleu se perd sur une route
    // bleutée ou sur un parc.
    map.addLayer({
      id: TRACE_CASING,
      type: "line",
      source: TRACE_SOURCE,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#ffffff", "line-width": 7, "line-opacity": 0.9 },
    });
    map.addLayer({
      id: TRACE_LAYER,
      type: "line",
      source: TRACE_SOURCE,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": color, "line-width": 4 },
    });
  } else {
    (map.getSource(TRACE_SOURCE) as maplibregl.GeoJSONSource).setData(traceData(points));
  }
}

function dot(color: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "trip-map-dot";
  el.style.background = color;
  return el;
}

interface Props {
  points: LonLat[];
  theme: Theme;
  /** Rendue à la carte une fois prête, pour la capture d'image. */
  onReady?: (map: MLMap) => void;
  /** Couleur du tracé : le bleu d'itinéraire par défaut, l'orange pour une course. */
  color?: string;
}

export function TripMap({ points, theme, onReady, color = TRACE_COLOR }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const onReadyRef = useLatest(onReady);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || points.length < 2) return;

    const map = new maplibregl.Map({
      container,
      style: styleFor(theme),
      // Le cadrage se fait sur l'emprise du tracé dès le style chargé ; ce
      // centre n'est là que pour que la carte naisse quelque part.
      center: [points[0].lon, points[0].lat],
      zoom: 13,
      interactive: false,
      attributionControl: { compact: true },
      // Indispensable à `toBlob()` : voir l'en-tête du fichier. En maplibre-gl
      // v6 l'option a déménagé dans `canvasContextAttributes` — la passer à la
      // racine, comme en v4, ne lève rien et ne fait rien.
      canvasContextAttributes: { preserveDrawingBuffer: true },
    });
    mapRef.current = map;

    map.on("style.load", () => {
      installTrace(map, points, color);
      map.fitBounds(boundsOf(points), { padding: 34, animate: false, maxZoom: 17 });
    });

    // `idle` dit que tout est dessiné, tuiles comprises : c'est le seul moment
    // où une capture rend autre chose qu'une carte à moitié peinte.
    map.once("idle", () => onReadyRef.current?.(map));

    const markers = [
      new maplibregl.Marker({ element: dot(START_COLOR), anchor: "center" })
        .setLngLat([points[0].lon, points[0].lat])
        .addTo(map),
      new maplibregl.Marker({ element: dot(END_COLOR), anchor: "center" })
        .setLngLat([points[points.length - 1].lon, points[points.length - 1].lat])
        .addTo(map),
    ];

    return () => {
      for (const marker of markers) marker.remove();
      map.remove();
      mapRef.current = null;
    };
    // Le tracé et le thème identifient la carte : changer de thème la
    // reconstruit, ce qui est plus simple que de recoloriser un style entier
    // pour un aperçu qu'on ouvre quelques secondes.
  }, [points, theme, color, onReadyRef]);

  return <div className="trip-map" ref={containerRef} />;
}
