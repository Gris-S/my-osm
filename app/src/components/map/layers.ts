// Les couches de la carte : identifiants, styles, conversions en GeoJSON, et
// les fonctions qui posent ou retirent chaque calque. Sorti de `MapView.tsx`
// sans rien changer — voir le composant pour l'ordre et le moment des appels.

import * as maplibregl from "maplibre-gl";
import type { Map as MLMap, StyleSpecification, FilterSpecification } from "maplibre-gl";
import { CONFIG } from "../../config";
import { APPLE_DARK_STYLE } from "../../styles/appleDark";
import type { Basemap } from "../../hooks/useBasemap";
import type { Theme } from "../../hooks/useTheme";
import { FILTER_GROUPS, GROUP_COLOR_FALLBACK, type IconNode } from "../../filters";
import { buildLineMarkerImage, buildMarkerImage } from "../../utils/markerImage";
import { POI_SOURCE_LAYER, VECTOR_SOURCE_ID } from "../../services/tilePois";
import type { TrafficEvent } from "../../services/traffic";
import type { StopLines } from "../../services/idfmNetwork";
import type { Place, RouteResult } from "../../types";
import type { NavChoice, CarTraffic } from "../../navigation";
import { t } from "../../i18n";

// Calque « Trafic ». Deux sources indépendantes : le débit des routes en tuiles
// TomTom (facultatif, sur clé) et les événements de Bison Futé (gratuits).
export const TRAFFIC_FLOW_SOURCE_ID = "traffic-flow-source";
export const TRAFFIC_FLOW_LAYER_ID = "traffic-flow-layer";
export const TRAFFIC_EVENT_SOURCE_ID = "traffic-event-source";
export const TRAFFIC_EVENT_LAYER_ID = "traffic-event-layer";
export const TRAFFIC_STRETCH_LAYER_ID = "traffic-stretch-layer";

/**
 * Les couleurs des trois gravités. Ce sont celles que le projet emploie déjà
 * pour dire « ça va », « attention », « bloqué » (`base.css`) : un utilisateur
 * qui a vu une vigilance météo ou un commerce fermé les reconnaît sans légende.
 */
export const TRAFFIC_COLOR: Record<string, string> = {
  low: "#ffcc00",
  medium: "#ff9500",
  high: "#ff3b30",
};

export const POI_SOURCE_ID = "poi-source";
export const POI_LAYER_ID = "poi-layer";
// Tracé de la ligne dont on consulte les horaires : un liseré sombre pour
// détacher la ligne du fond, puis la ligne à sa couleur officielle.
export const LINE_SHAPE_SOURCE_ID = "line-shape-source";
export const LINE_SHAPE_CASING_ID = "line-shape-casing";
export const LINE_SHAPE_LAYER_ID = "line-shape-layer";
export const ROUTE_SOURCE_ID = "route-source";
export const ROUTE_LAYER_ID = "route-layer";
// Les itinéraires proposés avant de partir (choix voiture, `src/navigation/`).
// Deux couches sur une même source : celles qu'on ne suit pas d'abord, en
// gris et en dessous, puis celle qui est mise en avant — sans quoi l'ordre
// d'arrivée dans la source déciderait laquelle passe au-dessus de l'autre.
export const CHOICE_SOURCE_ID = "route-choice-source";
export const CHOICE_DIM_LAYER_ID = "route-choice-dim";
export const CHOICE_ACTIVE_LAYER_ID = "route-choice-active";
// Le trafic sur l'itinéraire voiture : tronçons ralentis (orange) et bouchés
// (rouge), posés au-dessus du tracé suivi comme des propositions.
export const ROUTE_TRAFFIC_SOURCE_ID = "route-traffic-source";
export const ROUTE_TRAFFIC_LAYER_ID = "route-traffic";
export const TRAFFIC_SLOW_COLOR = "#ff9f0a";
export const TRAFFIC_JAM_COLOR = "#ff3b30";
// La marche d'un trajet en transports est tracée en pointillés. MapLibre ne
// sait pas faire varier `line-dasharray` d'un objet à l'autre : il faut une
// seconde couche, filtrée sur la même source.
export const ROUTE_WALK_LAYER_ID = "route-walk-layer";
// Tracé d'une course en cours (`src/navigation/running/`).
export const RUN_TRACE_SOURCE_ID = "run-trace-source";
export const RUN_TRACE_CASING_ID = "run-trace-casing";
export const RUN_TRACE_LAYER_ID = "run-trace-layer";
// Couche technique de la vue satellite : elle ne dessine rien, elle sert
// seulement à ce que MapLibre télécharge les tuiles vectorielles où sont lus
// les commerces.
export const POI_TILES_ANCHOR_ID = "poi-tiles-anchor";
export const TERRAIN_SOURCE_ID = "terrain-dem";
export const HILLSHADE_LAYER_ID = "terrain-hillshade";
export const CONTOUR_PREFIX = "terrain-contour-";
// Couverture Mapillary : les séquences parcourues (lignes) et les points de
// prise de vue (cercles), lus dans les tuiles vectorielles de Mapillary.
// Deux sources sur les mêmes tuiles, et non une seule : mesuré, une tuile z14
// de Paris pèse 1,5 Mo sur le réseau — elle porte les dizaines de milliers de
// points de prise de vue — contre 112 Ko en z13, qui n'a que les séquences.
// Les séquences s'arrêtent donc à z13 (MapLibre étire cette tuile au-delà) et
// les points ne sont demandés qu'une fois entré dans la rue.
export const MAPILLARY_SEQUENCE_SOURCE_ID = "mapillary-sequences-source";
export const MAPILLARY_IMAGE_SOURCE_ID = "mapillary-images-source";
export const MAPILLARY_SEQUENCE_LAYER_ID = "mapillary-sequences";
export const MAPILLARY_IMAGE_LAYER_ID = "mapillary-images";

