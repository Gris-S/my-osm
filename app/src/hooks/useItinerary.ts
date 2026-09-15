import { useEffect, useMemo, useRef, useState } from "react";
import { CONFIG, type TravelMode } from "../config";
import { getRoute } from "../services/routing";
import { getTransitJourneys, journeyToRoute, type TransitJourney } from "../services/transit";
import { t } from "../i18n";
import type { LonLat, Place, RouteResult, RouteStop, RouteStopMarker, StopEdit } from "../types";

// ---------------------------------------------------------------------------
// L'itinéraire : les points du parcours, le mode, le calcul, les étapes et leurs
// repères sur la carte. Sorti d'`App` sans rien changer — `App` en reprend les
// mêmes noms. La position de l'appareil est passée d'en haut.
// ---------------------------------------------------------------------------

export function useItinerary(position: LonLat | null, locate: () => void) {
  // Le parcours entier, dans l'ordre : départ, étapes, arrivée. **Un seul
  // tableau**, et non trois états — le départ et l'arrivée se déplacent dans
  // l'ordre comme les étapes, ce qu'un départ et une arrivée tenus à part
  // rendraient impossible. Vide tant qu'aucun itinéraire n'est ouvert.
  //
  // L'ordre est un choix de l'utilisateur : aucun moteur ne le réarrange (voir
  // `services/routing.ts`).
  const [stops, setStops] = useState<RouteStop[]>([]);
  // La question posée par le panneau (« depuis quelle adresse ? »), s'il y en
  // a une. Elle est tenue ici et non dans le panneau parce qu'elle **arme la
  // carte** : tant qu'elle est ouverte, un clic sur la carte y répond.
  const [editingStop, setEditingStop] = useState<StopEdit | null>(null);
  const [routeMode, setRouteMode] = useState<TravelMode>("driving");
  // Deux moteurs, deux états : OSRM rend un tracé, Navitia rend des trajets
  // horaires parmi lesquels choisir. Le tracé passé à la carte est déduit de
  // l'un ou de l'autre selon le mode.
  const [roadRoute, setRoadRoute] = useState<RouteResult | null>(null);
  const [journeys, setJourneys] = useState<TransitJourney[] | null>(null);
  const [journeyIndex, setJourneyIndex] = useState(0);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);

  // La question ouverte, relue **après** le géocodage inverse d'un clic : entre
  // le clic et le nom de l'endroit, l'utilisateur a pu refermer l'éditeur, et
  // on ne doit pas répondre à une question retirée.
  const editingStopRef = useRef(editingStop);
  editingStopRef.current = editingStop;

  const itineraryOpen = stops.length > 0;

  /**
   * Les coordonnées de chaque point du parcours, dans l'ordre. `null` là où
   * elles ne sont pas encore connues — la position de l'appareil tant que la
   * géolocalisation n'a pas répondu.
   */
  const stopCoords: (LonLat | null)[] = stops.map((stop) =>
    stop.kind === "current" ? position : { lon: stop.place.lon, lat: stop.place.lat }
  );

  /** Vrai tant qu'un point du parcours attend la géolocalisation. */
  const awaitingLocation = stops.some((stop) => stop.kind === "current") && !position;

  function handleCloseItinerary() {
    setStops([]);
    setEditingStop(null);
    setRoadRoute(null);
    setJourneys(null);
    setRouteError(null);
  }

  /** Remplace un point du parcours par un lieu, sans changer son rang. */
  function handlePickStop(index: number, place: Place) {
    setStops((current) => current.map((stop, at) => (at === index ? { kind: "place", place } : stop)));
  }

  /**
   * Fait d'un point du parcours « ma position ». **Un seul point peut l'être** :
   * passer deux fois par soi-même n'aurait pas de sens, et les deux repères se
   * superposeraient sur la carte. Le refus est ici autant que dans l'interface
   * — qui n'offre alors pas le choix — pour qu'aucun appel ne puisse le
   * contourner.
   */
  function handleUseCurrentLocation(index: number) {
    setStops((current) =>
      current.some((stop, at) => at !== index && stop.kind === "current")
        ? current
        : current.map((stop, at) => (at === index ? { kind: "current" } : stop))
    );
    if (!position) locate();
  }

  /** Ajoute une étape à la fin du parcours, juste avant l'arrivée. */
  function handleAddStop(place: Place) {
    setStops((current) => {
      if (current.length - 2 >= CONFIG.MAX_WAYPOINTS) return current;
      const next = [...current];
      next.splice(next.length - 1, 0, { kind: "place", place });
      return next;
    });
  }

  /**
   * Retire un point du parcours. Un parcours a besoin de deux points : le
   * refus est ici, et pas seulement dans l'interface, pour qu'aucun appel ne
   * puisse laisser un itinéraire sans arrivée.
   */
  function handleRemoveStop(index: number) {
    setStops((current) => (current.length <= 2 ? current : current.filter((_, at) => at !== index)));
    // La question désigne sa cible par son rang, et la suppression renumérote :
    // sans ce recalage, elle porterait sur le voisin.
    setEditingStop((current) => {
      if (typeof current !== "number") return current;
      if (current === index) return null;
      return current > index ? current - 1 : current;
    });
  }

  /**
   * Déplace un point d'un rang, vers le haut (`-1`) ou vers le bas (`+1`).
   * Le départ et l'arrivée se déplacent comme les étapes : descendre le départ
   * fait de la première étape le nouveau point de départ.
   */
  function handleMoveStop(index: number, delta: -1 | 1) {
    // Un échange de rangs ferait pointer la question sur le voisin : on
    // remplacerait un point en croyant en modifier un autre.
    setEditingStop(null);
    setStops((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  // Le parcours complet, du départ à l'arrivée en passant par les étapes. C'est
  // cette liste que les deux moteurs reçoivent : OSRM l'enchaîne en un appel,
  // Navitia tronçon par tronçon (voir `services/transit.ts`). `null` tant qu'un
  // point manque — il n'y a pas de demi-parcours à calculer.
  const routePoints: LonLat[] | null =
    itineraryOpen && stopCoords.every((coords): coords is LonLat => coords !== null)
      ? (stopCoords as LonLat[])
      : null;

  // Ce qui, du parcours, justifie un recalcul : les coordonnées et leur ordre.
  // Renommer une étape ou remplacer un lieu par un autre au même point ne doit
  // pas coûter un appel — en transports, il est prélevé sur un quota.
  const routeKey = routePoints?.map((p) => `${p.lon},${p.lat}`).join(";") ?? null;

  // Calcule / recalcule l'itinéraire quand le parcours ou le mode changent. En
  // transports, c'est Navitia qui répond, sur les horaires du moment (voir
  // `services/transit.ts`) ; ailleurs, OSRM.
  useEffect(() => {
    if (!routePoints) return;
    const points = routePoints;
    const controller = new AbortController();
    let cancelled = false;
    setRouteLoading(true);
    setRouteError(null);
    // Le résultat précédent s'efface : sans cela, le tracé d'un mode restait
    // sur la carte pendant qu'on en calculait un autre.
    if (routeMode === "transit") setJourneys(null);
    else setRoadRoute(null);

    const request =
      routeMode === "transit"
        ? getTransitJourneys(points, controller.signal).then((list) => {
            if (cancelled) return;
            setJourneys(list);
            setJourneyIndex(0);
          })
        : getRoute(routeMode, points).then((r) => {
            if (!cancelled) setRoadRoute(r);
          });

    request
      .catch((e) => {
        if (cancelled || controller.signal.aborted) return;
        setRouteError(e instanceof Error ? e.message : t("error.unknown"));
      })
      .finally(() => {
        if (!cancelled) setRouteLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey, routeMode]);

  // Trajet en transports retenu, et tracé qui en découle : un tronçon par
  // étape, à la couleur de la ligne. Mémorisé, faute de quoi la carte
  // redessinerait le trajet à chaque rendu.
  const selectedJourney = routeMode === "transit" ? (journeys?.[journeyIndex] ?? null) : null;
  const route = useMemo(
    () => (routeMode === "transit" ? (selectedJourney ? journeyToRoute(selectedJourney) : null) : roadRoute),
    [routeMode, selectedJourney, roadRoute]
  );

  // Les repères du parcours sur la carte. Le rôle vient du **rang dans le
  // parcours entier**, pas de la place dans cette liste : un point dont on
  // ignore encore la position (la géolocalisation en vol) en est absent sans
  // que ses voisins changent de couleur pour autant.
  //
  // Mémorisé sur les seules positions : la carte retire et repose tous ses
  // repères quand la liste change d'identité, et la reconstruire à chaque rendu
  // les ferait clignoter à chaque frappe dans le champ de recherche.
  const stopMarkerKey = stops
    .map((stop, index) => {
      const coords = stopCoords[index];
      return `${stop.kind === "current" ? "@" : stop.place.id}:${coords ? `${coords.lon},${coords.lat}` : ""}`;
    })
    .join("|");
  const stopMarkers: RouteStopMarker[] = useMemo(
    () =>
      stops.flatMap((_, index) => {
        const coords = stopCoords[index];
        if (!coords) return [];
        const role: RouteStopMarker["role"] =
          index === 0 ? "origin" : index === stops.length - 1 ? "destination" : "step";
        return [{ ...coords, role, rank: index }];
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stopMarkerKey]
  );

  /**
   * Répond, s'il y a une question ouverte, par le lieu désigné. Rend vrai
   * quand la réponse a été prise — l'appelant sait alors qu'il n'a rien
   * d'autre à faire du clic.
   *
   * La question est relue dans sa ref : entre un clic sur la carte et le nom
   * que le géocodage inverse lui donne, l'éditeur a pu être refermé.
   */
  function answerStopPicker(place: Place): boolean {
    const target = editingStopRef.current;
    if (target === null) return false;
    if (target === "new") handleAddStop(place);
    else handlePickStop(target, place);
    setEditingStop(null);
    return true;
  }

  return {
    stops,
    setStops,
    editingStop,
    setEditingStop,
    routeMode,
    setRouteMode,
    journeys,
    journeyIndex,
    setJourneyIndex,
    routeLoading,
    routeError,
    itineraryOpen,
    stopCoords,
    awaitingLocation,
    routePoints,
    selectedJourney,
    route,
    stopMarkers,
    answerStopPicker,
    handleCloseItinerary,
    handlePickStop,
    handleUseCurrentLocation,
    handleAddStop,
    handleRemoveStop,
    handleMoveStop,
  };
}
