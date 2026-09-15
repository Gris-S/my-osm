import { Fragment, useEffect, useState, type CSSProperties } from "react";
import { ArrowDown, ArrowUp, Briefcase, Car, ChevronDown, ChevronRight, Footprints, Home, LocateFixed, MapPin, MousePointerClick, Plus, Search, TrainFront, X } from "lucide-react";
import { CONFIG, type TravelMode } from "../config";
import type { LonLat, Place, RouteResult, RouteStop, StopEdit } from "../types";
import { getNextDepartures, type NextDeparture, type TransitJourney, type TransitLeg } from "../services/transit";
import { usePlaceSearch } from "../hooks/usePlaceSearch";
import { HOME_WORK_ROLES, type HomeWork, type HomeWorkRole } from "../hooks/useHomeWork";
// Navigation guidée — voir `src/navigation/README.md`. Le bouton est fourni
// par le module ; le panneau ne décide que du moment où il l'affiche.
import { StartNavigationButton } from "../navigation";
import { formatDistance, formatDuration } from "../utils/format";
import { currentLocale, t, useI18n, type TranslationKey } from "../i18n";
import { useBackClose } from "../hooks/useBackClose";

const MODES: { id: TravelMode; icon: typeof Car; label: TranslationKey }[] = [
  { id: "driving", icon: Car, label: "route.driving" },
  { id: "walking", icon: Footprints, label: "route.walking" },
  { id: "transit", icon: TrainFront, label: "route.transit" },
];

function formatClock(date: Date): string {
  return date.toLocaleTimeString(currentLocale(), { hour: "2-digit", minute: "2-digit" });
}

/** « dans 3 min », ou l'heure quand le départ est plus lointain. */
function formatDeparture(date: Date): string {
  const minutes = Math.round((date.getTime() - Date.now()) / 60000);
  if (minutes <= 0) return t("journey.now");
  if (minutes < 60) return t("journey.inMinutes", { minutes });
  return t("journey.atTime", { time: formatClock(date) });
}

/**
 * Une étape, résumée par sa pastille : le pictogramme du piéton et sa durée
 * pour la marche, la ligne à ses couleurs officielles pour le reste. La suite
 * de ces pastilles suffit à choisir entre deux trajets de durée voisine.
 */
function LegChip({ leg }: { leg: TransitLeg }) {
  const { t } = useI18n();

  if (leg.kind === "walk") {
    return (
      <span
        className="journey-leg is-walk"
        title={t("journey.walkTotal", { minutes: Math.round(leg.durationSeconds / 60) })}
      >
        <Footprints size={13} />
        {Math.round(leg.durationSeconds / 60)}
      </span>
    );
  }
  return (
    <span
      className="line-badge"
      style={{ background: leg.line?.color, color: leg.line?.textColor }}
      title={leg.direction ? t("journey.directionTitle", { direction: leg.direction }) : undefined}
    >
      {leg.line?.label}
    </span>
  );
}

const MINUTES = (seconds: number) => Math.round(seconds / 60);

type DeparturesState =
  | { status: "loading" }
  | { status: "done"; departures: NextDeparture[] }
  | { status: "error" };

/**
 * Les passages suivants de la ligne, au quai où l'on monte : la réponse à
 * « et si je rate celui-là ? ».
 *
 * Ils sont demandés **au dépli seulement** — c'est un appel de plus sur le
 * quota partagé avec les prochains passages.
 */