// Résultats d'une recherche d'enseigne : tous en rouge, pour les repérer d'un
// coup d'œil parmi ce que la carte affiche déjà.
export const BRAND_COLOR = "#FF3B30";

// Inclinaison de la caméra en vue 3D. 60° est aussi le maximum autorisé par
// défaut par MapLibre : au-delà, l'horizon entre dans le champ et l'emprise
// visible — donc la requête Overpass qui en découle — devient démesurée.
export const PITCH_3D = 60;

// Style MapLibre pour la vue satellite. L'imagerie est empilée : le fond
// mondial d'Esri, puis l'orthophotographie de l'IGN par-dessus là où elle
// existe, puis un calque de routes et de toponymes pour une vue « hybride »
// lisible.
//
// Aucune logique géographique n'est nécessaire pour choisir entre les deux :
// les sources IGN portent leurs emprises (`bounds`), MapLibre ne leur demande
// donc rien ailleurs, et l'imagerie Esri reste simplement visible dessous.
export const IGN_SOURCE_PREFIX = "satellite-ign-";

export const IGN_SOURCES = Object.fromEntries(
  CONFIG.SATELLITE_IGN_AREAS.map((area) => [
    IGN_SOURCE_PREFIX + area.id,
    {
      type: "raster",
      tiles: [CONFIG.SATELLITE_IGN_TILE_URL],
      tileSize: 256,
      maxzoom: CONFIG.SATELLITE_MAX_ZOOM,
      bounds: area.bounds,
    },
  ]),
) as StyleSpecification["sources"];

export const IGN_LAYERS = CONFIG.SATELLITE_IGN_AREAS.map((area) => ({
  id: IGN_SOURCE_PREFIX + area.id,
  type: "raster" as const,
  source: IGN_SOURCE_PREFIX + area.id,
}));

export const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  // Les libellés de POI sont dessinés par nos soins jusque sur l'imagerie :
  // il faut donc une source de glyphes ici aussi.
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  sources: {
    // Les commerces sont lus dans les tuiles vectorielles (voir
    // `services/tilePois.ts`). L'imagerie satellite étant du raster, cette
    // source est déclarée ici uniquement pour qu'ils restent affichables : elle
    // ne dessine rien.
    [VECTOR_SOURCE_ID]: { type: "vector", url: "https://tiles.openfreemap.org/planet" },
    "satellite-imagery": {
      type: "raster",
      tiles: [CONFIG.SATELLITE_TILE_URL],
      tileSize: 256,
      maxzoom: CONFIG.SATELLITE_MAX_ZOOM,
      attribution: CONFIG.SATELLITE_ATTRIBUTION,
    },
    ...IGN_SOURCES,
    "satellite-labels": {
      type: "raster",
      tiles: [CONFIG.SATELLITE_LABELS_TILE_URL],
      tileSize: 256,
      maxzoom: CONFIG.SATELLITE_MAX_ZOOM,
    },
  },
  layers: [
    { id: "satellite-imagery", type: "raster", source: "satellite-imagery" },
    ...IGN_LAYERS,
    { id: "satellite-labels", type: "raster", source: "satellite-labels" },
    // Couche invisible mais bien présente : MapLibre ne télécharge les tuiles
    // que d'une source qu'au moins une couche utilise. Sans elle, la vue
    // satellite n'aurait aucun commerce à lire.
    {
      id: POI_TILES_ANCHOR_ID,
      type: "circle",
      source: VECTOR_SOURCE_ID,
      "source-layer": POI_SOURCE_LAYER,
      paint: { "circle-radius": 0, "circle-opacity": 0 },
    },
  ],
};

/** Clé identifiant le style courant, pour n'appeler setStyle que si besoin. */
export function styleKey(theme: Theme, basemap: Basemap): string {
  return basemap === "satellite" ? "satellite" : theme;
}

export function resolveStyle(theme: Theme, basemap: Basemap): string | StyleSpecification {
  if (basemap === "satellite") return SATELLITE_STYLE;
  return theme === "dark" ? APPLE_DARK_STYLE : CONFIG.MAP_STYLE_URL;
}

export function placesToGeoJSON(
  places: Place[],
  lines: Map<string, StopLines>,
  brandMode = false
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: places.map((p) => {
      const stopLines = lines.get(p.id);
      return {
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [p.lon, p.lat] },
        properties: {
          id: p.id,
          name: p.name,
          icon: stopLines && !brandMode ? lineMarkerImageId(stopLines) : markerImageId(p.group, brandMode),
          // Un arrêt annoncé par ses lignes se passe de son nom : les pastilles
          // disent déjà ce qu'il faut, et le libellé alourdirait la carte.
          label: stopLines ? "" : p.name,
          rank: p.rank ?? 999,
        },
      };
    }),
  };
}

