import { useCallback, useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import type { Map as MLMap, MapMouseEvent, PropertyValueSpecification } from "maplibre-gl";
import { CONFIG } from "../config";
import type { Basemap } from "../hooks/useBasemap";
import type { Theme } from "../hooks/useTheme";
import type { FilterGroupId } from "../filters";
import { collectTilePois, VECTOR_SOURCE_ID } from "../services/tilePois";
import { isTransitStop } from "../services/idfm";
import { getTrafficEvents, type TrafficEvent } from "../services/traffic";
import { getLinesForStops, type StopLines } from "../services/idfmNetwork";
import { loadLineShape } from "../transport/stations";
import type { PoiStatus } from "./MapStatus";
import type { LonLat, Place, RouteResult, RouteStopMarker } from "../types";

/** Une photo de rue désignée sur la carte. */
export interface StreetPhotoRef {
  id: string;
  /** Séquence dont elle fait partie : c'est elle qui permet d'avancer dans la
      rue, d'une photo à la suivante. La tuile la porte déjà. */
  sequenceId?: string;
  lon: number;
  lat: number;
}
import type { SavedPlace as StoredPlace } from "../hooks/useBookmarks";
// Navigation guidée — voir `src/navigation/README.md`. La carte n'en connaît
// que la caméra à suivre et le repère du marcheur ; tout le reste est dans ce
// dossier, et se retire avec lui.
import type { NavChoice, NavMapState, CarTraffic } from "../navigation";
import { followConnectivity, installOfflineTiles, offlineTransformRequest } from "../services/offline/nativeTiles";
import { POI_SOURCE_ID, POI_LAYER_ID, LINE_SHAPE_SOURCE_ID, LINE_SHAPE_LAYER_ID, ROUTE_SOURCE_ID, ROUTE_LAYER_ID, CHOICE_SOURCE_ID, ROUTE_TRAFFIC_SOURCE_ID, RUN_TRACE_SOURCE_ID, RUN_TRACE_CASING_ID, RUN_TRACE_LAYER_ID, MAPILLARY_IMAGE_LAYER_ID, PITCH_3D, styleKey, resolveStyle, placesToGeoJSON, emptyCollection, routeWidth, collectAttribution, EMPTY_COLLECTION, choicesToGeoJSON, routeTrafficToGeoJSON, routeToGeoJSON, installLineImages, applyRelief, applyBuildingRelief, installMapLayers, applyTraffic, applyMapillary, currentBbox, distanceBetween } from "./map/layers";
import { STOP_COLOR, pinElement, waypointPinElement, streetViewElement, dotElement, choiceBubbleElement, incidentElement, navArrowElement } from "./map/markers";
import { NAV_GLIDE_MIN_MS, NAV_GLIDE_MAX_MS, NAV_GLIDE_JUMP_METERS, NAV_FRAME_MS, NAV_FRAME_SLACK_MS, NAV_PIXEL_RATIO_SHARE, NAV_CAMERA_EASE_MS, type NavCameraPose, type NavGlide, idleGlide, shortestTurn, lerp, easeInOut, samePose } from "./map/navGlide";

/** Pendant le glissement d'une navigation, les POI ne sont relus qu'à ce rythme. */
const NAV_POI_REFRESH_MS = 1000;

/** Un lieu enregistré tel que la carte le reçoit : le point et sa couleur. */
type SavedPlace = StoredPlace & { color: string };

interface MapViewProps {
  /** Catégories cochées : la carte lit les POI correspondants dans ses tuiles. */
  groups: readonly FilterGroupId[];
  /** Ligne dont les horaires sont ouverts : son tracé est dessiné sur la carte. */
  focusedLine: { lineId: string; color: string } | null;
  /**
   * Résultats d'une recherche d'enseigne. Quand ils sont fournis, la carte
   * n'affiche qu'eux : les catégories sont mises de côté le temps de la
   * recherche.
   */
  brandPlaces: Place[] | null;
  /** Prévient que la carte a bougé depuis la dernière recherche d'enseigne. */
  onBrandStale: () => void;
  /** Rapporte l'emprise visible, pour que la recherche porte sur ce qu'on voit. */
  onViewportChange: (bbox: [number, number, number, number]) => void;
  selectedPlace: Place | null;
  userLocation: LonLat | null;
  /**
   * Les points du parcours, dans l'ordre : départ en vert, arrivée en rouge,
   * étapes en bleu numérotées. Vide hors itinéraire.
   */
  routeStops: RouteStopMarker[];
  /**
   * Vrai quand le panneau d'itinéraire attend qu'on désigne un point : le clic
   * sert alors à répondre, et une photo de rue ne doit pas le happer.
   */
  picking: boolean;
  route: RouteResult | null;
  theme: Theme;
  basemap: Basemap;
  is3D: boolean;
  /** Ombrage du terrain, et volume du sol quand la 3D est allumée. */
  relief: boolean;
  /** Couverture Mapillary affichée sur la carte. */
  mapillary: boolean;
  /** Calque « Trafic » : événements du réseau national, et débit si clé TomTom. */
  traffic: boolean;
  /** Où se tient la vue de rue consultée, et vers où elle regarde. */
  streetPosition: (LonLat & { bearing?: number }) | null;
  /** Clic sur un point de prise de vue : la photo s'ouvre par-dessus la carte. */
  onSelectStreetPhoto: (photo: StreetPhotoRef) => void;
  flyTo: (LonLat & { zoom?: number; initial?: boolean }) | null;
  /**
   * Demande de remise au nord : chaque nouvelle valeur en déclenche une, comme
   * `flyTo`. `null` tant qu'on n'en a jamais demandé.
   */
  northRequest: number | null;
  /** Orientation courante de la carte, pour l'aiguille de la boussole. */
  onBearingChange: (bearing: number) => void;
  onSelectPlace: (place: Place) => void;
  onPoiStatusChange: (status: PoiStatus) => void;
  onBackgroundClick: (lonlat: LonLat) => void;
  /** Lieux enregistrés des dossiers allumés, à la couleur de leur dossier. */
  savedPlaces: SavedPlace[];
  onSelectSaved: (place: SavedPlace) => void;
  /**
   * Navigation guidée en cours : le repère du marcheur, et la caméra à tenir
   * quand la carte le suit (`camera` vaut `null` dès que l'utilisateur a
   * déplacé la carte lui-même). `null` hors guidage.
   */
  /** Ce que MapLibre a refusé de faire : style manquant, WebGL indisponible… */
  onMapError: (message: string) => void;
  /**
   * Les mentions d'attribution des sources réellement employées.
   *
   * Elles sont relevées sur le style lui-même plutôt qu'écrites à la main :
   * elles changent avec le fond de carte et avec chaque calque allumé — relief,
   * photos de rue, trafic, orthophotographie de l'IGN — et une liste figée
   * finirait par créditer une source éteinte ou en oublier une allumée.
   */
  onAttributionChange: (credits: string[]) => void;
  navigation: NavMapState | null;
  /** L'utilisateur a déplacé la carte pendant le guidage : le suivi s'arrête. */
  onNavigationPan: () => void;
}

export function MapView({
  groups,
  focusedLine,
  brandPlaces,
  onBrandStale,
  onViewportChange,
  selectedPlace,
  userLocation,
  routeStops,
  picking,
  route,
  theme,
  basemap,
  is3D,
  relief,
  mapillary,
  traffic,
  streetPosition,
  onSelectStreetPhoto,
  flyTo,
  northRequest,
  onBearingChange,
  onSelectPlace,
  onPoiStatusChange,
  onBackgroundClick,
  savedPlaces,
  onSelectSaved,
  onMapError,
  onAttributionChange,
  navigation,
  onNavigationPan,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const selectedMarkerRef = useRef<maplibregl.Marker | null>(null);
  // Vrai dès le premier geste de l'utilisateur sur la carte (voir `flyTo.initial`).
  const userTouchedRef = useRef(false);
  const userMarkerRef = useRef<maplibregl.Marker | null>(null);
  const stopMarkersRef = useRef<maplibregl.Marker[]>([]);
  const savedMarkersRef = useRef<maplibregl.Marker[]>([]);
  const streetMarkerRef = useRef<maplibregl.Marker | null>(null);
  // Navigation guidée : le repère du marcheur, et le rappel qui prévient qu'il
  // a repris la carte en main.
  const navMarkerRef = useRef<maplibregl.Marker | null>(null);
  // Le glissement en cours de la flèche et de la caméra (voir `NavGlide`).
  const navGlideRef = useRef<NavGlide>(idleGlide());
  const choiceMarkersRef = useRef<maplibregl.Marker[]>([]);
  const choicesRef = useRef<NavChoice[] | null>(null);
  choicesRef.current = navigation?.choices ?? null;
  const navTrafficRef = useRef<CarTraffic | null>(null);
  navTrafficRef.current = navigation?.traffic ?? null;
  const boldRouteRef = useRef(false);
  boldRouteRef.current = navigation?.boldRoute ?? false;
  /** Dernier cadrage joué, pour ne pas le rejouer à chaque rendu. */
  const navFrameRef = useRef<string | null>(null);
  const onNavigationPanRef = useRef(onNavigationPan);
  onNavigationPanRef.current = onNavigationPan;
  const onMapErrorRef = useRef(onMapError);
  onMapErrorRef.current = onMapError;
  const onAttributionRef = useRef(onAttributionChange);
  onAttributionRef.current = onAttributionChange;
  const onSelectSavedRef = useRef(onSelectSaved);
  onSelectSavedRef.current = onSelectSaved;
  // POI lus dans les tuiles : la carte en est la source, d'où une ref plutôt
  // qu'un état — ils changent à chaque déplacement et ne servent qu'ici.
  const placesRef = useRef<Place[]>([]);
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  // L'enseigne cherchée ne suit pas les déplacements : la carte garde ses
  // résultats jusqu'à ce qu'on demande explicitement de rechercher ici.
  const brandRef = useRef(brandPlaces);
  brandRef.current = brandPlaces;
  const onBrandStaleRef = useRef(onBrandStale);
  onBrandStaleRef.current = onBrandStale;
  const onViewportRef = useRef(onViewportChange);
  onViewportRef.current = onViewportChange;
  const poiTimer = useRef<number | null>(null);
  /**
   * Ce que la couche des POI montre déjà : sa source (une nouvelle après chaque
   * changement de style) et la liste des lieux. Relire les tuiles sans rien
   * trouver de neuf ne renvoie rien à MapLibre — voir `refreshPois`.
   */
  const poiDrawnRef = useRef<{ source: unknown; signature: string }>({ source: null, signature: "" });
  // Lignes desservant les arrêts visibles, dessinées à la place du pictogramme
  // de catégorie. Elles arrivent après coup — c'est une requête réseau — d'où
  // la ref plutôt qu'un état : la carte se met à jour toute seule.
  const stopLinesRef = useRef<Map<string, StopLines>>(new Map());
  const stopLinesAbort = useRef<AbortController | null>(null);
  const onPoiStatusRef = useRef(onPoiStatusChange);
  onPoiStatusRef.current = onPoiStatusChange;
  const routeRef = useRef<RouteResult | null>(route);
  routeRef.current = route;
  const onSelectRef = useRef(onSelectPlace);
  onSelectRef.current = onSelectPlace;
  const onBackgroundClickRef = useRef(onBackgroundClick);
  onBackgroundClickRef.current = onBackgroundClick;
  const styleKeyRef = useRef(styleKey(theme, basemap));
  const trafficRef = useRef(traffic);
  trafficRef.current = traffic;
  // Les événements lus, gardés hors du rendu : la carte est leur seule
  // destinataire, et les tenir en état redessinerait l'application à chaque
  // relecture du flux.
  const trafficEventsRef = useRef<TrafficEvent[]>([]);
  const mapillaryRef = useRef(mapillary);
  mapillaryRef.current = mapillary;
  const onSelectStreetPhotoRef = useRef(onSelectStreetPhoto);
  onSelectStreetPhotoRef.current = onSelectStreetPhoto;
  const onBearingChangeRef = useRef(onBearingChange);
  onBearingChangeRef.current = onBearingChange;
  const pickingRef = useRef(picking);
  pickingRef.current = picking;
  const is3DRef = useRef(is3D);
  const reliefRef = useRef(relief);
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const basemapRef = useRef(basemap);
  basemapRef.current = basemap;

  // Remplace le pictogramme des arrêts par les pastilles de leurs lignes.
  // Se fait après l'affichage : la carte ne doit pas attendre le réseau, les
  // pastilles se substituent aux pictogrammes dès qu'elles arrivent.
  const refreshStopLines = useCallback(async (map: MLMap, places: Place[]) => {
    if (map.getZoom() < CONFIG.MIN_ZOOM_FOR_LINE_ICONS) return;
    const stops = places.filter((place) => isTransitStop(place) && !stopLinesRef.current.has(place.id));
    if (stops.length === 0) return;

    stopLinesAbort.current?.abort();
    const controller = new AbortController();
    stopLinesAbort.current = controller;

    const bounds = map.getBounds();
    const center = bounds.getCenter();
    const radius = Math.max(
      300,
      distanceBetween(
        { lon: bounds.getWest(), lat: bounds.getSouth() },
        { lon: bounds.getEast(), lat: bounds.getNorth() }
      ) / 2
    );

    try {
      const found = await getLinesForStops(
        stops,
        { lon: center.lng, lat: center.lat },
        radius,
        map.getZoom() >= CONFIG.MIN_ZOOM_FOR_BUS_STOPS,
        controller.signal
      );
      if (found.size === 0 || controller.signal.aborted) return;
      for (const [id, lines] of found) stopLinesRef.current.set(id, lines);

      installLineImages(map, found.values());
      const source = map.getSource(POI_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      source?.setData(placesToGeoJSON(placesRef.current, stopLinesRef.current));
    } catch {
      // Réseau indisponible : les arrêts gardent leur pictogramme de catégorie.
    }
  }, []);

  // Relit les POI des tuiles couvrant la vue et les pousse dans la couche.
  // Aucun réseau : tout est déjà en mémoire, l'affichage suit le déplacement.
  const refreshPois = useCallback(() => {
    const map = mapRef.current;
    const source = map?.getSource(POI_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (!map || !source) return;

    const zoom = map.getZoom();
    const bbox = currentBbox(map);
    onViewportRef.current(bbox);

    // Une recherche d'enseigne remplace les catégories : ses résultats viennent
    // du géocodeur et non des tuiles, ce qui les rend visibles même sur une
    // carte très dézoomée, où les tuiles ne portent plus les commerces.
    const brandQuery = brandRef.current;
    let places: Place[] = [];
    if (brandQuery) places = brandQuery;
    else if (zoom >= CONFIG.MIN_ZOOM_FOR_POIS) {
      places = collectTilePois(map, {
        groups: groupsRef.current,
        showBusStops: zoom >= CONFIG.MIN_ZOOM_FOR_BUS_STOPS,
        bbox,
        limit: CONFIG.MAX_VISIBLE_POIS,
      });
    }
    placesRef.current = places;
    // **Rien à renvoyer si rien n'a changé.** `setLayoutProperty` relance le
    // placement de tous les pictogrammes et `setData` le découpage de la couche,
    // même à l'identique : pendant le glissement d'une navigation, la carte
    // relisait ainsi tout, plusieurs fois par seconde, pour le même résultat.
    const signature = `${brandQuery ? "brand" : "tiles"}|${stopLinesRef.current.size}|${places.map((place) => place.id).join(",")}`;
    const drawn = poiDrawnRef.current;
    if (drawn.source !== source || drawn.signature !== signature) {
      poiDrawnRef.current = { source, signature };
      // Chaque résultat d'enseigne doit se voir, y compris de loin : le
      // décombrement, utile pour les commerces du quotidien, en escamoterait la
      // moitié et donnerait l'impression qu'ils sont regroupés.
      if (map.getLayer(POI_LAYER_ID)) {
        const allowOverlap: PropertyValueSpecification<boolean> = brandQuery
          ? true
          : ["step", ["zoom"], false, 15, true];
        map.setLayoutProperty(POI_LAYER_ID, "icon-allow-overlap", allowOverlap);
      }
      source.setData(placesToGeoJSON(places, stopLinesRef.current, !!brandQuery));
      void refreshStopLines(map, places);
    }

    // « Chargement » ne concerne plus qu'une chose : les tuiles de la zone qui
    // ne sont pas encore arrivées. Les POI qu'elles portent apparaîtront au fil
    // de leur réception.
    if (brandRef.current) {
      onPoiStatusRef.current("idle");
      return;
    }
    if (groupsRef.current.length === 0) {
      onPoiStatusRef.current("empty");
      return;
    }
    const tilesPending = zoom >= CONFIG.MIN_ZOOM_FOR_POIS && !!map.getSource(VECTOR_SOURCE_ID) && !map.isSourceLoaded(VECTOR_SOURCE_ID);
    onPoiStatusRef.current(tilesPending ? "loading" : "idle");
  }, [refreshStopLines]);

  // Les tuiles arrivent par paquets : on regroupe les relectures pour ne pas
  // reconstruire la couche à chaque événement.
  const scheduleRefreshPois = useCallback((delay = 120) => {
    if (poiTimer.current !== null) return;
    poiTimer.current = window.setTimeout(() => {
      poiTimer.current = null;
      refreshPois();
    }, delay);
  }, [refreshPois]);

  // Initialisation (une seule fois)
  useEffect(() => {
    if (!containerRef.current) return;
    // Dans l'APK, la carte lit elle-même les zones téléchargées : il n'y a pas
    // de Service Worker pour le faire (voir `services/offline/nativeTiles.ts`).
    const readsZones = installOfflineTiles();
    const map = new maplibregl.Map({
      container: containerRef.current,
      ...(readsZones ? { transformRequest: offlineTransformRequest } : {}),
      style: resolveStyle(theme, basemap),
      center: [CONFIG.DEFAULT_CENTER.lon, CONFIG.DEFAULT_CENTER.lat],
      zoom: CONFIG.DEFAULT_ZOOM,
      pitch: is3D ? PITCH_3D : 0,
      // Hors vue 3D, l'inclinaison est verrouillée à plat (voir l'effet dédié).
      maxPitch: is3D ? PITCH_3D : 0,
      // **Pas de bandeau d'attribution sur la carte.** Il occupait toute la
      // largeur en bas de l'écran, par-dessus la carte, et recouvrait les
      // boutons flottants sur un téléphone. Elle n'est pas supprimée pour
      // autant — la licence ODbL l'exige et le projet le rappelle : elle est
      // **déplacée** au bas du menu principal, où elle reste consultable à tout
      // moment (voir `onAttributionChange` et `AppMenu`).
      attributionControl: false,
    });
    mapRef.current = map;
    // Diagnostic par le câble (`window.__myosm.map`) : mesurer une navigation
    // demande de lire le tracé et la caméra depuis la console de la WebView.
    // Absent de la version release (`__DIAGNOSTICS__`).
    if (__DIAGNOSTICS__) {
      (window as unknown as { __myosm?: Record<string, unknown> }).__myosm = {
        ...(window as unknown as { __myosm?: Record<string, unknown> }).__myosm,
        map,
      };
    }
    // Hors ligne, la carte se limite au zoom des zones téléchargées.
    const stopFollowingConnectivity = readsZones ? followConnectivity(map) : null;

    // Le premier geste de l'utilisateur : passé ce moment, le placement
    // d'ouverture sur la position n'a plus lieu. Nos propres mouvements de
    // caméra n'ont pas d'`originalEvent`, ce qui les distingue.
    const markTouched = (event: { originalEvent?: unknown }) => {
      if (event.originalEvent) userTouchedRef.current = true;
    };
    map.on("dragstart", markTouched);
    map.on("zoomstart", markTouched);
    map.on("rotatestart", markTouched);
    map.on("pitchstart", markTouched);

    // `style.load` plutôt que `load` : le second n'arrive qu'une fois les
    // premières tuiles peintes, si bien que les bâtiments s'affichaient une
    // fraction de seconde en relief avant d'être aplatis. Au chargement du
    // style, aucune tuile n'est encore dessinée — le réglage prend effet avant
    // la première image. Un même gestionnaire sert au démarrage et à chaque
    // changement de fond de carte, qui repart lui aussi du style d'origine.
    map.on("style.load", () => {
      installMapLayers(
        map,
        placesRef.current,
        stopLinesRef.current,
        routeRef.current,
        themeRef.current,
        basemapRef.current,
        is3DRef.current,
        reliefRef.current,
        !!brandRef.current,
        mapillaryRef.current,
        trafficRef.current,
        trafficEventsRef.current,
        choicesRef.current,
        boldRouteRef.current,
        routeTrafficToGeoJSON(choicesRef.current, navTrafficRef.current, boldRouteRef.current)
      );
      refreshPois();
    });

    // Les erreurs de MapLibre remontent à l'application. Sans cela, un style
    // qui n'arrive pas, un contexte WebGL refusé ou une tuile rejetée laissent
    // une carte grise et muette — et la cause n'est lisible que dans une
    // console, qui n'existe pas sur un téléphone.
    map.on("error", (event: { error?: { message?: string } }) => {
      const message = event?.error?.message;
      if (message) onMapErrorRef.current(message);
    });

    // Les sources vont et viennent avec les calques : on relit les crédits à
    // chaque annonce de style plutôt qu'une fois pour toutes.
    // Seulement quand le texte change : `sourcedata` part à chaque tuile reçue,
    // et un nouveau tableau à chaque fois redessinait toute l'application.
    let lastCredits = "";
    const refreshAttribution = () => {
      const credits = collectAttribution(map);
      const key = credits.join("\n");
      if (key === lastCredits) return;
      lastCredits = key;
      onAttributionRef.current(credits);
    };
    map.on("styledata", refreshAttribution);
    map.on("sourcedata", refreshAttribution);

    map.on("mouseenter", POI_LAYER_ID, () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", POI_LAYER_ID, () => (map.getCanvas().style.cursor = ""));

    map.on("moveend", () => {
      // Pendant une recherche d'enseigne, bouger la carte ne relance pas la
      // recherche : elle est proposée par un bouton, comme le veut l'usage.
      // L'emprise, elle, doit suivre — sans quoi « rechercher dans cette zone »
      // repartirait sur la zone d'avant le déplacement, invisible à l'écran.
      if (brandRef.current) {
        onViewportRef.current(currentBbox(map));
        onBrandStaleRef.current();
        return;
      }
      // Pendant le glissement d'une navigation, `jumpTo` émet un `moveend` à
      // **chaque image** (60 par seconde) : les POI ne sont alors relus qu'une
      // fois par seconde au plus. Hors navigation, un `moveend` est la fin d'un
      // geste, et la relecture reste immédiate.
      if (navGlideRef.current.frame !== 0) {
        scheduleRefreshPois(NAV_POI_REFRESH_MS);
        return;
      }
      refreshPois();
    });
    // Une tuile qui arrive apporte ses POI : on relit sans attendre un
    // déplacement, sinon la carte resterait vide jusqu'au prochain geste.
    map.on("sourcedata", (e) => {
      if (brandRef.current) return;
      // Uniquement quand la source a fini de charger la vue : pendant le
      // chargement, l'événement part à chaque tuile et relire des dizaines de
      // milliers d'entités à chaque fois n'apporte rien de plus à l'écran.
      if (e.sourceId === VECTOR_SOURCE_ID && e.isSourceLoaded) scheduleRefreshPois();
    });

    // Le cap est rapporté au degré près : l'aiguille de la boussole n'a pas
    // besoin de plus, et chaque valeur distincte coûte un rendu de
    // l'application pendant tout le geste de rotation.
    let lastBearing = 0;
    map.on("rotate", () => {
      const bearing = Math.round(map.getBearing());
      if (bearing === lastBearing) return;
      lastBearing = bearing;
      onBearingChangeRef.current(bearing);
    });

    map.on("click", (e: MapMouseEvent) => {
      let hitPlace: Place | undefined;
      try {
        const hits = map.queryRenderedFeatures(e.point, { layers: [POI_LAYER_ID] });
        hitPlace = hits.length ? placesRef.current.find((p) => p.id === hits[0].properties?.id) : undefined;
      } catch {
        hitPlace = undefined; // la couche peut être absente pendant un changement de style
      }
      if (hitPlace) {
        onSelectRef.current(hitPlace);
        return;
      }

      // Un point de prise de vue : la photo prime sur le fond de carte, mais
      // jamais sur un commerce — c'est la carte qu'on lit d'abord. Ni sur une
      // question posée par le panneau d'itinéraire : on désigne alors un
      // endroit, et une photo ne serait pas une réponse.
      if (!pickingRef.current && mapillaryRef.current && map.getLayer(MAPILLARY_IMAGE_LAYER_ID)) {
        try {
          const shots = map.queryRenderedFeatures(e.point, { layers: [MAPILLARY_IMAGE_LAYER_ID] });
          const shot = shots[0]?.properties;
          if (shot?.id !== undefined) {
            onSelectStreetPhotoRef.current({
              id: String(shot.id),
              sequenceId: shot.sequence_id ? String(shot.sequence_id) : undefined,
              lon: e.lngLat.lng,
              lat: e.lngLat.lat,
            });
            return;
          }
        } catch {
          // La couche peut disparaître pendant un changement de style.
        }
      }
      onBackgroundClickRef.current({ lon: e.lngLat.lng, lat: e.lngLat.lat });
    });

    return () => {
      if (poiTimer.current !== null) window.clearTimeout(poiTimer.current);
      stopFollowingConnectivity?.();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Changement de fond de carte : thème clair/sombre ou vue plan/satellite.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const key = styleKey(theme, basemap);
    if (key === styleKeyRef.current) return; // style inchangé (ex: thème modifié en vue satellite)
    styleKeyRef.current = key;
    // `diff: false` force un rechargement complet (le diff entre un style
    // vectoriel et un style raster inline n'est pas fiable). `style.load` est
    // refiré une fois le nouveau style chargé, et le gestionnaire posé à
    // l'initialisation y réinstalle nos sources et nos couches, que `setStyle`
    // a retirées.
    map.setStyle(resolveStyle(theme, basemap), { diff: false });
  }, [theme, basemap, refreshPois]);

  // Relief : ombrage du sol, et volume dès que la caméra s'incline.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    reliefRef.current = relief;
    // `style.load` peut n'être pas passé au premier rendu : la pose est alors
    // faite par `installMapLayers`, qui lit la même ref.
    if (map.isStyleLoaded()) applyRelief(map, relief, is3D);
  }, [relief, is3D]);

  // Vue 3D : on incline la caméra. Les bâtiments en volume viennent du fond de
  // carte lui-même (couche `building-3d` de Liberty, en extrusion depuis le
  // zoom 14) : ils se dressent d'eux-mêmes dès que la caméra n'est plus à la
  // verticale. La vue satellite, en tuiles raster, n'a pas de bâtiments à
  // dresser : elle gagne seulement la perspective.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || is3DRef.current === is3D) return; // inclut le premier rendu
    is3DRef.current = is3D;
    if (is3D) {
      // Le relief d'abord : les immeubles se dressent pendant que la caméra
      // s'incline, plutôt que d'apparaître d'un bloc à la fin du mouvement.
      applyBuildingRelief(map, true);
      applyRelief(map, reliefRef.current, true);
      map.setMaxPitch(PITCH_3D);
      map.easeTo({ pitch: PITCH_3D, duration: 600 });
      return;
    }
    map.easeTo({ pitch: 0, duration: 600 });
    // Verrou et mise à plat attendent la fin du mouvement : `setMaxPitch(0)`
    // ramènerait la caméra d'un coup, et voir les immeubles s'effacer alors
    // que la carte est encore inclinée ferait un trou dans le paysage.
    map.once("moveend", () => {
      map.setMaxPitch(0);
      applyBuildingRelief(map, false);
      applyRelief(map, reliefRef.current, false);
    });
  }, [is3D]);

  // Changement de catégories cochées : les POI sont déjà là, il n'y a qu'à
  // refaire le tri.
  useEffect(() => {
    refreshPois();
  }, [groups, refreshPois]);

  // Entrée dans une recherche d'enseigne, sortie, ou relance sur la vue
  // courante : dans les trois cas on relit la zone.
  useEffect(() => {
    refreshPois();
  }, [brandPlaces, refreshPois]);

  // Couverture Mapillary : ajoutée et retirée à la volée, sans toucher au
  // style. Au changement de fond de carte, c'est `installMapLayers` qui la
  // réinstalle, comme le reste des couches applicatives.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    applyMapillary(map, mapillary);
  }, [mapillary]);

  // Le curseur annonce qu'un point de prise de vue est cliquable.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const enter = () => (map.getCanvas().style.cursor = "pointer");
    const leave = () => (map.getCanvas().style.cursor = "");
    map.on("mouseenter", MAPILLARY_IMAGE_LAYER_ID, enter);
    map.on("mouseleave", MAPILLARY_IMAGE_LAYER_ID, leave);
    return () => {
      map.off("mouseenter", MAPILLARY_IMAGE_LAYER_ID, enter);
      map.off("mouseleave", MAPILLARY_IMAGE_LAYER_ID, leave);
    };
  }, []);

  // Tracé de la ligne consultée. Il arrive du réseau : la carte n'attend pas,
  // le tracé s'ajoute quand il est là et disparaît dès qu'on replie la ligne.
  const lineId = focusedLine?.lineId;
  const lineColor = focusedLine?.color;
  useEffect(() => {
    const map = mapRef.current;
    const source = map?.getSource(LINE_SHAPE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (!map || !source) return;

    if (!lineId || !lineColor) {
      source.setData(emptyCollection());
      return;
    }

    map.setPaintProperty(LINE_SHAPE_LAYER_ID, "line-color", lineColor);
    const controller = new AbortController();
    let cancelled = false;
    loadLineShape(lineId, controller.signal)
      .then((geometry) => {
        if (cancelled || !geometry) return;
        source.setData({ type: "FeatureCollection", features: [{ type: "Feature", geometry, properties: {} }] });
      })
      .catch(() => {
        // Tracé indisponible : la carte reste telle quelle, c'est un complément.
      });

    return () => {
      cancelled = true;
      controller.abort();
      source.setData(emptyCollection());
    };
    // Les champs plutôt que l'objet : un tracé de RER pèse des centaines de
    // kilo-octets, il n'est pas question de le redessiner parce qu'une ligne
    // identique arrive dans un nouvel objet.
  }, [lineId, lineColor]);

  // Mise à jour du tracé d'itinéraire + cadrage sur l'ensemble du trajet
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const source = map.getSource(ROUTE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    source?.setData(routeToGeoJSON(route));
    if (!route || !route.segments.length) return;
    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;
    for (const segment of route.segments) {
      for (const [lon, lat] of segment.geometry.coordinates) {
        if (lon < minLon) minLon = lon;
        if (lat < minLat) minLat = lat;
        if (lon > maxLon) maxLon = lon;
        if (lat > maxLat) maxLat = lat;
      }
    }
    if (minLon > maxLon) return;
    map.fitBounds(
      [
        [minLon, minLat],
        [maxLon, maxLat],
      ],
      { padding: { top: 210, bottom: 120, left: 56, right: 56 }, duration: 600, maxZoom: 16 }
    );
  }, [route]);

  // Marqueur du lieu sélectionné / destination
  useEffect(() => {
    selectedMarkerRef.current?.remove();
    selectedMarkerRef.current = null;
    const map = mapRef.current;
    if (!map || !selectedPlace) return;
    // Le repère recouvre le pictogramme du lieu : le toucher vaut toucher le
    // lieu lui-même, ce qui rafraîchit par exemple les passages d'un arrêt.
    // Sans l'arrêt de propagation, la carte y verrait un clic dans le vide et
    // remplacerait la fiche par l'adresse du point.
    const element = pinElement("#FF3B30");
    const place = selectedPlace;
    element.addEventListener("click", (event) => {
      event.stopPropagation();
      onSelectRef.current(place);
    });
    const marker = new maplibregl.Marker({ element, anchor: "bottom" })
      .setLngLat([selectedPlace.lon, selectedPlace.lat])
      .addTo(map);
    selectedMarkerRef.current = marker;
  }, [selectedPlace]);

  // Repère de la vue de rue : il se pose sur la photo consultée et pivote avec
  // la caméra. Le marqueur est créé une fois puis déplacé — le recréer à chaque
  // degré de rotation ferait clignoter la carte.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!streetPosition) {
      streetMarkerRef.current?.remove();
      streetMarkerRef.current = null;
      return;
    }

    if (!streetMarkerRef.current) {
      streetMarkerRef.current = new maplibregl.Marker({
        element: streetViewElement(),
        // Le cône appartient au sol, pas à l'écran : il suit la rotation et
        // l'inclinaison de la carte.
        rotationAlignment: "map",
        pitchAlignment: "map",
      })
        .setLngLat([streetPosition.lon, streetPosition.lat])
        .addTo(map);
    } else {
      streetMarkerRef.current.setLngLat([streetPosition.lon, streetPosition.lat]);
    }
    streetMarkerRef.current.setRotation(streetPosition.bearing ?? 0);
  }, [streetPosition]);

  // Marqueurs des lieux enregistrés. Ils sont peu nombreux — quelques dizaines
  // au plus — d'où des marqueurs du DOM plutôt qu'une couche de plus : ils
  // survivent aux changements de style sans avoir à être réinstallés.
  useEffect(() => {
    const map = mapRef.current;
    for (const marker of savedMarkersRef.current) marker.remove();
    savedMarkersRef.current = [];
    if (!map) return;

    for (const place of savedPlaces) {
      const element = pinElement(place.color);
      element.classList.add("is-saved");
      element.addEventListener("click", (event) => {
        // Sans cela, le clic traverse jusqu'à la carte, qui le prend pour un
        // clic dans le vide et referme la fiche qu'on vient d'ouvrir.
        event.stopPropagation();
        onSelectSavedRef.current(place);
      });
      const marker = new maplibregl.Marker({ element, anchor: "bottom" })
        .setLngLat([place.lon, place.lat])
        .addTo(map);
      savedMarkersRef.current.push(marker);
    }

    return () => {
      for (const marker of savedMarkersRef.current) marker.remove();
      savedMarkersRef.current = [];
    };
  }, [savedPlaces]);

  // Repères du parcours : départ, étapes numérotées, arrivée. Comme les lieux
  // enregistrés, ce sont des marqueurs du DOM — ils sont dix-sept au plus, et
  // survivent ainsi aux changements de style sans réinstallation.
  //
  // Ils sont tous refaits à chaque changement de la liste plutôt que déplacés :
  // réordonner change le rôle et le numéro d'un repère autant que sa position,
  // et retrouver lequel a bougé coûterait plus que de les redessiner.
  useEffect(() => {
    const map = mapRef.current;
    for (const marker of stopMarkersRef.current) marker.remove();
    stopMarkersRef.current = [];
    if (!map) return;

    for (const stop of routeStops) {
      const element =
        stop.role === "step"
          ? waypointPinElement(STOP_COLOR.step, stop.rank)
          : pinElement(STOP_COLOR[stop.role]);
      stopMarkersRef.current.push(
        new maplibregl.Marker({ element, anchor: "bottom" }).setLngLat([stop.lon, stop.lat]).addTo(map)
      );
    }

    return () => {
      for (const marker of stopMarkersRef.current) marker.remove();
      stopMarkersRef.current = [];
    };
  }, [routeStops]);

  // Marqueur "position actuelle"
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // Position inconnue — ou guidage en cours, où `App` la retire au profit de
    // la flèche orientée : le point ordinaire s'efface plutôt que de rester
    // planté sous elle.
    if (!userLocation) {
      userMarkerRef.current?.remove();
      userMarkerRef.current = null;
      return;
    }
    const lngLat: [number, number] = [userLocation.lon, userLocation.lat];
    if (!userMarkerRef.current) {
      // maplibre-gl v6 : setLngLat() doit précéder addTo(), sinon _update()
      // lit une position indéfinie et lève une erreur.
      userMarkerRef.current = new maplibregl.Marker({ element: dotElement(), anchor: "center" })
        .setLngLat(lngLat)
        .addTo(map);
    } else {
      userMarkerRef.current.setLngLat(lngLat);
    }
  }, [userLocation]);

  // L'épaisseur du tracé suit le mode de guidage. Une propriété de peinture se
  // change à chaud — inutile de refaire la couche, encore moins le style.
  const boldRoute = navigation?.boldRoute ?? false;
  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getLayer(ROUTE_LAYER_ID)) return;
    map.setPaintProperty(ROUTE_LAYER_ID, "line-width", routeWidth(boldRoute));
  }, [boldRoute]);

  // Les itinéraires proposés avant de partir : les tracés, et leurs bulles.
  //
  // Effet à part du guidage lui-même, et c'est ce qu'il faut : les bulles ne
  // changent qu'au calcul des propositions ou quand on en met une en avant,
  // alors que la caméra du guidage se rejoue à chaque relevé GPS. Les mêler
  // ferait retirer et reposer trois marqueurs du DOM une fois par seconde.
  const choices = navigation?.choices ?? null;
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    for (const marker of choiceMarkersRef.current) marker.remove();
    choiceMarkersRef.current = [];

    const source = map.getSource(CHOICE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (!choices?.length) {
      source?.setData(EMPTY_COLLECTION);
      return;
    }

    // Le parcours mis en avant n'a pas besoin d'être écrit en dernier : il a sa
    // propre couche, posée au-dessus de celle des autres.
    source?.setData(choicesToGeoJSON(choices));

    for (const choice of choices) {
      // maplibre-gl v6 : setLngLat() doit précéder addTo().
      choiceMarkersRef.current.push(
        new maplibregl.Marker({ element: choiceBubbleElement(choice), anchor: "bottom" })
          .setLngLat([choice.at.lon, choice.at.lat])
          .addTo(map)
      );
    }

    return () => {
      for (const marker of choiceMarkersRef.current) marker.remove();
      choiceMarkersRef.current = [];
    };
  }, [choices]);

  // Le trafic : tronçons colorés — des propositions pendant le choix, du
  // parcours pendant la navigation — et repères d'incident sur le parcours.
  const navTraffic = navigation?.traffic ?? null;
  useEffect(() => {
    const source = mapRef.current?.getSource(ROUTE_TRAFFIC_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    source?.setData(routeTrafficToGeoJSON(choices, navTraffic, boldRoute));
  }, [choices, navTraffic, boldRoute]);

  // Les repères ne changent qu'avec le trafic lui-même (au départ, puis toutes
  // les trois minutes) : pas à chaque relevé, où ils clignoteraient.
  const incidentMarkersRef = useRef<maplibregl.Marker[]>([]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const marker of incidentMarkersRef.current) marker.remove();
    // maplibre-gl v6 : setLngLat() doit précéder addTo().
    incidentMarkersRef.current = (navTraffic?.incidents ?? []).map((incident) =>
      new maplibregl.Marker({ element: incidentElement(incident) }).setLngLat([incident.lon, incident.lat]).addTo(map)
    );
    return () => {
      for (const marker of incidentMarkersRef.current) marker.remove();
      incidentMarkersRef.current = [];
    };
  }, [navTraffic]);

  // Navigation guidée : le repère du marcheur, et la caméra qui le suit.
  //
  /** Interrompt le glissement en cours, et oublie le relevé précédent. */
  function stopNavGlide() {
    cancelAnimationFrame(navGlideRef.current.frame);
    navGlideRef.current = idleGlide();
  }

  /**
   * Une image du glissement : la flèche, puis la caméra si elle suit. Au plus
   * 60 par seconde — sur un écran à 120 Hz, une image sur deux est sautée.
   */
  function navGlideStep(time: number) {
    const map = mapRef.current;
    const marker = navMarkerRef.current;
    const glide = navGlideRef.current;
    if (!map || !marker) {
      glide.frame = 0;
      return;
    }
    if (glide.drawnAt > 0 && time - glide.drawnAt < NAV_FRAME_MS - NAV_FRAME_SLACK_MS) {
      glide.frame = requestAnimationFrame(navGlideStep);
      return;
    }
    glide.drawnAt = time;

    const span = Math.max(1, glide.endsAt - glide.startedAt);
    const t = Math.min(1, Math.max(0, (time - glide.startedAt) / span));
    const { arrowFrom: a, arrowTo: b } = glide;
    if (a && b) {
      marker.setLngLat([lerp(a.lng, b.lng, t), lerp(a.lat, b.lat, t)]).setRotation(a.bearing + shortestTurn(a.bearing, b.bearing) * t);
    }

    let tc = 1;
    const { camFrom: from, camTo: to } = glide;
    if (from && to) {
      tc = Math.min(1, Math.max(0, (time - glide.camStartedAt) / Math.max(1, glide.endsAt - glide.camStartedAt)));
      const k = glide.camEase ? easeInOut(tc) : tc;
      // `jumpTo` : un seul rendu par image, sans animation propre à MapLibre.
      // Il n'a pas d'`originalEvent`, et n'est donc pas pris pour un geste.
      map.jumpTo({
        center: [lerp(from.center[0], to.center[0], k), lerp(from.center[1], to.center[1], k)],
        bearing: from.bearing + shortestTurn(from.bearing, to.bearing) * k,
        zoom: lerp(from.zoom, to.zoom, k),
        pitch: lerp(from.pitch, to.pitch, k),
        padding: { top: lerp(from.paddingTop, to.paddingTop, k), bottom: 0, left: 0, right: 0 },
      });
      // Dessinée **tout de suite**, dans la même image que la flèche. Sinon la
      // carte attendait l'image suivante : la flèche bougeait sur l'une, la
      // carte sur l'autre, et l'écran se recomposait deux fois. Mesuré en
      // voiture simulée, fondu des libellés coupé : 63 images par seconde et
      // 1,93 cœur avec, 107 images et 2,52 cœurs sans.
      map.redraw();
    }
    glide.frame = t < 1 || tc < 1 ? requestAnimationFrame(navGlideStep) : 0;
  }

  /**
   * Fait glisser la flèche de là où elle est **affichée** jusqu'à la nouvelle
   * position, et la fait pivoter par le plus court chemin. Un relevé qui arrive
   * en plein glissement repart de la position intermédiaire : pas de saut.
   * Vrai si un glissement est en cours — la caméra s'y raccroche alors.
   */
  function glideNavArrow(marker: maplibregl.Marker, to: [number, number], bearing: number): boolean {
    const glide = navGlideRef.current;
    const now = performance.now();
    const sameTarget = glide.target !== null && glide.target[0] === to[0] && glide.target[1] === to[1];
    // Le guidage a pu se redessiner sans nouveau relevé (reprise du suivi, par
    // exemple) : on laisse finir le glissement en cours au lieu de le relancer.
    if (sameTarget && glide.frame !== 0) return true;
    if (sameTarget) {
      marker.setRotation(bearing);
      return false;
    }

    cancelAnimationFrame(glide.frame);
    const interval = glide.lastAt > 0 ? now - glide.lastAt : NAV_GLIDE_MAX_MS;
    const duration = Math.min(NAV_GLIDE_MAX_MS, Math.max(NAV_GLIDE_MIN_MS, interval));
    const from = marker.getLngLat();

    if (from.distanceTo(new maplibregl.LngLat(to[0], to[1])) > NAV_GLIDE_JUMP_METERS) {
      navGlideRef.current = idleGlide(now, to);
      marker.setLngLat(to).setRotation(bearing);
      return false;
    }

    navGlideRef.current = {
      ...idleGlide(now, to),
      startedAt: now,
      endsAt: now + duration,
      arrowFrom: { lng: from.lng, lat: from.lat, bearing: marker.getRotation() },
      arrowTo: { lng: to[0], lat: to[1], bearing },
    };
    navGlideRef.current.frame = requestAnimationFrame(navGlideStep);
    return true;
  }

  /** La pose où la caméra est à cet instant. */
  function currentPose(map: maplibregl.Map): NavCameraPose {
    const center = map.getCenter();
    return {
      center: [center.lng, center.lat],
      bearing: map.getBearing(),
      zoom: map.getZoom(),
      pitch: map.getPitch(),
      paddingTop: map.getPadding().top ?? 0,
    };
  }

  /** Raccroche la caméra au glissement en cours : depuis là où elle est, jusqu'à la même fin. */
  function glideNavCamera(map: maplibregl.Map, pose: NavCameraPose) {
    const glide = navGlideRef.current;
    glide.camFrom = currentPose(map);
    glide.camTo = pose;
    glide.camStartedAt = performance.now();
    glide.camEase = false;
    if (glide.frame === 0) glide.frame = requestAnimationFrame(navGlideStep);
  }

  /**
   * Recadre sans glissement de flèche — un saut, un changement de zoom, la
   * reprise du suivi — dans la même boucle plafonnée, avec une courbe amortie.
   * Rien du tout si la caméra y est déjà : à l'arrêt, chaque relevé redemande
   * la même pose, et c'est ce qui faisait tourner la carte à 120 Hz.
   */
  function easeNavCamera(map: maplibregl.Map, pose: NavCameraPose) {
    const glide = navGlideRef.current;
    const target = glide.camTo ?? currentPose(map);
    if (samePose(target, pose)) return;
    const now = performance.now();
    cancelAnimationFrame(glide.frame);
    // La flèche est déjà à destination (sans quoi elle glisserait) : elle ne
    // doit pas rejouer son dernier glissement sur la nouvelle durée.
    glide.arrowFrom = null;
    glide.arrowTo = null;
    glide.camFrom = currentPose(map);
    glide.camTo = pose;
    glide.camStartedAt = now;
    glide.startedAt = now;
    glide.endsAt = now + NAV_CAMERA_EASE_MS;
    glide.camEase = true;
    glide.drawnAt = 0;
    glide.frame = requestAnimationFrame(navGlideStep);
  }

  // La définition de la carte, légèrement abaissée tant qu'une flèche est
  // suivie : c'est là que la carte se redessine sans arrêt.
  const arrowFollowed = Boolean(navigation?.position);
  // La durée de fondu d'origine des libellés, rendue à la fin de la navigation.
  const labelFadeRef = useRef<number | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const full = window.devicePixelRatio || 1;
    const wanted = arrowFollowed ? full * NAV_PIXEL_RATIO_SHARE : full;
    if (Math.abs(map.getPixelRatio() - wanted) > 0.01) map.setPixelRatio(wanted);
    // **Pas de fondu des libellés** tant que la flèche est suivie. Carte en
    // mouvement, chaque image replace les libellés, et chaque placement relance
    // 300 ms de fondu : MapLibre se redessinait alors à la fréquence de l'écran
    // au lieu de suivre la boucle — mesuré en voiture simulée, 178 rendus par
    // seconde (175 relancés par le placement) contre 61 sans fondu, et 2,46
    // cœurs contre 2,02. L'option publique `fadeDuration` ne se règle qu'à la
    // création de la carte : c'est son champ interne qui est basculé ici. S'il
    // disparaît d'une version de MapLibre, rien ne casse — le fondu revient,
    // et la mesure le dira.
    const labels = map as unknown as { _fadeDuration?: number };
    if (typeof labels._fadeDuration === "number") {
      labelFadeRef.current ??= labels._fadeDuration;
      labels._fadeDuration = arrowFollowed ? 0 : labelFadeRef.current;
    }
  }, [arrowFollowed]);

  // Le glissement ne survit pas à la carte.
  useEffect(() => () => cancelAnimationFrame(navGlideRef.current.frame), []);

  // Le marqueur est créé une fois puis déplacé — le recréer à chaque relevé le
  // ferait clignoter. Il **glisse** d'un relevé au suivant (`glideNavArrow`), et
  // la caméra fait le même chemin, sur la même durée, à vitesse constante et
  // **dans la même boucle** (`navGlideStep`, 60 images par seconde au plus) : la
  // flèche reste ainsi immobile à l'écran pendant que la carte défile. Avec la
  // courbe d'accélération par défaut d'`easeTo`, la carte rattrapait la flèche
  // en freinant puis repartait — une saccade par relevé.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!navigation) {
      // Le guidage s'arrête : la marge de caméra part avec lui, sinon tous les
      // recentrages suivants — un résultat de recherche, le bouton de position —
      // placeraient leur cible dans le bas de l'écran. L'inclinaison revient du
      // même mouvement à ce que dit le menu des calques : le guidage aplatit la
      // carte le temps qu'il dure, y compris en vue 3D.
      navFrameRef.current = null;
      stopNavGlide();
      if (navMarkerRef.current) {
        navMarkerRef.current.remove();
        navMarkerRef.current = null;
        map.easeTo({
          padding: { top: 0, bottom: 0, left: 0, right: 0 },
          pitch: is3DRef.current ? PITCH_3D : 0,
          duration: 400,
        });
      }
      return;
    }

    // En transports, la position manque le plus souvent — on est sous terre —
    // et c'est le cadrage du tronçon qui renseigne. Pas de flèche, alors : une
    // flèche immobile là où le signal s'est perdu induirait en erreur.
    // Vrai si la flèche glisse : la caméra se raccroche alors à sa boucle.
    let gliding = false;
    if (!navigation.position) {
      stopNavGlide();
      navMarkerRef.current?.remove();
      navMarkerRef.current = null;
    } else {
    const lngLat: [number, number] = [navigation.position.lon, navigation.position.lat];
    const large = navigation.largeArrow === true;
    // Passer de la marche à la voiture change la taille : la flèche se refait.
    if (navMarkerRef.current && navMarkerRef.current.getElement().dataset.large !== String(large)) {
      stopNavGlide();
      navMarkerRef.current.remove();
      navMarkerRef.current = null;
    }
    if (!navMarkerRef.current) {
      // maplibre-gl v6 : setLngLat() doit précéder addTo().
      navMarkerRef.current = new maplibregl.Marker({
        element: navArrowElement(large),
        // La flèche appartient au sol : elle suit la rotation et l'inclinaison
        // de la carte, comme le cône de la vue de rue.
        rotationAlignment: "map",
        pitchAlignment: "map",
      })
        .setLngLat(lngLat)
        .addTo(map)
        .setRotation(navigation.heading);
      navGlideRef.current = idleGlide(performance.now(), lngLat);
    } else {
      gliding = glideNavArrow(navMarkerRef.current, lngLat, navigation.heading);
    }
    }

    // Cadrage d'un tronçon (guidage en transports). Il n'est rejoué qu'au
    // changement de jeton : la carte relancerait sinon son animation à chaque
    // battement d'horloge.
    const frame = navigation.frame;
    if (frame && frame.token !== navFrameRef.current) {
      navFrameRef.current = frame.token;
      map.fitBounds(
        [
          [frame.bbox[0], frame.bbox[1]],
          [frame.bbox[2], frame.bbox[3]],
        ],
        // La marge basse est la plus large : le bas de l'écran porte la liste
        // des actions, et un tronçon cadré dessous serait invisible.
        { padding: { top: 130, bottom: 300, left: 50, right: 50 }, maxZoom: 16, duration: 700 }
      );
    }

    const camera = navigation.camera;
    if (!camera) navGlideRef.current.camTo = null;
    if (camera) {
      // La marge haute assied le conducteur dans le bas de l'écran et dégage
      // devant lui la place du parcours à venir.
      const pose: NavCameraPose = {
        center: [camera.center.lon, camera.center.lat],
        bearing: camera.bearing,
        zoom: camera.zoom,
        pitch: camera.pitch,
        paddingTop: camera.paddingTop,
      };
      // Pas de glissement — un saut, un simple changement de zoom, la reprise
      // du suivi, l'arrêt : un recadrage amorti, et seulement s'il y a lieu.
      // **Pas d'`easeTo`** : il suit la fréquence de l'écran.
      if (gliding) glideNavCamera(map, pose);
      else easeNavCamera(map, pose);
    }
  }, [navigation]);

  // Le tracé d'une course (`navigation.trace`), dessiné tel qu'il arrive.
  //
  // **Pas par la prop `route`** : chaque changement d'itinéraire recadre la
  // carte sur son emprise, et un tracé qui s'allonge toutes les deux secondes
  // ferait sauter la vue autant de fois. Il a donc sa propre source, mise à jour
  // par `setData`, et reposée après chaque changement de style — `setStyle`
  // détruit toutes les sources.
  const trace = navigation?.trace ?? null;
  const traceRef = useRef(trace);
  traceRef.current = trace;
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const current = traceRef.current;
      if (!current) {
        for (const id of [RUN_TRACE_LAYER_ID, RUN_TRACE_CASING_ID]) if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource(RUN_TRACE_SOURCE_ID)) map.removeSource(RUN_TRACE_SOURCE_ID);
        return;
      }
      const data: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates: current.points.map((p) => [p.lon, p.lat]) },
          },
        ],
      };
      const source = map.getSource(RUN_TRACE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      if (source) {
        source.setData(data);
        return;
      }
      if (!map.isStyleLoaded()) return; // `style.load` le posera
      map.addSource(RUN_TRACE_SOURCE_ID, { type: "geojson", data });
      map.addLayer({
        id: RUN_TRACE_CASING_ID,
        type: "line",
        source: RUN_TRACE_SOURCE_ID,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#ffffff", "line-width": 8, "line-opacity": 0.85 },
      });
      map.addLayer({
        id: RUN_TRACE_LAYER_ID,
        type: "line",
        source: RUN_TRACE_SOURCE_ID,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": current.color, "line-width": 5 },
      });
    };
    apply();
    map.on("style.load", apply);
    return () => {
      map.off("style.load", apply);
    };
  }, [trace]);

  // Reprendre la carte en main pendant le guidage arrête le suivi : sinon le
  // recentrage suivant ramènerait aussitôt la vue, et il serait impossible de
  // regarder plus loin sur le parcours.
  //
  // Seuls les gestes de l'utilisateur comptent : les événements déclenchés par
  // notre propre `easeTo` n'ont pas d'`originalEvent`, ce qui les distingue.
  const navigating = navigation !== null;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !navigating) return;
    const notify = (event: { originalEvent?: unknown }) => {
      if (!event.originalEvent) return;
      // La boucle de glissement lâche la caméra tout de suite, sans attendre
      // que le guidage ait appris le geste : sinon elle la tirerait encore une
      // image ou deux contre le doigt.
      navGlideRef.current.camTo = null;
      onNavigationPanRef.current();
    };
    map.on("dragstart", notify);
    map.on("rotatestart", notify);
    map.on("pitchstart", notify);
    map.on("zoomstart", notify);
    return () => {
      map.off("dragstart", notify);
      map.off("rotatestart", notify);
      map.off("pitchstart", notify);
      map.off("zoomstart", notify);
    };
  }, [navigating]);

  // Calque « Trafic ». Le flux est lu à l'allumage, puis relu à l'intervalle de
  // son cache (`services/traffic.ts`) : trois minutes, la cadence à laquelle la
  // source elle-même republie. Éteindre le calque arrête la relecture — un
  // calque invisible n'a pas à consommer de données.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!traffic) {
      trafficEventsRef.current = [];
      if (map.isStyleLoaded()) applyTraffic(map, false, []);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    function refresh() {
      getTrafficEvents(controller.signal)
        .then((events) => {
          if (cancelled) return;
          trafficEventsRef.current = events;
          const current = mapRef.current;
          if (current?.isStyleLoaded()) applyTraffic(current, true, events);
        })
        .catch(() => {
          // Source injoignable — pas de relais en production, réseau coupé :
          // le calque reste allumé et vide plutôt que de s'éteindre tout seul.
        });
    }

    refresh();
    const timer = window.setInterval(refresh, CONFIG.TRAFFIC_TTL_MS);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(timer);
      const current = mapRef.current;
      if (current?.isStyleLoaded()) applyTraffic(current, false, []);
    };
  }, [traffic]);

  // Recentrage demandé (résultat de recherche, géolocalisation...)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyTo) return;
    // Pendant le guidage, se rendre ailleurs vaut reprise en main : sans cela,
    // le relevé GPS suivant ramènerait la carte sur le marcheur une seconde
    // après, et le lieu qu'on voulait voir aurait disparu. Le bouton
    // « Recentrer » rend la main au guidage.
    // Placement d'ouverture sur la position : immédiat, et abandonné si
    // l'utilisateur a déjà pris la carte en main — le relevé GPS peut arriver
    // plusieurs secondes après le démarrage.
    if (flyTo.initial) {
      if (!userTouchedRef.current) map.jumpTo({ center: [flyTo.lon, flyTo.lat], zoom: flyTo.zoom ?? 16 });
      return;
    }
    if (navMarkerRef.current) onNavigationPanRef.current();
    map.flyTo({ center: [flyTo.lon, flyTo.lat], zoom: flyTo.zoom ?? 16, essential: true });
  }, [flyTo]);

  // Remise au nord. **Le seul cap est remis**, pas l'inclinaison : en 3D, se
  // réorienter ne veut pas dire renoncer au relief qu'on est en train de
  // regarder.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || northRequest === null) return;
    map.easeTo({ bearing: 0, duration: 400 });
  }, [northRequest]);

  return <div ref={containerRef} className="map-container" />;
}