function NextDepartures({ leg }: { leg: TransitLeg }) {
  const { t } = useI18n();
  const [state, setState] = useState<DeparturesState>({ status: "loading" });
  const lineId = leg.lineId;
  const stopPointId = leg.stopPointId;
  const after = leg.departure;

  // Le composant est monté au dépli et démonté au repli : l'état part de
  // « chargement » sans avoir à le réinitialiser ici.
  useEffect(() => {
    if (!lineId || !stopPointId) return;
    const controller = new AbortController();
    let cancelled = false;
    getNextDepartures(lineId, stopPointId, after, controller.signal)
      .then((departures) => {
        if (!cancelled) setState({ status: "done", departures });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [lineId, stopPointId, after]);

  if (state.status === "loading") return <p className="journey-departures-note">{t("journey.nextLoading")}</p>;
  if (state.status === "error") return <p className="journey-departures-note">{t("journey.nextError")}</p>;
  if (!state.departures.length) return <p className="journey-departures-note">{t("journey.nextNone")}</p>;

  return (
    <ul className="journey-departures">
      {state.departures.map((departure) => (
        <li key={departure.at.toISOString()} className={departure.realtime ? "is-realtime" : ""}>
          {formatClock(departure.at)}
        </li>
      ))}
    </ul>
  );
}

/**
 * Le détail du trajet retenu, minute par minute : où monter, quelle direction
 * prendre, où descendre. C'est ce qu'on garde sous les yeux dans le couloir —
 * le résumé ne sert qu'à choisir.
 *
 * Le trait vertical entre deux étapes reprend la couleur de la ligne qu'on
 * suit, et se pointille pendant la marche, comme le tracé sur la carte.
 */
function JourneyDetail({ journey, stopoverNames }: { journey: TransitJourney; stopoverNames: string[] }) {
  const { t, tp, tParts } = useI18n();
  // Étape dont on a déplié les départs suivants, s'il y en a une : ils coûtent
  // un appel au réseau, ils ne se chargent donc qu'à la demande.
  const [openStops, setOpenStops] = useState<number | null>(null);

  // Où le parcours marque un arrêt voulu, et sous quel nom. Un parcours à
  // étapes est recousu de plusieurs trajets (voir `services/transit.ts`) :
  // sans ce repère, la frise enchaînerait « Descendre à… » puis « Monter à… »
  // sans dire qu'on est arrivé quelque part entre-temps.
  const stopovers = new Map<number, string>();
  (journey.stopoverAfter ?? []).forEach((legIndex, rank) => {
    stopovers.set(legIndex, stopoverNames[rank] ?? t("journey.stepFallback", { index: rank + 1 }));
  });

  /** La ligne d'escale à intercaler après une étape, s'il y en a une. */
  function stopoverRow(index: number, at: Date) {
    const name = stopovers.get(index);
    if (!name) return null;
    return (
      <li className="journey-step is-stopover">
        <span className="journey-step-time">{formatClock(at)}</span>
        <span className="journey-step-mark is-stopover" />
        <div className="journey-step-body">
          <span className="journey-step-title">
            {tParts("journey.stopover")[0]}
            <strong>{name}</strong>
            {tParts("journey.stopover")[1]}
          </span>
        </div>
      </li>
    );
  }

  return (
    <ol className="journey-steps">
      {journey.legs.map((leg, index) =>
        leg.kind === "walk" ? (
          <Fragment key={index}>
            <li className="journey-step is-walk">
              <span className="journey-step-time">{formatClock(leg.departure)}</span>
              <span className="journey-step-mark is-walk">
                <Footprints size={12} />
              </span>
              <div className="journey-step-body">
                {/* Le but de la marche n'est répété que si l'étape suivante ne
                    le nomme pas déjà : « jusqu'à Hôtel de Ville » puis
                    « Monter à Hôtel de Ville » disait deux fois la même chose. */}
                <span className="journey-step-title">
                  {journey.legs[index + 1]?.kind !== "transit" && leg.to
                    ? t("journey.walkTo", { minutes: MINUTES(leg.durationSeconds), to: leg.to })
                    : t("journey.walk", { minutes: MINUTES(leg.durationSeconds) })}
                </span>
              </div>
            </li>
            {stopoverRow(index, leg.arrival)}
          </Fragment>
        ) : (
          <Fragment key={index}>
            <li className="journey-step" style={{ "--step-color": leg.line?.color } as CSSProperties}>
              <span className="journey-step-time">{formatClock(leg.departure)}</span>
              <span className="journey-step-mark is-board" />
              <div className="journey-step-body">
                <span className="journey-step-title">
                  {tParts("journey.board")[0]}
                  <strong>{leg.from}</strong>
                  {tParts("journey.board")[1]}
                </span>
                <span className="journey-step-line">
                  <LegChip leg={leg} />
                  {leg.direction && (
                    <span className="journey-step-direction">{t("journey.direction", { direction: leg.direction })}</span>
                  )}
                </span>
                <span className="journey-step-aside">
                  {leg.stopCount ? `${tp("journey.stops", leg.stopCount)} · ` : ""}
                  {t("format.minutes", { minutes: MINUTES(leg.durationSeconds) })}
                </span>
                {leg.lineId && leg.stopPointId && (
                  <button
                    className="journey-stops-toggle"
                    onClick={() => setOpenStops((current) => (current === index ? null : index))}
                    aria-expanded={openStops === index}
                  >
                    {t("journey.nextDepartures")}
                    <ChevronDown size={13} className={`departure-chevron ${openStops === index ? "is-open" : ""}`} />
                  </button>
                )}
                {openStops === index && <NextDepartures leg={leg} />}
              </div>
            </li>
            <li className="journey-step">
              <span className="journey-step-time">{formatClock(leg.arrival)}</span>
              <span className="journey-step-mark is-alight" style={{ borderColor: leg.line?.color }} />
              <div className="journey-step-body">
                <span className="journey-step-title">
                  {tParts("journey.alight")[0]}
                  <strong>{leg.to}</strong>
                  {tParts("journey.alight")[1]}
                </span>
              </div>
            </li>
            {stopoverRow(index, leg.arrival)}
          </Fragment>
        )
      )}

      <li className="journey-step is-last">
        <span className="journey-step-time">{formatClock(journey.arrival)}</span>
        <span className="journey-step-mark is-dest" />
        <div className="journey-step-body">
          <span className="journey-step-title">{t("journey.arrival")}</span>
        </div>
      </li>
    </ol>
  );
}

/**
 * Un trajet proposé : horaires, durée, et la suite des lignes empruntées.
 *
 * Le trajet retenu est celui que la carte trace, et celui dont le détail se
 * déplie ici : choisir et regarder de plus près sont le même geste.
 */
function JourneyCard({
  journey,
  selected,
  stopoverNames,
  onSelect,
  onStartNavigation,
}: {
  journey: TransitJourney;
  selected: boolean;
  /** Noms des étapes du parcours, dans l'ordre, pour la frise dépliée. */
  stopoverNames: string[];
  onSelect: () => void;
  /** Navigation guidée — voir `src/navigation/README.md`. */
  onStartNavigation: () => void;
}) {
  const { t, tp } = useI18n();
  const first = journey.legs.find((leg) => leg.kind === "transit");

  return (
    <div className={`journey ${selected ? "is-selected" : ""}`}>
      <button className="journey-summary" onClick={onSelect} aria-expanded={selected}>
        <div className="journey-head">
          <span className="journey-duration">{formatDuration(journey.durationSeconds)}</span>
          <span className="journey-times">
            {formatClock(journey.departure)} → {formatClock(journey.arrival)}
          </span>
        </div>

        <div className="journey-legs">
          {journey.legs.map((leg, index) => (
            <span key={index} className="journey-leg-slot">
              {index > 0 && <ChevronRight size={12} className="journey-arrow" />}
              <LegChip leg={leg} />
            </span>
          ))}
        </div>

        <div className="journey-foot">
          {first && <span>{t("journey.departure", { when: formatDeparture(first.departure) })}</span>}
          <span>
            {journey.transfers === 0 ? t("journey.noTransfer") : tp("journey.transfers", journey.transfers)}
          </span>
          {journey.walkingSeconds > 0 && (
            <span>{t("journey.walkTotal", { minutes: MINUTES(journey.walkingSeconds) })}</span>
          )}
        </div>
      </button>

      {/* Le trajet retenu est celui qu'on peut suivre : le bouton se pose donc
          dans son dépli, au même endroit que le geste qui l'a choisi. */}
      {selected && <StartNavigationButton mode="transit" onStart={onStartNavigation} />}
      {selected && <JourneyDetail journey={journey} stopoverNames={stopoverNames} />}
    </div>
  );
}

/**
 * Champ de recherche d'un point du parcours, et ses résultats.
 *
 * Monté seulement pendant l'édition : c'est ce qui fait repartir la recherche
 * de zéro à chaque ouverture, sans avoir à remettre l'état à plat.
 */
function PlacePicker({
  placeholder,
  near,
  withCurrentLocation,
  onPick,
  onUseCurrentLocation,
  onCancel,
  homeWork,
}: {
  placeholder: string;
  near: LonLat;
  /** « Ma position » n'est offerte que si aucun autre point ne l'est déjà. */
  withCurrentLocation: boolean;
  onPick: (place: Place) => void;
  onUseCurrentLocation: () => void;
  onCancel: () => void;
  homeWork: HomeWork;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const { results, loading } = usePlaceSearch(query, near);

  /**
   * Le rôle qu'on est en train de définir, s'il y en a un.
   *
   * Domicile et travail se **définissent là où ils servent**, et non dans un
   * écran de réglages : c'est ici qu'on s'aperçoit qu'ils manquent. Toucher un
   * rôle vide arme donc le champ — le résultat suivant qu'on choisit devient
   * cette adresse, au lieu de remplir l'étape. Un second contact sur le même
   * rôle annule.
   */
  const [assigning, setAssigning] = useState<HomeWorkRole | null>(null);

  /** Les deux raccourcis, dans l'ordre où on les emploie. */
  const shortcuts = HOME_WORK_ROLES.map((role) => ({
    role,
    place: homeWork[role],
    Icon: role === "home" ? Home : Briefcase,
    label: t(role === "home" ? "itinerary.home" : "itinerary.work"),
  }));

  function choose(place: Place) {
    if (assigning) {
      homeWork.set(assigning, place);
      setAssigning(null);
      setQuery("");
      return;
    }
    onPick(place);
  }

  return (
    <div className="itinerary-origin-editor">
      <div className="itinerary-origin-field">
        <Search size={15} />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={assigning ? t("itinerary.rolePlaceholder") : placeholder}
          onKeyDown={(e) => e.key === "Escape" && onCancel()}
        />
        <button onClick={onCancel} aria-label={t("itinerary.cancel")}>
          <X size={14} />
        </button>
      </div>
      <div className="itinerary-origin-results">
        {/* La carte est armée tant que ce champ est ouvert : le dire ici est
            le seul endroit où l'utilisateur regarde à ce moment-là. Ce n'est
            pas un bouton — c'est la carte entière qui répond. */}
        <div className="itinerary-origin-hint is-map">
          <MousePointerClick size={14} />
          {t("itinerary.mapHint")}
        </div>
        {withCurrentLocation && !assigning && (
          <button className="itinerary-origin-result" onClick={onUseCurrentLocation}>
            <LocateFixed size={15} />
            <span className="itinerary-origin-result-name">{t("itinerary.here")}</span>
          </button>
        )}

        {/* Domicile et travail, **empilés au-dessus des résultats** et non côte
            à côte : ce sont deux destinations, pas deux boutons d'une barre
            d'outils, et elles se lisent dans la même colonne que tout ce qu'on
            peut choisir ici.

            Ils s'effacent dès qu'on tape : une fois la recherche commencée,
            c'est elle qu'on veut voir, et deux lignes de raccourcis
            repousseraient les résultats hors de l'écran. */}
        {!query &&
          shortcuts.map(({ role, place, Icon, label }) => (
            <button
              key={role}
              className={`itinerary-origin-result is-shortcut ${assigning === role ? "is-assigning" : ""}`}
              onClick={() => (place && !assigning ? choose(place) : setAssigning(assigning === role ? null : role))}
            >
              <Icon size={15} />
              <span className="itinerary-origin-result-text">
                <span className="itinerary-origin-result-name">{label}</span>
                <span className="itinerary-origin-result-addr">
                  {assigning === role
                    ? t("itinerary.roleAssigning")
                    : (place?.address ?? place?.name ?? t("itinerary.roleUnset"))}
                </span>
              </span>
            </button>
          ))}

        {loading && <div className="itinerary-origin-hint">{t("search.loading")}</div>}
        {!loading &&
          results.map((r) => (
            <button key={r.id} className="itinerary-origin-result" onClick={() => choose(r)}>
              <MapPin size={15} />
              <span className="itinerary-origin-result-text">
                <span className="itinerary-origin-result-name">{r.name}</span>
                {r.address && <span className="itinerary-origin-result-addr">{r.address}</span>}
              </span>
            </button>
          ))}
      </div>
    </div>
  );
}

interface ItineraryPanelProps {
  /** Le parcours entier, dans l'ordre : départ, étapes, arrivée. */
  stops: RouteStop[];
  /** Vers quoi biaiser la recherche d'un point. */
  near: LonLat;
  /** Vrai quand tous les points du parcours ont une position connue. */
  ready: boolean;
  geolocating: boolean;
  /**
   * La question posée, s'il y en a une. Elle est tenue par `App` : elle arme
   * la carte, dont un clic vaut réponse — le panneau ne peut donc pas en être
   * seul dépositaire.
   */
  editing: StopEdit | null;
  onEditingChange: (editing: StopEdit | null) => void;
  mode: TravelMode;
  onModeChange: (mode: TravelMode) => void;
  onPickStop: (index: number, place: Place) => void;
  onUseCurrentLocation: (index: number) => void;
  onAddStop: (place: Place) => void;
  onRemoveStop: (index: number) => void;
  onMoveStop: (index: number, delta: -1 | 1) => void;
  route: RouteResult | null;
  /** Trajets en transports proposés ; `null` tant qu'aucun calcul n'a abouti. */
  journeys: TransitJourney[] | null;
  journeyIndex: number;
  onSelectJourney: (index: number) => void;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  /** Domicile et travail, offerts en tête des résultats de chaque champ. */
  homeWork: HomeWork;
  /**
   * Départ du guidage. Offert **à pied et en transports**, jamais en voiture :
   * elle demanderait des annonces plus tôt, des vitesses limites et une logique
   * de voie. À pied, le bouton est sous le résultat ; en transports, dans le
   * trajet retenu — c'est celui-là qu'on suivra.
   */
  onStartNavigation: () => void;
}

export function ItineraryPanel({
  stops,
  near,
  ready,
  geolocating,
  editing,
  onEditingChange,
  mode,
  onModeChange,
  onPickStop,
  onUseCurrentLocation,
  onAddStop,
  onRemoveStop,
  onMoveStop,
  route,
  journeys,
  journeyIndex,
  onSelectJourney,
  loading,
  error,
  onClose,
  onStartNavigation,
  homeWork,
}: ItineraryPanelProps) {
  // Le geste retour annule d'abord la saisie d'un point, puis ferme le panneau.
  useBackClose(true, onClose);
  useBackClose(editing !== null, () => onEditingChange(null));
  const { t } = useI18n();
  const last = stops.length - 1;
  const stepCount = Math.max(0, stops.length - 2);
  const full = stepCount >= CONFIG.MAX_WAYPOINTS;
  // Un parcours a besoin de deux points : en dessous, il n'y a plus rien à
  // retirer sans le laisser sans arrivée.
  const removable = stops.length > 2;
  // « Ma position » n'est offerte que si aucun point ne l'est déjà : on ne
  // passe pas deux fois par soi-même, et les deux repères se superposeraient.
  const currentTaken = stops.some((stop) => stop.kind === "current");

  function pickPlace(place: Place) {
    if (editing === null) return;
    if (editing === "new") onAddStop(place);
    else onPickStop(editing, place);
    onEditingChange(null);
  }

  function pickCurrent() {
    if (typeof editing !== "number") return;
    onUseCurrentLocation(editing);
    onEditingChange(null);
  }

  /**
   * Une ligne du parcours : sa pastille, son nom, et de quoi le déplacer.
   *
   * Départ, étapes et arrivée partagent la même ligne — c'est ce qui rend le
   * parcours réordonnable d'un bout à l'autre : descendre le départ fait de la
   * première étape le nouveau point de départ.
   *
   * C'est une **fonction de rendu, pas un composant** : déclaré ici, un
   * composant changerait d'identité à chaque rendu et React remonterait la
   * ligne — le champ de recherche perdrait sa saisie à chaque frappe, puisque
   * chercher provoque un rendu.
   */
  function renderStop(index: number, role: "origin" | "step" | "destination") {
    const stop = stops[index];
    const label =
      role === "origin" ? t("itinerary.from") : role === "destination" ? t("itinerary.to") : String(index);
    const placeholder =
      role === "origin"
        ? t("itinerary.originPlaceholder")
        : role === "destination"
          ? t("itinerary.destinationPlaceholder")
          : t("itinerary.stepPlaceholder", { index });

    return (
      <div key={index} className={`itinerary-point is-${role}-row`}>
        <span className={`itinerary-point-dot is-${role}`} />
        {editing === index ? (
          <PlacePicker
              homeWork={homeWork}
            placeholder={placeholder}
            near={near}
            // Le point qu'on modifie peut redevenir « ma position » : c'est
            // ailleurs qu'elle serait en double.
            withCurrentLocation={!currentTaken || stop.kind === "current"}
            onPick={pickPlace}
            onUseCurrentLocation={pickCurrent}
            onCancel={() => onEditingChange(null)}
          />
        ) : (
          <>
            <button className="itinerary-point-label" onClick={() => onEditingChange(index)}>
              <span className="itinerary-point-kind">{label}</span>
              <span className="itinerary-point-value">
                {stop.kind === "current" ? (
                  <>
                    <LocateFixed size={13} />
                    {t("itinerary.here")}
                  </>
                ) : (
                  stop.place.name
                )}
              </span>
            </button>
            <div className="itinerary-step-actions">
              <button onClick={() => onMoveStop(index, -1)} disabled={index === 0} aria-label={t("itinerary.moveUp")}>
                <ArrowUp size={14} />
              </button>
              <button onClick={() => onMoveStop(index, 1)} disabled={index === last} aria-label={t("itinerary.moveDown")}>
                <ArrowDown size={14} />
              </button>
              <button onClick={() => onRemoveStop(index)} disabled={!removable} aria-label={t("itinerary.remove")}>
                <X size={14} />
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="itinerary-panel">
      <button className="itinerary-close" onClick={onClose} aria-label={t("itinerary.close")}>
        <X size={18} />
      </button>

      {/* Le parcours est un seul tableau ordonné, mais ses extrémités restent
          à leur place à l'écran : seules les étapes défilent. Voir où l'on va
          doit rester acquis, y compris avec quinze étapes au milieu. */}
      <div className="itinerary-points">
        {renderStop(0, "origin")}

        {/* Au-delà de `WAYPOINTS_VISIBLE`, la liste cesse de s'allonger et
            défile sur place — sans quoi quinze lignes pousseraient les modes et
            le résultat hors de l'écran. C'est la seule zone défilante imbriquée
            du panneau, et elle ne se dispute pas la molette avec la liste des
            trajets : les deux ne sont jamais ouvertes au même endroit. */}
        {stepCount > 0 && (
          <div className={`itinerary-steps ${stepCount > CONFIG.WAYPOINTS_VISIBLE ? "is-scrolling" : ""}`}>
            {stops.slice(1, last).map((_, offset) => renderStop(offset + 1, "step"))}
          </div>
        )}

        {renderStop(last, "destination")}

        {editing === "new" ? (
          <div className="itinerary-point is-new-row">
            <span className="itinerary-point-dot is-step" />
            <PlacePicker
              homeWork={homeWork}
              placeholder={t("itinerary.addStep")}
              near={near}
              // Une étape ajoutée est un lieu : « ma position » se choisit sur
              // un point existant, où elle a un rang.
              withCurrentLocation={false}
              onPick={pickPlace}
              onUseCurrentLocation={pickCurrent}
              onCancel={() => onEditingChange(null)}
            />
          </div>
        ) : (
          <button className="itinerary-add-step" onClick={() => onEditingChange("new")} disabled={full}>
            <Plus size={15} />
            {full ? t("itinerary.stepsFull", { count: CONFIG.MAX_WAYPOINTS }) : t("itinerary.addStep")}
          </button>
        )}
      </div>

      <div className="itinerary-modes">
        {MODES.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            className={`itinerary-mode ${mode === id ? "is-active" : ""}`}
            onClick={() => onModeChange(id)}
            aria-label={t(label)}
          >
            <Icon size={20} />
          </button>
        ))}
      </div>

      {!ready && !geolocating && (
        <div className="itinerary-status">{t("itinerary.needOrigin")}</div>
      )}
      {(geolocating || (ready && loading)) && <div className="itinerary-status">{t("itinerary.computing")}</div>}
      {ready && error && !loading && <div className="itinerary-status is-error">{error}</div>}
      {ready && !loading && !error && mode === "transit" && journeys && journeys.length === 0 && (
        <div className="itinerary-status">
          {stepCount > 0 ? t("itinerary.noTransitSteps") : t("itinerary.noTransit")}
        </div>
      )}

      {ready && !loading && mode === "transit" && !!journeys?.length && (
        <>
          <div className="itinerary-journeys">
            {journeys.map((journey, index) => (
              <JourneyCard
                key={journey.id}
                journey={journey}
                selected={index === journeyIndex}
                stopoverNames={stops.slice(1, last).map((stop) => (stop.kind === "current" ? t("itinerary.here") : stop.place.name))}
                onSelect={() => onSelectJourney(index)}
                onStartNavigation={onStartNavigation}
              />
            ))}
          </div>
          {/* Le calcul part de l'heure d'appel : les horaires ne se
              rafraîchissent pas tout seuls (quota Île-de-France Mobilités). */}
          <p className="itinerary-note">
            {t("itinerary.transitNote")}
            {/* Avec des étapes, chaque tronçon est calculé séparément et le
                meilleur retenu : il n'y a donc qu'un parcours à montrer, et
                mieux vaut le dire que laisser croire à un choix absent. */}
            {stepCount > 0 && ` ${t("itinerary.singleRoute")}`}
          </p>
        </>
      )}

      {ready && route && !loading && mode !== "transit" && (
        <div className="itinerary-result">
          <span className="itinerary-duration">{formatDuration(route.durationSeconds)}</span>
          {route.distanceMeters !== null && (
            <span className="itinerary-distance">{formatDistance(route.distanceMeters)}</span>
          )}
          {/* Voir `src/navigation/` : la marche et la voiture se guident toutes
              les deux — le bloc entier est déjà réservé aux modes routiers — et
              les transports ont leur propre bouton, dans le trajet retenu. */}
          <StartNavigationButton mode={mode} onStart={onStartNavigation} />
        </div>
      )}
    </div>
  );
}