export function emptyCollection(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

/**
 * Épaisseur du tracé d'itinéraire.
 *
 * Six pixels suffisent sur un plan qu'on examine : le doigt suit le trait. Au
 * volant on ne suit pas le trait, on le **retrouve** d'un coup d'œil pendant
 * que la carte défile, et six pixels se perdent parmi les rues. D'où un tracé
 * nettement plus épais pendant un guidage voiture, et lui seul — à pied et en
 * transports, la carte se regarde posément.
 */
export function routeWidth(bold: boolean): number {
  return bold ? 11 : 6;
}

/**
 * Les crédits des sources actuellement déclarées dans le style.
 *
 * C'est ce que faisait le contrôle d'attribution de MapLibre, qu'on a retiré du
 * bas de la carte : on relit le même champ `attribution`, on dédoublonne, et
 * l'application l'affiche où elle veut. Les balises sont gardées telles quelles
 * — elles portent les liens vers les licences — et c'est `AppMenu` qui décide
 * comment les rendre sans jamais injecter de HTML brut.
 */
export function collectAttribution(map: MLMap): string[] {
  const seen = new Set<string>();
  try {
    // Les identifiants viennent du style, mais **la mention vient de la source
    // chargée**, pas de sa déclaration : pour une source vectorielle décrite
    // par une simple URL, l'attribution n'arrive qu'avec le TileJSON, une fois
    // celui-ci téléchargé. La lire dans `getStyle().sources` rendait une liste
    // vide — vérifié sur appareil, le menu restait sans crédits.
    for (const id of Object.keys(map.getStyle()?.sources ?? {})) {
      const credit = (map.getSource(id) as { attribution?: string } | undefined)?.attribution;
      if (credit) seen.add(credit.trim());
    }
  } catch {
    // Style pas encore prêt : on rendra la liste au prochain passage.
  }
  return [...seen];
}

export const EMPTY_COLLECTION: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

export function choicesToGeoJSON(choices: NavChoice[] | null): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: (choices ?? []).map((choice) => ({
      type: "Feature" as const,
      geometry: choice.geometry,
      properties: { active: choice.active },
    })),
  };
}

/**
 * Les tronçons de trafic à colorer. Pendant le choix, ceux de **chaque**
 * proposition (demande explicite), plus discrets sur les parcours en gris ;
 * pendant la navigation, ceux du parcours suivi, à l'épaisseur de son trait.
 */
export function routeTrafficToGeoJSON(
  choices: NavChoice[] | null,
  traffic: CarTraffic | null,
  bold: boolean
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  if (choices?.length) {
    for (const choice of choices) {
      for (const segment of choice.traffic ?? []) {
        features.push({
          type: "Feature",
          geometry: segment.geometry,
          properties: { level: segment.level, dim: !choice.active, width: choice.active ? 7 : 6 },
        });
      }
    }
  } else {
    for (const segment of traffic?.segments ?? []) {
      features.push({
        type: "Feature",
        geometry: segment.geometry,
        properties: { level: segment.level, dim: false, width: routeWidth(bold) },
      });
    }
  }
  return { type: "FeatureCollection", features };
}

export function routeToGeoJSON(route: RouteResult | null): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: (route?.segments ?? []).map((segment) => ({
      type: "Feature" as const,
      geometry: segment.geometry,
      properties: { color: segment.color, dashed: segment.dashed },
    })),
  };
}

/**
 * Identifiant de l'image de marqueur d'une catégorie.
 *
 * En recherche d'enseigne, c'est la variante rouge : le pictogramme de la
 * catégorie est conservé — un fast-food reste reconnaissable — mais la couleur
 * signale que ce point fait partie des résultats.
 */
export function markerImageId(group: Place["group"], brandMode = false): string {
  return `${brandMode ? "poi-brand" : "poi-marker"}-${group ?? "other"}`;
}

/**
 * Identifiant de l'image d'un arrêt, dérivé des lignes qui le desservent :
 * deux arrêts desservis par les mêmes lignes partagent la même image, et
 * MapLibre ne la dessine qu'une fois.
 */
export function lineMarkerImageId(lines: StopLines): string {
  return `poi-lines-${lines.chips.map((chip) => `${chip.label}${chip.color}`).join("_")}${lines.extra ? `+${lines.extra}` : ""}`;
}

/**
 * Enregistre les images d'arrêt manquantes.
 *
 * Elles sont fabriquées à la demande, contrairement aux pastilles de catégorie
 * qui sont en nombre fixe : les combinaisons de lignes ne se connaissent qu'une
 * fois la zone chargée. `hasImage` suffit à ne pas les refaire, y compris après
 * un changement de style qui vide le registre.
 */
export function installLineImages(map: MLMap, lines: Iterable<StopLines>) {
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 3);
  for (const entry of lines) {
    const id = lineMarkerImageId(entry);
    if (map.hasImage(id)) continue;
    map.addImage(id, buildLineMarkerImage(entry.chips, entry.extra, pixelRatio), { pixelRatio });
  }
}

