import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapView } from "./components/MapView";
import { SearchBar } from "./components/SearchBar";
import { PlaceSheet, type DetailsStatus } from "./components/PlaceSheet";
import { ItineraryPanel } from "./components/ItineraryPanel";
import { FirstRunNotice } from "./components/FirstRunNotice";
import { firstRunSeen } from "./services/firstRun";
import { LocateButton } from "./components/LocateButton";
import { AppMenu } from "./components/AppMenu";
import { MapOptionsMenu } from "./components/MapOptionsMenu";
import { FilterMenu } from "./components/FilterMenu";
import { MapStatus, type PoiStatus } from "./components/MapStatus";
import { WeatherCard } from "./components/WeatherCard";
import { CompassButton } from "./components/CompassButton";
import { BookmarksMenu } from "./components/BookmarksMenu";
import { StreetPhoto } from "./components/StreetPhoto";
import { SavePlaceDialog } from "./components/SavePlaceDialog";
import { BrandBanner } from "./components/BrandBanner";
import { useGeolocation, positionDejaObtenue } from "./hooks/useGeolocation";
import { useTheme } from "./hooks/useTheme";
import { useBasemap } from "./hooks/useBasemap";
import { useMap3D } from "./hooks/useMap3D";
import { useRelief } from "./hooks/useRelief";
import { useMapillary } from "./hooks/useMapillary";
import { useTraffic } from "./hooks/useTraffic";
import { usePlaceFilters } from "./hooks/usePlaceFilters";
import { useBookmarks, type SavedPlace } from "./hooks/useBookmarks";
import { getPlaceDetails, isOsmRef, type PlaceDetails } from "./services/overpass";
import { reverseGeocode } from "./services/geocode";
// Navigation guidée pas à pas — voir `src/navigation/README.md`. Tout tient
// dans ce dossier ; l'application ne fait que l'appeler, lui donner un parcours
// et passer deux valeurs à la carte.
import { CarNavigationPanel, NavigationPanel, TransitNavigationPanel, useCarEta, useCarNavigation, useNavigation, RunButton, RunPanel, useNavDockClearance, useRunModeEnabled, useRunSession, useTransitNavigation } from "./navigation";
import { CONFIG } from "./config";
import type { LonLat, Place, RouteStop } from "./types";
import "./App.css";
import { t } from "./i18n";
import { useHomeWork } from "./hooks/useHomeWork";
import { useFreshnessWatch } from "./hooks/useFreshness";
import { useStreetPhoto } from "./hooks/useStreetPhoto";
import { useBrandSearch } from "./hooks/useBrandSearch";
import { useItinerary } from "./hooks/useItinerary";
import { useIncomingLinks } from "./hooks/useIncomingLinks";
import { useLatest } from "./hooks/useLatest";
import { openWebSearch } from "./services/webSearch";

/** Ce que la carte reçoit à la place des calques pendant la navigation voiture. */
const NOTHING_ON_MAP: never[] = [];