// Enregistre une image de marqueur par catégorie. `map.setStyle()` vide le
// registre d'images en même temps que les sources : il faut donc les réajouter
// à chaque changement de fond de carte, avant la couche qui les référence.
export function installMarkerImages(map: MLMap) {
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 3);
  // Une pastille par catégorie, plus une pastille grise sans pictogramme pour
  // les lieux non classés (un résultat de recherche, par exemple).
  const markers: [id: string, icon: IconNode, color: string][] = [
    ...FILTER_GROUPS.map((g): [string, IconNode, string] => [markerImageId(g.id), g.icon, g.color]),
    [markerImageId(null), [], GROUP_COLOR_FALLBACK],
  ];
  for (const [id, icon, color] of markers) {
    if (!map.hasImage(id)) map.addImage(id, buildMarkerImage(icon, color, pixelRatio), { pixelRatio });

    // Variante rouge de la même pastille, pour les résultats d'enseigne.
    const brandId = id.replace("poi-marker-", "poi-brand-");
    if (!map.hasImage(brandId)) map.addImage(brandId, buildMarkerImage(icon, BRAND_COLOR, pixelRatio), { pixelRatio });
  }
}


/** Étendues de zoom d'origine des couches de bâtiments, relevées au chargement
 *  du style pour pouvoir les rétablir en quittant la vue 3D. */
export const buildingZoomRanges = new Map<string, { min: number; max: number }>();

/**
 * Met les bâtiments à plat hors vue 3D.
 *
 * Une extrusion reste une extrusion même caméra à la verticale : la projection
 * étant perspective, les immeubles hauts penchent visiblement dès qu'ils
 * s'éloignent du centre de l'écran. La couche d'extrusion est donc **éteinte**
 * plutôt que ramenée à une hauteur nulle — une extrusion invisible coûte encore
 * le calcul de ses murs et de ses toits pour chaque tuile, ce qui fait souffler
 * la machine pour rien. En contrepartie, le remplissage plat des bâtiments, que
 * le style arrête au zoom 14 puisque l'extrusion prend le relais, est prolongé
 * jusqu'au zoom maximal.
 */
/**
 * Où glisser les **courbes de niveau** : au-dessus de toute la géométrie, sous
 * les étiquettes.
 *
 * Une ancre différente de celle de l'ombrage, et il le faut : posées sous les
 * voies, les courbes se font hacher par chaque rue qu'elles croisent, et les
 * deux dessins se disputent la lecture. Posées au-dessus, elles se lisent d'un
 * trait.
 *
 * Viser la première couche `symbol` ne suffirait pas : dans Liberty, **23
 * couches de ponts sont dessinées après elle** (les flèches de sens unique
 * arrivent avant les ponts). On cherche donc la dernière couche de géométrie —
 * `boundary_disputed`, index 87 — et l'on se pose juste après ; tout ce qui
 * suit n'est plus que du texte.
 */
export function contourAnchor(map: MLMap): string | undefined {
  if (map.getLayer("satellite-labels")) return "satellite-labels";
  const layers = map.getStyle().layers ?? [];
  let last = -1;
  for (let i = 0; i < layers.length; i++) {
    const { type } = layers[i];
    if (type === "line" || type === "fill" || type === "fill-extrusion") last = i;
  }
  return layers[last + 1]?.id;
}

/**
 * Où glisser l'ombrage dans la pile des couches du style.
 *
 * **Pas au-dessous de tout** : la première couche d'un style OpenMapTiles est
 * un `background` opaque qui couvre l'écran, et un ombrage posé sous lui est
 * simplement invisible. Il ne doit pas non plus passer par-dessus les routes et
 * les libellés, qu'il salirait.
 *
 * La bonne place est donc juste après les aplats de terrain — parcs, bois,
 * zones bâties — et juste avant l'eau, les voies et les étiquettes. Sur la vue
 * satellite, c'est au-dessus de l'imagerie et sous les toponymes.
 */
export function reliefAnchor(map: MLMap): string | undefined {
  const layers = map.getStyle().layers ?? [];
  if (map.getLayer("satellite-labels")) return "satellite-labels";
  const road = layers.find((l) => /^(waterway|tunnel|road|bridge|aeroway)/.test(l.id));
  if (road) return road.id;
  return layers.find((l) => l.type === "symbol")?.id;
}

/**
 * Le relief : ombrage du terrain **et** volume du sol.
 *
 * Une seule source d'altitude sert les deux. Le volume n'est pas réservé à la
 * vue 3D : allumer le relief donne déjà une légère profondeur — la hauteur du
 * terrain déplace le sol — et la vue 3D ne fait qu'accentuer le geste en
 * inclinant la caméra.
 *
 * La source est ajoutée et retirée avec la couche, jamais simplement masquée :
 * MapLibre télécharge les tuiles d'une source dès qu'une couche s'en sert, et
 * celles-ci pèsent plus de cent kilo-octets pièce.
 *
 * L'ordre compte au retrait : le terrain doit être **éteint avant** que la
 * source ne disparaisse, sinon MapLibre continue de réclamer des tuiles à une
 * source qui n'existe plus et lève à chaque déplacement.
 */
export function applyRelief(map: MLMap, relief: boolean, is3D: boolean) {
  const contourIds = CONFIG.SATELLITE_IGN_AREAS.map((a) => CONTOUR_PREFIX + a.id);

  if (!relief) {
    if (map.getTerrain()) map.setTerrain(null);
    for (const id of [HILLSHADE_LAYER_ID, ...contourIds]) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    for (const id of [TERRAIN_SOURCE_ID, ...contourIds]) {
      if (map.getSource(id)) map.removeSource(id);
    }
    return;
  }

  if (!map.getSource(TERRAIN_SOURCE_ID)) {
    map.addSource(TERRAIN_SOURCE_ID, {
      type: "raster-dem",
      tiles: [CONFIG.TERRAIN_TILE_URL],
      tileSize: 256,
      maxzoom: CONFIG.TERRAIN_MAX_ZOOM,
      encoding: CONFIG.TERRAIN_ENCODING,
      attribution: t("attribution.elevation"),
    });
  }

  const shadeAnchor = reliefAnchor(map);
  const lineAnchor = contourAnchor(map);

  if (!map.getLayer(HILLSHADE_LAYER_ID)) {
    map.addLayer(
      {
        id: HILLSHADE_LAYER_ID,
        type: "hillshade",
        source: TERRAIN_SOURCE_ID,
        paint: {
          "hillshade-exaggeration": 0.6,
          "hillshade-shadow-color": "#4a4a4f",
          "hillshade-highlight-color": "#ffffff",
          "hillshade-accent-color": "#5a5a60",
        },
      },
      shadeAnchor,
    );
  }

  // Les courbes de niveau **par-dessus les rues**, et non sous elles : en
  // dessous, chaque voie croisée les hachait et les deux dessins se disputaient
  // la lecture. Elles restent sous les étiquettes, qui priment sur tout. Elles
  // ne s'allument qu'à partir du zoom où elles cessent de faire un pâté — en
  // vue large, les courbes d'un massif se touchent et noircissent la carte.
  for (const area of CONFIG.SATELLITE_IGN_AREAS) {
    const id = CONTOUR_PREFIX + area.id;
    if (!map.getSource(id)) {
      map.addSource(id, {
        type: "raster",
        tiles: [CONFIG.CONTOUR_TILE_URL],
        tileSize: 256,
        bounds: area.bounds,
        attribution: t("attribution.contours"),
      });
    }
    if (!map.getLayer(id)) {
      map.addLayer(
        { id, type: "raster", source: id, minzoom: CONFIG.CONTOUR_MIN_ZOOM, paint: { "raster-opacity": 0.85 } },
        lineAnchor,
      );
    }
  }

  // Le volume suit toujours le relief ; la 3D ne fait que l'accentuer.
  map.setTerrain({
    source: TERRAIN_SOURCE_ID,
    exaggeration: is3D ? CONFIG.TERRAIN_EXAGGERATION : CONFIG.TERRAIN_EXAGGERATION_FLAT,
  });
}

export function applyBuildingRelief(map: MLMap, is3D: boolean) {
  for (const layer of map.getStyle().layers ?? []) {
    if ((layer as { "source-layer"?: string })["source-layer"] !== "building") continue;

    if (layer.type === "fill-extrusion") {
      map.setLayoutProperty(layer.id, "visibility", is3D ? "visible" : "none");
      continue;
    }

    if (layer.type !== "fill") continue;
    if (!buildingZoomRanges.has(layer.id)) {
      buildingZoomRanges.set(layer.id, { min: layer.minzoom ?? 0, max: layer.maxzoom ?? 24 });
    }
    const original = buildingZoomRanges.get(layer.id)!;
    map.setLayerZoomRange(layer.id, original.min, is3D ? original.max : 24);
  }
}

/**
 * Les écussons de route du style Liberty testent `ref_length <= 6` sur des
 * routes qui n'ont pas cette propriété : MapLibre écrit alors en console
 * « Expected value to be of type number, but found null instead » et écarte la
 * route. On ajoute « la propriété existe » en tête du filtre — `all` s'arrête
 * au premier faux : même rendu, plus d'avertissement.
 */
export function guardShieldFilters(map: MLMap) {
  for (const layer of map.getStyle().layers ?? []) {
    const filter = (layer as { filter?: unknown }).filter;
    if (!Array.isArray(filter)) continue;
    const text = JSON.stringify(filter);
    if (!text.includes('["get","ref_length"]') || text.includes('["has","ref_length"]')) continue;
    map.setFilter(layer.id, ["all", ["has", "ref_length"], filter] as unknown as FilterSpecification);
  }
}

// Masque les pictogrammes de POI du fond de carte, remplacés par les nôtres.
// Dans les styles dérivés d'OpenFreeMap Liberty, ce sont les couches qui
// s'appuient sur la source vectorielle `poi` (`poi_r1`, `poi_r7`, `poi_r20`,
// `poi_transit`) : on les repère par leur `source-layer` plutôt que par leur
// identifiant, pour rester valable si le style est régénéré.
export function hideBasemapPois(map: MLMap) {
  for (const layer of map.getStyle().layers ?? []) {
    // Notre couche-ancre s'appuie elle aussi sur `poi` : la masquer priverait
    // la vue satellite des tuiles d'où sortent justement les commerces.
    if (layer.id === POI_TILES_ANCHOR_ID) continue;
    if ((layer as { "source-layer"?: string })["source-layer"] === "poi") {
      map.setLayoutProperty(layer.id, "visibility", "none");
    }
  }
}