export default function App() {
  const geolocation = useGeolocation();
  // Fraîcheur des zones hors ligne, vérifiée chaque semaine même fenêtre fermée.
  useFreshnessWatch();
  const { theme, setTheme, auto: autoTheme, autoSource, setAutoTheme } = useTheme();
  const { basemap, setBasemap } = useBasemap();
  const { is3D, toggle3D } = useMap3D();
  const { relief, toggleRelief } = useRelief();
  const { mapillary, toggleMapillary } = useMapillary();
  const { traffic, toggleTraffic } = useTraffic();
  const filters = usePlaceFilters();
  const bookmarks = useBookmarks();
  // Le guidage à pied. Il tient sa propre position (un `watchPosition`) et son
  // propre trajet — celui d'OSRM avec les manœuvres — parce qu'il le recalcule
  // quand on s'écarte du parcours.
  const navigation = useNavigation();
  // Le guidage en transports est une session à part : un piéton avance dans
  // l'espace, un voyageur avance dans l'horaire, et sous terre il n'y a pas de
  // position à suivre. Les deux ne sont jamais actives ensemble.
  const transitNav = useTransitNavigation();
  const carNav = useCarNavigation();
  // Le mode course (`src/navigation/running/`) : chronomètre, tracé orange, fiche de fin.
  const run = useRunSession();
  // Le bouton de course peut être masqué depuis la fenêtre « Modes » du menu.
  const runModeEnabled = useRunModeEnabled();
  // Domicile et travail : deux destinations quotidiennes, offertes en tête des
  // champs d'itinéraire (voir `hooks/useHomeWork.ts`).
  const homeWork = useHomeWork();
  // Lieu en cours d'enregistrement : la fenêtre s'ouvre par-dessus la fiche.
  const [placeToSave, setPlaceToSave] = useState<Place | null>(null);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  // Ouverture du menu des calques : son panneau se déploie sur le bouton des
  // catégories, qui s'efface le temps qu'il est ouvert.
  const [mapOptionsOpen, setMapOptionsOpen] = useState(false);

  // Orientation de la carte, arrondie au degré, et demande de remise au nord.
  // Le cap est ici et non dans `MapView` parce que c'est la boussole, posée
  // sous l'encart météo, qui le montre.
  const [mapBearing, setMapBearing] = useState(0);
  const [northRequest, setNorthRequest] = useState<number | null>(null);

  const [poiStatus, setPoiStatus] = useState<PoiStatus>("idle");
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
  // Nombre de contacts répétés sur le lieu ouvert : chaque hausse rafraîchit la fiche.
  const [sheetRefresh, setSheetRefresh] = useState(0);
  // Horaires, téléphone, site, adresse : absents des tuiles, cherchés à
  // l'ouverture d'une fiche et gardés ensuite (voir `services/overpass.ts`).
  // L'état est retenu avec la réponse : une information manquante et une source
  // injoignable ne se disent pas de la même façon dans la fiche.
  const [details, setDetails] = useState<Record<string, DetailsEntry>>({});
  const [flyTarget, setFlyTarget] = useState<(LonLat & { zoom?: number; initial?: boolean }) | null>(null);
  // Photo de rue (`hooks/useStreetPhoto.ts`).
  const { streetPhoto, setStreetPhoto, photoExpanded, setPhotoExpanded, streetPosition, closeStreetPhoto, handlePhotoPosition } = useStreetPhoto(mapillary, setFlyTarget);
  // Recherche d'enseigne (`hooks/useBrandSearch.ts`).
  const { brand, brandPlaces, brandComplete, brandFailed, brandStale, brandLoading, handleViewportChange, runBrandSearch, handleBrandStale, closeBrand } = useBrandSearch();

  // Ligne dont on consulte les horaires : son tracé s'affiche sur la carte.
  const [focusedLine, setFocusedLine] = useState<{ lineId: string; color: string } | null>(null);

  // La même ligne annoncée deux fois ne doit pas passer pour un changement :
  // la carte redessinerait un tracé qui pèse parfois des centaines de
  // kilo-octets.
  const handleLineFocus = useCallback((line: { lineId: string; color: string } | null) => {
    setFocusedLine((current) => (current?.lineId === line?.lineId ? current : line));
  }, []);

  // L'itinéraire (`hooks/useItinerary.ts`) : points, mode, calcul, étapes.
  const {
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
  } = useItinerary(geolocation.position, geolocation.positionAt, geolocation.locate);

  // La durée annoncée **avant** de partir vient du même moteur que celle
  // annoncée **au** départ, dès qu'une clé TomTom permet de connaître le
  // trafic : le panneau promettait 10 min là où l'écran de choix en annonçait
  // 24, pour le même trajet à la même seconde (mesuré sur un Louvre → Bastille
  // de 2,8 km — les deux moteurs s'accordent sur la route vide, tout l'écart
  // était la circulation).
  //
  // Le calcul n'est pas ajouté, il est **avancé** : le départ réutilise ce
  // résultat par le cache de `navigation/car/carEta.ts`, et coûte donc toujours
  // ses trois appels.
  const carEta = useCarEta(routePoints, itineraryOpen && routeMode === "driving" && !carNav.active);

  const detailsRef = useRef(details);
  detailsRef.current = details;

  // Recentrer la carte quand une position est obtenue (bouton "me localiser").
  //
  // À l'ouverture, l'application demande d'elle-même la position, et la
  // première réponse pose la carte dessus — sans animation, au zoom par défaut,
  // et seulement si rien n'a pris la main entre-temps : un lieu ouvert, un
  // itinéraire, un guidage (`startupBusyRef`), ou un geste sur la carte, que
  // `MapView` repère lui-même (`flyTo.initial`). Le relevé GPS peut mettre
  // plusieurs secondes, et la carte ne doit pas partir sous les doigts de
  // quelqu'un qui a déjà commencé. Un refus ou une absence de signal ne dit
  // rien : la carte reste où elle est.
  const startupLocateRef = useRef(true);
  const startupBusyRef = useRef(false);
  const locate = geolocation.locate;
  // **Ne pas déclencher la demande d'autorisation au lancement.** Appeler
  // `locate()` d'emblée faisait surgir la boîte de dialogue d'Android avant que
  // l'utilisateur ait vu la carte ou compris pourquoi on la lui demandait — le
  // plus mauvais moment pour être refusé. On ne se localise donc tout seul que
  // si l'autorisation est **déjà** accordée ; sinon c'est le bouton de position
  // qui la demandera, dans un geste dont le sens est clair.
  //
  // Reste à savoir si l'autorisation est déjà là, et c'est le point délicat :
  // **l'API des permissions ne le dit pas dans l'APK**. Mesurée sur appareil,
  // elle répond « prompt » permission accordée comme retirée — elle décrit
  // l'origine web, pas l'autorisation du paquet. Exiger « granted » revenait
  // donc à supprimer le recentrage d'ouverture pour tout le monde, en silence :
  // permission accordée, position obtenue en 1,9 s au bouton, et la carte
  // restait pourtant au centre par défaut à chaque lancement.
  //
  // On ne se fie donc à cette API que lorsqu'elle tranche vraiment — « denied »
  // interdit, « granted » autorise — et l'on s'en remet sinon au souvenir d'une
  // position déjà obtenue, qui, lui, ne ment pas : elle n'a pu l'être qu'avec
  // l'accord de l'utilisateur.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const status = await navigator.permissions?.query({ name: "geolocation" as PermissionName });
        if (status?.state === "denied") return;
        if (status?.state !== "granted" && !positionDejaObtenue()) return;
      } catch {
        /* API absente : le souvenir d'une position obtenue décide seul */
        if (!positionDejaObtenue()) return;
      }
      if (!cancelled) locate();
    })();
    return () => {
      cancelled = true;
    };
  }, [locate]);

  // Le refus de la position se dit, puis s'efface. Il se dit parce qu'un bouton
  // qui tourne dix secondes sans rien répondre a toutes les apparences d'une
  // panne ; il s'efface parce que la permission peut être accordée dans les
  // réglages du téléphone sans que l'application en soit prévenue, et qu'un
  // bandeau définitif mentirait dès cet instant.
  const clearGeoError = geolocation.clearError;
  useEffect(() => {
    if (!geolocation.error) return;
    const minuteur = setTimeout(clearGeoError, 8000);
    return () => clearTimeout(minuteur);
  }, [geolocation.error, clearGeoError]);

  useEffect(() => {
    if (!geolocation.position) return;
    const initial = startupLocateRef.current;
    startupLocateRef.current = false;
    if (!initial) setFlyTarget({ ...geolocation.position, zoom: 15 });
    else if (!startupBusyRef.current)
      setFlyTarget({ ...geolocation.position, zoom: CONFIG.DEFAULT_ZOOM, initial: true });
  }, [geolocation.position]);

  /**
   * Le bouton de position : sa réponse recentre toujours, démarrage ou pas.
   * C'est aussi lui qui demande l'autorisation, le cas échéant (voir l'effet
   * d'ouverture plus haut).
   *
   * Mémoïsé : il descend jusqu'à un composant protégé par `memo`.
   */
  const handleLocate = useCallback(() => {
    startupLocateRef.current = false;
    locate();
  }, [locate]);

  // Détails du lieu ouvert. La fiche s'affiche immédiatement avec ce que la
  // tuile portait (nom, catégorie) ; les horaires s'y ajoutent dès qu'Overpass
  // a répondu pour ce lieu précis.
  const selectedId = selectedPlace?.id ?? null;
  useEffect(() => {
    if (!selectedId || !isOsmRef(selectedId)) return;
    // Déjà connu, ou déjà en route. Un échec, lui, mérite une nouvelle tentative
    // si l'utilisateur rouvre la fiche.
    const known = detailsRef.current[selectedId];
    if (known && known.status !== "error") return;

    const controller = new AbortController();
    let cancelled = false;
    setDetails((prev) => ({ ...prev, [selectedId]: { status: "loading" } }));
    getPlaceDetails(selectedId, controller.signal)
      .then((result) => {
        if (!cancelled) setDetails((prev) => ({ ...prev, [selectedId]: { status: "done", data: result ?? {} } }));
      })
      .catch(() => {
        // Aucune source n'a répondu : la fiche reste utilisable, et le dit.
        if (!cancelled) setDetails((prev) => ({ ...prev, [selectedId]: { status: "error" } }));
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [selectedId]);

  // Clic sur la carte hors d'un commerce : on nomme l'endroit par l'adresse la
  // plus proche, mais on garde **les coordonnées cliquées** — c'est ce point-là
  // que le marqueur montre et que le bouton « Partager » recopie, pas le
  // centroïde de l'adresse trouvée à quelques dizaines de mètres.
  //
  // La fiche s'ouvre donc partout ; c'est elle qui décide de ce qu'elle montre,
  // et un point sans catégorie n'a pas d'encart d'horaires (voir `PlaceSheet`).
  async function placeAtPoint(lonlat: LonLat): Promise<Place> {
    const nearby = await reverseGeocode(lonlat.lon, lonlat.lat);
    return {
      // L'identifiant reste celui de l'objet OSM quand le géocodage en trouve
      // un : c'est lui qui donne accès aux horaires du lieu.
      id: nearby?.id ?? `pin/${lonlat.lon},${lonlat.lat}`,
      name: nearby?.name ?? t("place.picked"),
      group: null,
      address: nearby?.address,
      ...lonlat,
    };
  }

  async function handleBackgroundClick(lonlat: LonLat) {
    const place = await placeAtPoint(lonlat);
    // Une question ouverte attend une réponse : le clic la donne, au lieu
    // d'ouvrir une fiche.
    if (answerStopPicker(place)) return;
    setSelectedPlace(place);
  }

  /**
   * La même chose, mais **stable d'un rendu à l'autre** : `MapView` est
   * protégée par `memo`, et une fonction recréée à chaque rendu l'annulerait
   * sans rien dire. Le corps est relu dans une ref (`useLatest`), si bien que
   * cette version appelle toujours la dernière — elle ferme sur l'état courant,
   * pas sur celui du premier rendu.
   */
  const backgroundClickRef = useLatest(handleBackgroundClick);
  const handleMapBackgroundClick = useCallback(
    (lonlat: LonLat) => void backgroundClickRef.current(lonlat),
    [backgroundClickRef]
  );

  /** Un signet rouvre son lieu : la carte s'y rend et la fiche s'ouvre. */
  function handleOpenSaved(saved: SavedPlace) {
    handleSelectFromSearchOrMap({
      id: saved.id,
      name: saved.name,
      group: saved.group,
      address: saved.address,
      lon: saved.lon,
      lat: saved.lat,
    });
  }

  function handleSelectFromSearchOrMap(place: Place) {
    // Pendant qu'une question est posée, cliquer un commerce y répond : c'est
    // souvent lui qu'on visait — « chez le boulanger » vaut mieux que
    // l'adresse du trottoir d'en face.
    if (answerStopPicker(place)) return;
    // Choisir un lieu, c'est passer à autre chose : la sélection d'enseigne
    // n'a plus lieu d'être et la carte revient à ses catégories.
    closeBrand();
    // Toucher de nouveau le lieu déjà ouvert rafraîchit ce qui a une fraîcheur :
    // les prochains passages d'un arrêt (voir `TransitDepartures`).
    if (selectedPlace?.id === place.id) setSheetRefresh((count) => count + 1);
    setSelectedPlace(place);
    setFlyTarget({ lon: place.lon, lat: place.lat, zoom: 16 });
  }

  /** Vrai pendant un guidage, à pied, en voiture comme en transports. */
  const guiding = navigation.active || carNav.active || transitNav.active || run.active;
  startupBusyRef.current = selectedPlace !== null || stops.length > 0 || guiding;

  /**
   * Vrai pendant le **choix** d'un itinéraire voiture, avant tout guidage.
   *
   * Il compte séparément parce que l'écran n'est pas le même : le choix se fait
   * sur la carte, qui doit rester entière et manipulable, et il n'y a pas encore
   * de bandeau de manœuvre en haut — la mise en page qui descend les menus sous
   * ce bandeau n'a donc rien à décaler (voir `src/navigation/`).
   */
  const choosingRoute = carNav.status === "choosing";

  /**
   * Vrai pendant un guidage **voiture**, une fois l'itinéraire retenu.
   *
   * Il efface toute la colonne de droite — météo, boussole, signets,
   * catégories, calques, bouton de position. C'est une exception assumée à la
   * règle du guidage piéton, qui garde ses menus : changer de fond de carte ou
   * rouvrir un signet en marchant est un geste ordinaire, au volant c'en est un
   * qu'on ne fait pas. Le bord droit est aussi le côté vers lequel le regard
   * part le moins volontiers en conduisant à droite ; ce qui compte — la
   * manœuvre, la vitesse, l'heure d'arrivée — occupe le haut, la gauche et le
   * bas. Le burger reste, à gauche : il ne coûte rien et il porte les réglages
   * du guidage lui-même.
   */
  const carGuiding = carNav.active && !choosingRoute;
  /** Le panneau d'itinéraire des transports, qui prend toute la hauteur. */
  const transitPanelOpen = itineraryOpen && !guiding && routeMode === "transit";

  function handleStartItinerary() {
    if (!selectedPlace) return;
    handleRouteTo(selectedPlace);
  }

  /**
   * L'itinéraire depuis la position actuelle jusqu'à un lieu : le bouton de la
   * fiche, et les raccourcis Domicile et Travail de la barre de recherche.
   */
  function handleRouteTo(place: Place) {
    setStops([{ kind: "current" }, { kind: "place", place }]);
    setSelectedPlace(null);
    // La position est redemandée par `useItinerary` si elle n'est pas fraîche.
  }

  // Un lien de position ouvert depuis une autre application — « Itinéraire »
  // d'un site, adresse d'un message, texte partagé (voir `useIncomingLinks`).
  useIncomingLinks({
    onPlace: (place) => handleSelectFromSearchOrMap(place),
    onRoute: (place) => handleRouteTo(place),
    onUnresolved: (text) => openWebSearch(text, (place) => handleSelectFromSearchOrMap(place)),
  });

  /**
   * Démarre le guidage sur le parcours en cours. Il reçoit **le parcours
   * entier**, étapes comprises : les moteurs routiers les enchaînent en un
   * appel, et un recalcul repartira de celles qui restent (voir
   * `src/navigation/`).
   */
  function handleStartNavigation() {
    // En transports, c'est le trajet retenu qu'on suit — il porte ses horaires,
    // ses lignes et ses correspondances ; il n'y a pas de tracé à recalculer.
    if (routeMode === "transit") {
      if (selectedJourney) transitNav.start(selectedJourney);
      return;
    }
    if (!routePoints) return;
    // En voiture, « Démarrer » n'ouvre pas le guidage mais le **choix** de
    // l'itinéraire : sans péage, le plus rapide, ou moins cher. C'est la
    // fenêtre de choix qui lancera ensuite le parcours retenu.
    if (routeMode === "driving") {
      carNav.choose(routePoints, { to: stopName(stops[stops.length - 1]) });
      return;
    }
    // Les deux extrémités sont nommées : ce sont elles qui titrent le trajet
    // dans l'historique, longtemps après que le parcours a disparu.
    navigation.start(routePoints, { from: stopName(stops[0]), to: stopName(stops[stops.length - 1]) });
  }

  // Hauteur libérée sous la colonne de boutons de droite. Pendant le guidage,
  // elle passe au-dessus de la barre de route repliée ; la fiche d'un lieu,
  // plus haute, l'emporte quand les deux sont ouvertes.
  // Hauteur réellement occupée par la fiche d'un lieu, publiée par elle. Le
  // décalage des boutons flottants s'y règle au lieu d'être écrit à la main :
  // une fiche porte tantôt une adresse seule, tantôt des horaires et des
  // prochains passages, et aucun nombre fixe ne couvre les deux (la moitié des
  // boutons passait dessous sur téléphone).
  const [sheetHeight, setSheetHeight] = useState(0);
  // La dernière panne signalée par MapLibre. Elle est **affichée**, et non
  // seulement journalisée : sur un téléphone il n'y a pas de console, et une
  // carte grise sans explication est indiagnosticable.
  const [mapError, setMapError] = useState<string | null>(null);

  // La fenêtre d'accueil, au tout premier lancement. Le stockage n'est lu
  // **qu'une fois**, à l'initialisation : la relire à chaque rendu la ferait
  // disparaître au moment même où elle s'enregistre comme vue.
  const [firstRunOpen, setFirstRunOpen] = useState(() => !firstRunSeen());
  // Voir `AppMenuProps.openApiSignal` : un compteur, pas un booléen.
  const [openApiSignal, setOpenApiSignal] = useState(0);
  // Les crédits des sources de carte. Ils ne barrent plus le bas de l'écran :
  // ils vivent au bas du menu principal, et suivent les calques allumés.
  const [credits, setCredits] = useState<string[]>([]);

  // La hauteur réellement disponible. `visualViewport` la rend amputée du
  // clavier, ce que `innerHeight` ne fait pas sur Android : c'est précisément
  // la différence qui faisait déborder la colonne de boutons.
  const [viewportHeight, setViewportHeight] = useState(() =>
    typeof window === "undefined" ? 800 : (window.visualViewport?.height ?? window.innerHeight)
  );
  useEffect(() => {
    const view = window.visualViewport;
    const update = () => setViewportHeight(view?.height ?? window.innerHeight);
    view?.addEventListener("resize", update);
    window.addEventListener("resize", update);
    return () => {
      view?.removeEventListener("resize", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  /**
   * Vrai tant que la barre de recherche est ouverte — champ au premier plan,
   * suggestions à l'écran, clavier déployé.
   */
  const [searching, setSearching] = useState(false);

  /**
   * Décalage des boutons flottants du bord droit.
   *
   * Il suit la hauteur de la fiche, **mais sous plafond**. Sans ce plafond, une
   * fiche haute — ou simplement un clavier ouvert, qui ampute l'écran de
   * moitié — poussait les boutons au-delà du bord supérieur : ils s'empilaient
   * alors les uns sur les autres, par-dessus la barre d'état et l'encart météo
   * (constaté sur appareil). La colonne occupe environ 230 px au-dessus de ce
   * décalage, et il faut laisser la barre de recherche respirer : d'où la
   * réserve de 360 px.
   */
  const ceiling = Math.max(24, viewportHeight - 360);
  // Pendant une navigation, la colonne de droite se range au-dessus de ce que
  // la colonne du bas occupe **réellement** — barre, et encart de musique quand
  // il est là — mesuré par le module (`useNavDockClearance`). Le 96 d'avant
  // n'est plus qu'un repli, le temps de la première mesure.
  const navDockClearance = useNavDockClearance();
  const locateButtonOffset = sheetHeight
    ? Math.min(sheetHeight + 16, ceiling)
    : guiding
      ? navDockClearance
        ? navDockClearance + 12
        : 96
      : 24;

  // Lieu dont l'encart donne la météo : celui qu'on vient de chercher ou
  // d'ouvrir, sinon la position de l'utilisateur. À défaut des deux — la
  // géolocalisation n'est demandée qu'au bouton — le centre par défaut, dont
  // l'encart donne le nom pour lever l'ambiguïté.
  // Mémorisé : l'encart météo et le menu sont protégés contre les rendus inutiles
  // (`memo`), et un nouvel objet à chaque rendu les redessinerait quand même.
  const weatherCoords: LonLat = useMemo(
    () =>
      selectedPlace
        ? { lon: selectedPlace.lon, lat: selectedPlace.lat }
        : (geolocation.position ?? CONFIG.DEFAULT_CENTER),
    [selectedPlace, geolocation.position]
  );
  const requestNorth = useCallback(() => setNorthRequest(Date.now()), []);
  // Stable d'un rendu à l'autre, pour que le menu des signets (`memo`) ne se
  // redessine pas à chaque relevé GPS.
  const handleOpenSavedRef = useRef(handleOpenSaved);
  handleOpenSavedRef.current = handleOpenSaved;
  const openSaved = useCallback((saved: SavedPlace) => handleOpenSavedRef.current(saved), []);

  // Vers quoi biaiser la recherche d'un point du parcours : l'arrivée quand on
  // la connaît — chercher « gare » en modifiant un trajet pour Lille ne doit
  // pas rendre celle de Paris — sinon le lieu observé.
  const lastPoint = routePoints ? routePoints[routePoints.length - 1] : null;
  const searchNear: LonLat = lastPoint ?? weatherCoords;

  // Un résultat de recherche porte déjà une adresse : les champs rapportés
  // complètent la fiche sans effacer ce qu'on en savait.
  //
  // Le lieu enrichi est mémorisé : le reconstruire à chaque rendu en changeait
  // l'identité, ce qui relançait la recherche des prochains passages de la
  // fiche — et refermait au passage la ligne qu'on venait de déplier.
  const sheetEntry = selectedPlace ? details[selectedPlace.id] : undefined;
  const sheetPlace = useMemo(
    () => (selectedPlace ? withDetails(selectedPlace, sheetEntry?.data) : null),
    [selectedPlace, sheetEntry]
  );
  const savedEntry = bookmarks.findSaved(selectedPlace?.id);
  const sheetStatus: DetailsStatus = !selectedPlace
    ? "none"
    : !isOsmRef(selectedPlace.id)
      ? "none" // un point posé sur la carte n'a pas d'objet OSM à interroger
      : (sheetEntry?.status ?? "loading");

  return (
    // Tant qu'une question est posée, la carte est armée : le curseur le dit,
    // et le clic répond au lieu d'ouvrir une fiche.
    <div
      className={`app-shell ${editingStop !== null ? "is-picking" : ""} ${
        guiding && !choosingRoute ? "is-navigating" : ""
      } ${sheetPlace && !photoExpanded && !searching ? "has-sheet" : ""} ${searching ? "is-searching" : ""} ${run.active ? "is-running" : ""}`}
    >
      {/* **Pendant la navigation voiture, aucun calque** (demande explicite) :
          ni POI (commerces, parkings, transports…), ni signets, ni relief,
          Mapillary, trafic du calque ou ligne surlignée. Restent le fond de
          carte, l'itinéraire, son trafic et ses incidents. Les réglages ne
          changent pas : tout revient à l'arrêt, et l'écran de choix garde les
          calques — on y regarde la carte. */}
      <MapView
        groups={carGuiding ? NOTHING_ON_MAP : filters.selected}
        focusedLine={carGuiding ? null : focusedLine}
        brandPlaces={carGuiding ? null : brandPlaces}
        onBrandStale={handleBrandStale}
        onViewportChange={handleViewportChange}
        savedPlaces={carGuiding ? NOTHING_ON_MAP : bookmarks.visiblePlaces}
        onSelectSaved={handleOpenSaved}
        selectedPlace={selectedPlace}
        // Pendant le guidage, la flèche orientée remplace le point de position :
        // c'est la direction de marche qui compte, et deux repères superposés
        // au même endroit ne diraient rien de plus.
        userLocation={navigation.active || carNav.active || run.active ? null : geolocation.position}
        routeStops={stopMarkers}
        picking={editingStop !== null}
        // Le trajet guidé prime : il peut avoir été recalculé en route, et
        // c'est celui-là qu'on suit. **Pendant le choix d'un trajet voiture,
        // rien d'autre que les propositions** : `carNav.mapRoute` y est nul, et
        // retomber sur l'itinéraire du panneau — calculé par OSRM, pas par
        // TomTom — superposait deux parcours différents du même bleu, qui
        // semblaient n'en faire qu'un, fourchu (constaté sur une capture).
        // Et, en voiture, c'est **le tracé de TomTom** qui est dessiné dès
        // qu'on l'a : sur le même Louvre → Bastille, OSRM proposait 3,87 km
        // quand TomTom en prenait 2,76 — deux routes différentes, pas deux
        // estimations de la même. Montrer l'une en annonçant la durée de
        // l'autre était l'incohérence la plus gênante des deux.
        route={navigation.mapRoute ?? carNav.mapRoute ?? (carNav.active ? null : (carEta?.result ?? route))}
        navigation={navigation.map ?? carNav.map ?? transitNav.map ?? run.map}
        onNavigationPan={carNav.active ? carNav.notifyPan : run.active ? run.notifyPan : navigation.notifyPan}
        theme={theme}
        basemap={basemap}
        is3D={is3D}
        relief={relief && !carGuiding}
        mapillary={mapillary && !carGuiding}
        traffic={traffic && !carGuiding}
        streetPosition={carGuiding ? null : streetPosition}
        onSelectStreetPhoto={setStreetPhoto}
        flyTo={flyTarget}
        northRequest={northRequest}
        onBearingChange={setMapBearing}
        onSelectPlace={handleSelectFromSearchOrMap}
        onPoiStatusChange={setPoiStatus}
        onMapError={setMapError}
        onAttributionChange={setCredits}
        onBackgroundClick={handleMapBackgroundClick}
      />

      {/* À pied et en transports, l'itinéraire est ouvert mais les menus restent :
          changer de fond de carte ou rouvrir un signet en marchant ne doit pas
          demander d'arrêter la navigation. La feuille de style les fait
          descendre sous le bandeau de manœuvre (`.is-navigating`).

          **En voiture, non** : toute la colonne de droite s'efface une fois
          l'itinéraire retenu (`carGuiding`). On ne règle pas des calques au
          volant, et l'écran doit se lire d'un regard. */}
      {(!itineraryOpen || guiding) && !photoExpanded && !carGuiding && (
        <>
          {/* La colonne du haut à droite : l'encart météo, puis la boussole.
              Ils sont empilés plutôt que posés chacun de son côté — la boussole
              doit rester sous la météo, y compris quand celle-ci se déplie et
              pousse tout vers le bas.

              Rien de tout cela pendant un trajet : le panneau d'itinéraire
              occupe déjà le haut de l'écran, et sur un téléphone son bouton de
              fermeture se trouve exactement là. L'heure d'arrivée prime sur le
              ciel comme sur le cap. */}
          {/* La colonne de droite s'efface pendant une recherche — et elle
              seule : la barre de recherche vit dans ce même bloc, la masquer
              avec le reste la ferait disparaître au moment où l'on tape
              dedans. */}
          {!searching && (
          <div className="map-dock">
            <WeatherCard coords={weatherCoords} placeName={selectedPlace?.name ?? null} />
            <CompassButton bearing={mapBearing} onClick={requestNorth} />
          </div>
          )}

          <AppMenu
            theme={theme}
            center={weatherCoords}
            credits={credits}
            auto={autoTheme}
            autoSource={autoSource}
            onThemeChange={setTheme}
            onAutoTheme={setAutoTheme}
            openApiSignal={openApiSignal}
          />

          {/* Les signets et les catégories **restent pendant une recherche
              d'enseigne** (demande explicite) : les effacer faisait disparaître
              la moitié des boutons au moment où l'on explore la carte. Ils ne
              s'effacent que pendant la saisie, quand le clavier ampute l'écran. */}
          {!searching && (
            <BookmarksMenu
              bookmarks={bookmarks}
              onOpenPlace={openSaved}
              offsetBottom={locateButtonOffset + 168}
              covered={mapOptionsOpen || filterMenuOpen}
            />
          )}
          {!searching && (
            <FilterMenu
              open={filterMenuOpen}
              onOpenChange={setFilterMenuOpen}
              state={filters.state}
              isSelected={filters.isSelected}
              onToggle={filters.toggle}
              onToggleAll={filters.toggleAll}
              selectedCount={filters.selected.length}
              offsetBottom={locateButtonOffset + 112}
              covered={mapOptionsOpen}
            />
          )}

          {/* La barre de recherche est le seul élément qui ne revienne pas
              pendant le guidage : elle occupe exactement la ligne du bandeau de
              manœuvre, et chercher une adresse en marchant, c'est refaire un
              itinéraire — ce qui se fait après avoir terminé.

              Le bandeau d'enseigne se range **sous** la barre et ses résultats :
              posé par-dessus, il masquait les suggestions dès qu'on recommençait
              à taper. */}
          {!guiding && (
            <SearchBar
              onSelectPlace={handleSelectFromSearchOrMap}
              homeWork={homeWork}
              onRouteTo={handleRouteTo}
              onSearchBrand={runBrandSearch}
              onOpenChange={setSearching}
              near={weatherCoords}
              // Vider la barre quitte la recherche d'enseigne et son bandeau.
              onClear={closeBrand}
            >
              {brand && (
                <BrandBanner
                  brand={brand}
                  count={brandPlaces?.length ?? 0}
                  complete={brandComplete}
                  loading={brandLoading}
                  failed={brandFailed}
                  stale={brandStale}
                  onSearchHere={() => runBrandSearch(brand)}
                />
              )}
            </SearchBar>
          )}
        </>
      )}

      {itineraryOpen && !photoExpanded && !guiding && (
        <ItineraryPanel
          stops={stops}
          near={searchNear}
          ready={!!routePoints}
          geolocating={awaitingLocation && geolocation.loading}
          mode={routeMode}
          onModeChange={setRouteMode}
          editing={editingStop}
          onEditingChange={setEditingStop}
          onPickStop={handlePickStop}
          onUseCurrentLocation={handleUseCurrentLocation}
          onAddStop={handleAddStop}
          onRemoveStop={handleRemoveStop}
          onMoveStop={handleMoveStop}
          route={route}
          liveEta={carEta && { durationSeconds: carEta.durationSeconds, distanceMeters: carEta.distanceMeters }}
          journeys={journeys}
          journeyIndex={journeyIndex}
          onSelectJourney={setJourneyIndex}
          loading={routeLoading}
          error={routeError}
          onClose={handleCloseItinerary}
          onStartNavigation={handleStartNavigation}
          homeWork={homeWork}
        />
      )}

      {/* Le guidage occupe le haut et le bas de l'écran : entre les deux, la
          carte reste entière. Tout le reste de l'interface s'efface — on suit
          une rue, on ne règle pas des calques. */}
      <NavigationPanel session={navigation} />
      <CarNavigationPanel session={carNav} />
      <TransitNavigationPanel session={transitNav} />
      <RunPanel session={run} />

      {/* Le bouton de course, sous le burger : seulement quand rien d'autre
          n'occupe l'écran — ni navigation, ni itinéraire, ni saisie. Il reste
          pendant une recherche d'enseigne : la pastille de celle-ci est bornée
          en largeur pour ne jamais passer dessous (`brand-search.css`). */}
      {runModeEnabled && !guiding && !itineraryOpen && !photoExpanded && !searching && (
        <RunButton
          onStart={() => {
            setSelectedPlace(null);
            run.start();
          }}
        />
      )}

      {!photoExpanded && !guiding && (
        <MapStatus
          // L'état des catégories ne concerne que la carte qu'on explore : sur
          // un itinéraire ou un guidage, « aucune catégorie » se posait sur le
          // panneau sans rien lui apprendre.
          status={brand || itineraryOpen || guiding ? "idle" : poiStatus}
          mapError={mapError}
          locationError={geolocation.error}
          // Au-dessus de la fiche ou de la colonne du guidage, comme les
          // boutons de droite : posé en bas, il passait sous la fiche d'une
          // gare, et le message ne se voyait plus.
          offsetBottom={locateButtonOffset}
        />
      )}

      {/* Pas de bouton de position pendant un guidage voiture : la barre de
          route porte déjà son « Recentrer », et deux boutons qui ramènent au
          même endroit sur le même bord ne font qu'encombrer. */}
      {/* Ni position ni calques sur le panneau des transports : il occupe toute
          la hauteur, et les deux boutons se posaient sur le détail du trajet.
          En voiture et à pied, le panneau est court et les laisse libres. */}
      {!photoExpanded && !carGuiding && !searching && !transitPanelOpen && (
        <LocateButton onClick={handleLocate} loading={geolocation.loading} offsetBottom={locateButtonOffset} />
      )}

      {!photoExpanded && !carGuiding && !searching && !transitPanelOpen && (
      <MapOptionsMenu
        open={mapOptionsOpen}
        onOpenChange={setMapOptionsOpen}
        basemap={basemap}
        onBasemapChange={setBasemap}
        is3D={is3D}
        relief={relief}
        onToggleRelief={toggleRelief}
        onToggle3D={toggle3D}
        mapillary={mapillary}
        onToggleMapillary={toggleMapillary}
        traffic={traffic}
        onToggleTraffic={toggleTraffic}
        offsetBottom={locateButtonOffset + 56}
      />
      )}

      {/* La fiche s'efface aussi pendant une recherche. Elle occupe la moitié
          basse de l'écran et recouvrait la liste des résultats : on n'en voyait
          qu'un seul, sous le clavier. Elle n'est pas fermée pour autant — le
          lieu reste sélectionné, et refermer la recherche la ramène. */}
      {sheetPlace && !photoExpanded && !searching && (
        <PlaceSheet
          place={sheetPlace}
          detailsStatus={sheetStatus}
          onLineFocus={handleLineFocus}
          refreshToken={sheetRefresh}
          onClose={() => setSelectedPlace(null)}
          onStartItinerary={handleStartItinerary}
          savedIn={savedEntry ? { name: savedEntry.folder.name, color: savedEntry.folder.color } : null}
          onSave={() => setPlaceToSave(sheetPlace)}
          onUnsave={() => bookmarks.removePlace(sheetPlace.id)}
          onHeightChange={setSheetHeight}
        />
      )}
      {streetPhoto && (
        <StreetPhoto
          photo={streetPhoto}
          expanded={photoExpanded}
          onToggleExpanded={() => setPhotoExpanded((prev) => !prev)}
          onPosition={handlePhotoPosition}
          onClose={closeStreetPhoto}
        />
      )}

      {placeToSave && (
        <SavePlaceDialog place={placeToSave} bookmarks={bookmarks} onClose={() => setPlaceToSave(null)} />
      )}

      {/* La fenêtre d'accueil vit **hors** des conditions d'affichage de la
          carte : elle doit se montrer au premier lancement quoi que
          l'application ait par ailleurs à l'écran, et elle se pose sur le voile
          commun, comme les autres fenêtres. */}
      {firstRunOpen && (
        <FirstRunNotice
          onClose={() => setFirstRunOpen(false)}
          onAddKey={() => setOpenApiSignal((count) => count + 1)}
        />
      )}
    </div>
  );
}

/**
 * Le nom d'un point du parcours pour un historique, ou `null` quand il n'en a
 * pas : « ma position » est un rôle, pas un lieu, et le guidage lui trouvera
 * son adresse par géocodage inverse. Relu six mois plus tard, « Ma position »
 * ne dirait rien.
 */
function stopName(stop: RouteStop | undefined): string | null {
  if (!stop) return null;
  return stop.kind === "current" ? null : stop.place.name;
}

/** Ce qu'on sait des détails d'un lieu, et si la recherche a abouti. */
interface DetailsEntry {
  status: "loading" | "done" | "error";
  data?: PlaceDetails;
}

/** Complète un lieu avec les champs rapportés par la source, s'il y en a. */
function withDetails(place: Place, details: PlaceDetails | undefined): Place {
  if (!details) return place;
  return {
    ...place,
    address: details.address ?? place.address,
    openingHours: details.openingHours ?? place.openingHours,
    phone: details.phone ?? place.phone,
    website: details.website ?? place.website,
  };
}