// (Ré)installe les sources et couches applicatives par-dessus le fond de carte.
// Appelé au premier `load` puis après chaque changement de style (thème ou
// vue satellite), car `map.setStyle()` retire les sources/couches ajoutées
// manuellement. On repart d'un état propre (removeLayer/removeSource) pour
// garantir que POI et itinéraire finissent bien au-dessus du nouveau fond.
export function installMapLayers(
  map: MLMap,
  places: Place[],
  lines: Map<string, StopLines>,
  route: RouteResult | null,
  theme: Theme,
  basemap: Basemap,
  is3D: boolean,
  relief: boolean,
  brandMode: boolean,
  mapillary: boolean,
  traffic: boolean,
  trafficEvents: TrafficEvent[],
  choices: NavChoice[] | null,
  bold: boolean,
  routeTraffic: GeoJSON.FeatureCollection
) {
  for (const id of [POI_LAYER_ID, ROUTE_LAYER_ID, ROUTE_WALK_LAYER_ID, LINE_SHAPE_LAYER_ID, LINE_SHAPE_CASING_ID, CHOICE_DIM_LAYER_ID, CHOICE_ACTIVE_LAYER_ID, ROUTE_TRAFFIC_LAYER_ID]) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  for (const id of [POI_SOURCE_ID, ROUTE_SOURCE_ID, LINE_SHAPE_SOURCE_ID, CHOICE_SOURCE_ID, ROUTE_TRAFFIC_SOURCE_ID]) {
    if (map.getSource(id)) map.removeSource(id);
  }

  hideBasemapPois(map);
  guardShieldFilters(map);
  applyBuildingRelief(map, is3D);
  applyRelief(map, relief, is3D);
  applyMapillary(map, mapillary);
  applyTraffic(map, traffic, trafficEvents);
  installMarkerImages(map);
  installLineImages(map, lines.values());

  const onDarkGround = basemap === "satellite" || theme === "dark";

  map.addSource(LINE_SHAPE_SOURCE_ID, { type: "geojson", data: emptyCollection() });
  map.addLayer({
    id: LINE_SHAPE_CASING_ID,
    type: "line",
    source: LINE_SHAPE_SOURCE_ID,
    layout: { "line-join": "round", "line-cap": "round" },
    paint: {
      "line-color": onDarkGround ? "#000000" : "#ffffff",
      "line-opacity": 0.75,
      "line-width": ["interpolate", ["linear"], ["zoom"], 9, 5, 16, 11],
    },
  });
  map.addLayer({
    id: LINE_SHAPE_LAYER_ID,
    type: "line",
    source: LINE_SHAPE_SOURCE_ID,
    layout: { "line-join": "round", "line-cap": "round" },
    paint: {
      "line-color": "#5856d6",
      "line-width": ["interpolate", ["linear"], ["zoom"], 9, 2.5, 16, 7],
    },
  });

  map.addSource(POI_SOURCE_ID, { type: "geojson", data: placesToGeoJSON(places, lines, brandMode) });
  map.addLayer({
    id: POI_LAYER_ID,
    type: "symbol",
    source: POI_SOURCE_ID,
    layout: {
      "icon-image": ["get", "icon"],
      // En vue large, MapLibre écarte les marqueurs qui se chevauchent : c'est
      // ce qui garde la carte lisible. Mais une fois entré dans une rue, ce
      // décombrement se retourne contre nous — deux commerces voisins de
      // quelques mètres, ou plusieurs enseignes d'un même immeuble, se
      // masquaient l'un l'autre alors qu'on zoomait précisément pour les voir.
      // Dès le zoom 15, toutes les pastilles sont donc dessinées.
      "icon-allow-overlap": ["step", ["zoom"], false, 15, true],
      "icon-padding": 2,
      // Ordre de placement stable, du plus important au moins important
      // (`rank` d'OpenMapTiles). Sans cette clé, MapLibre place les symboles
      // dans l'ordre où ils arrivent dans la source : cet ordre changeant à
      // chaque relecture, ce n'étaient jamais les mêmes pastilles qui
      // gagnaient la place disponible, et certaines clignotaient d'un
      // déplacement à l'autre.
      "symbol-sort-key": ["get", "rank"],
      // Le nom n'apparaît qu'une fois entré dans le quartier. Il vient un cran
      // après les pastilles : un libellé occupe beaucoup de place à l'écran et
      // empêchait de placer les pastilles voisines, si bien qu'en zoomant,
      // l'apparition des noms faisait disparaître des commerces.
      "text-field": ["step", ["zoom"], "", 16, ["get", "label"]],
      "text-font": ["Noto Sans Regular"],
      "text-size": 11,
      "text-anchor": "top",
      "text-offset": [0, 0.95],
      "text-max-width": 8,
      "text-optional": true,
    },
    paint: {
      // Texte clair sur fond sombre : mode nuit, mais aussi vue satellite,
      // dont l'imagerie est sombre quel que soit le thème de l'interface.
      "text-color": onDarkGround ? "#f2f2f7" : "#3c3c43",
      "text-halo-color": onDarkGround ? "rgba(0, 0, 0, 0.85)" : "rgba(255, 255, 255, 0.9)",
      "text-halo-width": 1.2,
    },
  });

  // La couleur vient de l'objet : bleu pour un itinéraire routier, couleur
  // officielle de la ligne pour chaque étape d'un trajet en transports.
  map.addSource(ROUTE_SOURCE_ID, { type: "geojson", data: routeToGeoJSON(route) });
  map.addLayer({
    id: ROUTE_LAYER_ID,
    type: "line",
    source: ROUTE_SOURCE_ID,
    filter: ["!", ["get", "dashed"]],
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": ["get", "color"], "line-width": routeWidth(bold), "line-opacity": 0.9 },
  });
  // Les itinéraires proposés. La source est vide tant qu'on ne choisit pas —
  // une source et ses couches coûtent moins à laisser en place qu'à créer et
  // détruire au rythme des ouvertures de panneau, et rien n'est téléchargé :
  // c'est du GeoJSON qu'on fournit nous-mêmes.
  // `setStyle(..., { diff: false })` détruit sources et couches : les
  // propositions sont donc reposées ici, et non perdues, si l'on change de fond
  // de carte pendant qu'on choisit son itinéraire. Leurs bulles, elles, sont
  // des éléments du DOM et survivent d'elles-mêmes.
  map.addSource(CHOICE_SOURCE_ID, { type: "geojson", data: choicesToGeoJSON(choices) });
  map.addLayer({
    id: CHOICE_DIM_LAYER_ID,
    type: "line",
    source: CHOICE_SOURCE_ID,
    filter: ["!", ["get", "active"]],
    layout: { "line-join": "round", "line-cap": "round" },
    // Gris et translucide : ils doivent se lire comme des chemins possibles,
    // pas comme celui qu'on suit. On voit la carte au travers.
    paint: { "line-color": "#8e8e93", "line-width": 6, "line-opacity": 0.55 },
  });
  map.addLayer({
    id: CHOICE_ACTIVE_LAYER_ID,
    type: "line",
    source: CHOICE_SOURCE_ID,
    filter: ["get", "active"],
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": "#007AFF", "line-width": 7, "line-opacity": 0.95 },
  });
  // Le trafic, au-dessus du tracé suivi et des propositions : un tronçon bouché
  // doit se voir sur le trait qu'il colore.
  map.addSource(ROUTE_TRAFFIC_SOURCE_ID, { type: "geojson", data: routeTraffic });
  map.addLayer({
    id: ROUTE_TRAFFIC_LAYER_ID,
    type: "line",
    source: ROUTE_TRAFFIC_SOURCE_ID,
    layout: { "line-join": "round", "line-cap": "round" },
    paint: {
      "line-color": ["match", ["get", "level"], "jam", TRAFFIC_JAM_COLOR, TRAFFIC_SLOW_COLOR],
      "line-width": ["get", "width"],
      "line-opacity": ["case", ["get", "dim"], 0.5, 0.95],
    },
  });
  map.addLayer({
    id: ROUTE_WALK_LAYER_ID,
    type: "line",
    source: ROUTE_SOURCE_ID,
    filter: ["get", "dashed"],
    // Des ronds, pas des tirets : un tiret de longueur nulle terminé par des
    // bouts arrondis (`line-cap: round`) se dessine comme un point. L'écart
    // est un multiple de l'épaisseur du trait.
    layout: { "line-join": "round", "line-cap": "round" },
    paint: {
      "line-color": ["get", "color"],
      "line-width": 5,
      "line-opacity": 0.9,
      "line-dasharray": [0, 2],
    },
  });
}

/**
 * Installe ou retire la couverture Mapillary.
 *
 * La source est **ajoutée et retirée** avec la couche plutôt que masquée :
 * MapLibre télécharge les tuiles d'une source dès qu'une couche s'en sert, et
 * une couverture invisible n'a pas à consommer de données.
 */
/**
 * Le calque « Trafic ».
 *
 * Comme pour le relief et Mapillary, **les sources sont ajoutées et retirées
 * avec les couches**, jamais simplement masquées : MapLibre télécharge les
 * tuiles d'une source dès qu'une couche s'en sert, et un calque éteint n'a pas
 * à coûter de données — les tuiles de débit se renouvellent en permanence.
 *
 * Le débit n'est posé que si une clé TomTom est renseignée. Sans elle, le
 * calque se réduit aux événements, ce qui reste l'essentiel : un bouchon
 * annoncé vaut mieux qu'une route colorée.
 */
export function applyTraffic(map: MLMap, enabled: boolean, events: TrafficEvent[]) {
  if (!enabled) {
    for (const id of [TRAFFIC_STRETCH_LAYER_ID, TRAFFIC_EVENT_LAYER_ID, TRAFFIC_FLOW_LAYER_ID]) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    for (const id of [TRAFFIC_EVENT_SOURCE_ID, TRAFFIC_FLOW_SOURCE_ID]) {
      if (map.getSource(id)) map.removeSource(id);
    }
    return;
  }

  // Le débit se glisse **sous les étiquettes** : il colore la chaussée, il ne
  // doit pas recouvrir les noms de rue.
  if (CONFIG.TOMTOM_KEY && !map.getSource(TRAFFIC_FLOW_SOURCE_ID)) {
    map.addSource(TRAFFIC_FLOW_SOURCE_ID, {
      type: "raster",
      tiles: [`${CONFIG.TOMTOM_TRAFFIC_TILE_URL}?key=${CONFIG.TOMTOM_KEY}`],
      tileSize: 256,
      maxzoom: 18,
      attribution: t("traffic.flowAttribution"),
    });
    map.addLayer({
      id: TRAFFIC_FLOW_LAYER_ID,
      type: "raster",
      source: TRAFFIC_FLOW_SOURCE_ID,
      paint: { "raster-opacity": 0.85 },
    }, labelAnchor(map));
  }

  if (!map.getSource(TRAFFIC_EVENT_SOURCE_ID)) {
    map.addSource(TRAFFIC_EVENT_SOURCE_ID, {
      type: "geojson",
      data: trafficToGeoJSON(events),
      attribution: t("traffic.attribution"),
    });
    // Le tronçon concerné d'abord, la pastille par-dessus : c'est elle qu'on
    // clique, et elle doit rester atteignable.
    map.addLayer({
      id: TRAFFIC_STRETCH_LAYER_ID,
      type: "line",
      source: TRAFFIC_EVENT_SOURCE_ID,
      filter: ["==", ["geometry-type"], "LineString"],
      minzoom: CONFIG.TRAFFIC_MIN_ZOOM,
      layout: { "line-cap": "round" },
      paint: {
        "line-color": ["get", "color"],
        "line-width": ["interpolate", ["linear"], ["zoom"], 9, 3, 16, 8],
        "line-opacity": 0.75,
      },
    });
    map.addLayer({
      id: TRAFFIC_EVENT_LAYER_ID,
      type: "circle",
      source: TRAFFIC_EVENT_SOURCE_ID,
      filter: ["==", ["geometry-type"], "Point"],
      minzoom: CONFIG.TRAFFIC_MIN_ZOOM,
      paint: {
        "circle-color": ["get", "color"],
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 4, 16, 9],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
      },
    });
  } else {
    (map.getSource(TRAFFIC_EVENT_SOURCE_ID) as maplibregl.GeoJSONSource).setData(
      trafficToGeoJSON(events)
    );
  }
}

/**
 * Un événement donne **deux objets** : le point où il commence, et le tronçon
 * qu'il affecte quand la source en donne les deux bouts. Le tronçon dit à lui
 * seul si le bouchon fait deux cents mètres ou six kilomètres.
 */
export function trafficToGeoJSON(events: TrafficEvent[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const event of events) {
    const properties = {
      id: event.id,
      kind: event.kind,
      road: event.road,
      description: event.description,
      color: TRAFFIC_COLOR[event.severity] ?? TRAFFIC_COLOR.medium,
    };
    features.push({
      type: "Feature",
      properties,
      geometry: { type: "Point", coordinates: [event.lon, event.lat] },
    });
    if (event.end) {
      features.push({
        type: "Feature",
        properties,
        geometry: {
          type: "LineString",
          coordinates: [
            [event.lon, event.lat],
            [event.end.lon, event.end.lat],
          ],
        },
      });
    }
  }
  return { type: "FeatureCollection", features };
}

/** La première couche d'étiquettes : ce qui est posé avant reste sous les noms. */
export function labelAnchor(map: MLMap): string | undefined {
  return map.getStyle().layers?.find((layer) => layer.type === "symbol")?.id;
}

export function applyMapillary(map: MLMap, enabled: boolean) {
  for (const id of [MAPILLARY_IMAGE_LAYER_ID, MAPILLARY_SEQUENCE_LAYER_ID]) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  for (const id of [MAPILLARY_IMAGE_SOURCE_ID, MAPILLARY_SEQUENCE_SOURCE_ID]) {
    if (map.getSource(id)) map.removeSource(id);
  }
  if (!enabled || !CONFIG.MAPILLARY_TOKEN) return;

  const tiles = [`${CONFIG.MAPILLARY_TILE_URL}?access_token=${CONFIG.MAPILLARY_TOKEN}`];
  map.addSource(MAPILLARY_SEQUENCE_SOURCE_ID, {
    type: "vector",
    tiles,
    minzoom: 6,
    maxzoom: CONFIG.MAPILLARY_SEQUENCE_MAX_ZOOM,
    attribution: t("attribution.photos"),
  });
  // Les points de prise de vue ne vivent que dans les tuiles z14, les plus
  // lourdes : leur source ne descend pas plus bas, et la couche qui s'en sert
  // n'apparaît qu'au zoom de la rue — c'est ce qui décide du téléchargement.
  map.addSource(MAPILLARY_IMAGE_SOURCE_ID, {
    type: "vector",
    tiles,
    minzoom: 14,
    maxzoom: 14,
  });

  // Les séquences se lisent de loin, comme un réseau de rues parcourues ; les
  // points de prise de vue n'arrivent qu'une fois entré dans la rue, sinon ils
  // recouvrent tout.
  map.addLayer({
    id: MAPILLARY_SEQUENCE_LAYER_ID,
    type: "line",
    source: MAPILLARY_SEQUENCE_SOURCE_ID,
    "source-layer": "sequence",
    layout: { "line-join": "round", "line-cap": "round" },
    paint: {
      "line-color": CONFIG.MAPILLARY_COLOR,
      "line-opacity": 0.7,
      "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.2, 16, 3.5],
    },
  });
  map.addLayer({
    id: MAPILLARY_IMAGE_LAYER_ID,
    type: "circle",
    source: MAPILLARY_IMAGE_SOURCE_ID,
    "source-layer": "image",
    minzoom: CONFIG.MAPILLARY_MIN_ZOOM_FOR_IMAGES,
    paint: {
      "circle-color": CONFIG.MAPILLARY_COLOR,
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 15, 2.5, 19, 6],
      "circle-stroke-width": 1,
      "circle-stroke-color": "rgba(255, 255, 255, 0.65)",
    },
  });
}

/** Emprise visible, dans l'ordre attendu partout ailleurs : sud, ouest, nord, est. */
export function currentBbox(map: MLMap): [number, number, number, number] {
  const bounds = map.getBounds();
  return [bounds.getSouth(), bounds.getWest(), bounds.getNorth(), bounds.getEast()];
}

/** Distance approchée entre deux points, en mètres. */
export function distanceBetween(a: { lon: number; lat: number }, b: { lon: number; lat: number }): number {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const lat = ((a.lat + b.lat) / 2) * toRad;
  return Math.hypot(dLon * Math.cos(lat), dLat) * 6371000;
}
