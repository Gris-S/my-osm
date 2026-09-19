import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Footprints,
  Gauge,
  LoaderCircle,
  Route,
  Share2,
  Timer,
  Trash2,
  X,
} from "lucide-react";
import type { Map as MLMap } from "maplibre-gl";
import { formatDistance, formatDuration } from "../utils/format";
import { useTheme, type Theme } from "../hooks/useTheme";
import { ElevationProfile } from "./ElevationProfile";
import { deleteTrips, listTrips, purgeTrips, type Trip } from "./history";
import { historyRetention } from "./settings";
import { TripMap } from "./TripMap";
import { imageFileName, shareImage } from "./tripShare";
import { drawTripCard } from "./tripCard";
import {
  averageSpeed,
  deltaText,
  formatPace,
  formatSpeed,
  pace,
  routeLabel,
  stepsOrigin,
  tripDate,
  tripListTitle,
} from "./trip";
import { useNav } from "./strings";
import { PaceChart } from "./running/PaceChart";
import { RunFigures } from "./running/RunFigures";
import { RUN_COLOR } from "./running/run";
import { useBackClose } from "../hooks/useBackClose";

// ---------------------------------------------------------------------------
// L'historique des trajets à pied, ouvert depuis le menu principal.
//
// Même forme que la fenêtre des paramètres : une fenêtre au centre, sur un
// voile. Chaque ligne dit la date courte et l'heure du départ, puis la durée et
// la distance (demande explicite), en blanc pour une marche et en orange pour
// une course. Elle se déplie sur son détail : les chiffres, le tracé sur une
// carte, le dénivelé, puis les deux actions qui le concernent.
//
// **Un trajet déplié est seul à l'écran** (demande explicite) : les lignes
// voisines disparaissent, et deux flèches au bas du détail passent au trajet
// précédent ou suivant dans l'ordre de la liste. Toucher sa ligne le replie et
// rend la liste entière.
//
// **Partager et supprimer sont au bas du détail, et nulle part ailleurs.** Il
// n'y a donc ni mode sélection ni actions groupées : on agit sur le trajet
// qu'on est en train de regarder, ce qui rend impossible de partager ou
// d'effacer le mauvais.
// ---------------------------------------------------------------------------

type State =
  | { status: "loading" }
  | { status: "ready"; trips: Trip[] }
  | { status: "error" };

export function HistoryPanel({ onClose }: { onClose: () => void }) {
  const { nav, locale } = useNav();
  const { theme } = useTheme();
  const [state, setState] = useState<State>({ status: "loading" });
  const [openId, setOpenId] = useState<string | null>(null);
  // Le geste retour replie le trajet déplié, puis ferme l'historique.
  useBackClose(true, onClose);
  useBackClose(openId !== null, () => setOpenId(null));
  const dialogRef = useRef<HTMLDivElement>(null);

  const disabled = historyRetention() === "off";

  const reload = useCallback(() => {
    // La purge d'abord : l'ouverture de l'historique est le moment où le
    // réglage de conservation s'applique (l'application n'a pas de tâche de
    // fond, voir `history.ts`).
    purgeTrips()
      .catch(() => 0)
      .then(() => listTrips())
      .then((trips) => setState({ status: "ready", trips }))
      .catch(() => setState({ status: "error" }));
  }, []);

  useEffect(reload, [reload]);

  const trips = useMemo(() => (state.status === "ready" ? state.trips : []), [state]);
  const openIndex = trips.findIndex((trip) => trip.id === openId);
  // Déplié, le trajet est seul : ses voisins s'atteignent par les flèches.
  const shown = openIndex >= 0 ? [trips[openIndex]] : trips;

  /** Passe au trajet voisin dans l'ordre de la liste, s'il existe. */
  const step = useCallback(
    (offset: -1 | 1) => {
      const next = trips[openIndex + offset];
      if (openIndex < 0 || !next) return;
      setOpenId(next.id);
      // Le détail précédent a pu être lu jusqu'en bas : le suivant se lit du haut.
      dialogRef.current?.scrollTo({ top: 0 });
    },
    [trips, openIndex]
  );

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, step]);

  const remove = useCallback(
    async (id: string) => {
      await deleteTrips([id]);
      setOpenId(null);
      reload();
    },
    [reload]
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className={`settings-dialog history-dialog ${openIndex >= 0 ? "is-reading" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-head">
          <h2 className="settings-title" id="history-title">
            {nav("history.title")}
          </h2>
          <button className="settings-close" onClick={onClose} aria-label={nav("trip.close")}>
            <X size={18} />
          </button>
        </div>

        {state.status === "loading" && (
          <p className="history-empty">
            <LoaderCircle size={14} className="nav-spin" />
            {nav("history.loading")}
          </p>
        )}
        {state.status === "error" && <p className="history-empty">{nav("history.empty")}</p>}
        {state.status === "ready" && !trips.length && (
          <p className="history-empty">{disabled ? nav("history.disabled") : nav("history.empty")}</p>
        )}

        <ul className="history-list">
          {shown.map((trip) => (
            <li key={trip.id} className={`history-item ${openId === trip.id ? "is-open" : ""}`}>
              <button
                className="history-item-button"
                onClick={() => setOpenId((id) => (id === trip.id ? null : trip.id))}
                aria-expanded={openId === trip.id}
              >
                <span className="history-item-text">
                  <span className={`history-item-name ${trip.kind === "run" ? "is-run" : ""}`}>
                    {tripListTitle(trip, locale)}
                  </span>
                  <span className="history-item-meta">
                    {formatDuration(trip.elapsedSeconds)} · {formatDistance(trip.distanceMeters)}
                  </span>
                </span>
                <ChevronDown
                  size={16}
                  className={`nav-chevron ${openId === trip.id ? "is-open" : ""}`}
                />
              </button>

              {openId === trip.id && (
                <>
                  <TripDetail trip={trip} theme={theme} onDelete={() => remove(trip.id)} />
                  <div className="history-stepper">
                    <button
                      className="history-step"
                      onClick={() => step(-1)}
                      disabled={openIndex <= 0}
                      aria-label={nav("history.previous")}
                    >
                      <ChevronLeft size={20} />
                    </button>
                    <span className="history-step-position">
                      {nav("history.position", { index: String(openIndex + 1), total: String(trips.length) })}
                    </span>
                    <button
                      className="history-step"
                      onClick={() => step(1)}
                      disabled={openIndex >= trips.length - 1}
                      aria-label={nav("history.next")}
                    >
                      <ChevronRight size={20} />
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Le détail d'un trajet : les chiffres, le tracé, le dénivelé, puis les actions. */
function TripDetail({
  trip,
  theme,
  onDelete,
}: {
  trip: Trip;
  theme: Theme;
  onDelete: () => void;
}) {
  const { nav, locale } = useNav();
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  useBackClose(confirming, () => setConfirming(false));

  const speed = averageSpeed(trip);
  const rhythm = pace(trip);
  const hasMap = trip.points.length > 1;
  // Une course garde les mêmes blocs qu'une marche, en orange, avec ses propres
  // chiffres et le graphe de l'allure sous la carte.
  const isRun = trip.kind === "run";

  // L'image se prépare **pendant qu'on lit le détail**, et non au clic : la
  // feuille de partage du système ne s'ouvre que dans le geste même de
  // l'utilisateur, et fabriquer l'image d'abord la ferait toujours arriver trop
  // tard (voir `tripShare.ts`). Le bouton attend donc qu'elle soit prête.
  //
  // `undefined` veut dire « la carte n'a pas encore fini de peindre » ; `null`,
  // « il n'y en aura pas » — trajet sans tracé, ou tuiles qui ne viennent pas.
  const [mapImage, setMapImage] = useState<Blob | null | undefined>(hasMap ? undefined : null);
  const cardRef = useRef<Blob | null>(null);
  const [ready, setReady] = useState(false);

  const onMapReady = useCallback((map: MLMap) => {
    try {
      map.getCanvas().toBlob((blob) => setMapImage(blob), "image/png");
    } catch {
      setMapImage(null); // contexte WebGL perdu
    }
  }, []);

  // Une carte hors ligne ne devient jamais « inactive » : sans ce délai, le
  // bouton resterait grisé pour toujours. On part alors sans elle.
  useEffect(() => {
    if (!hasMap) return;
    const timer = window.setTimeout(() => setMapImage((current) => (current === undefined ? null : current)), 8000);
    return () => window.clearTimeout(timer);
  }, [hasMap]);

  useEffect(() => {
    if (mapImage === undefined) return;
    let cancelled = false;
    drawTripCard(trip, theme, locale, mapImage)
      .then((card) => {
        if (cancelled) return;
        cardRef.current = card;
        setReady(card !== null);
      })
      .catch(() => {
        if (!cancelled) setReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mapImage, trip, theme, locale]);

  /**
   * Aucun `await` avant `shareImage` : c'est toute la raison de la préparation
   * qui précède. Le rendre asynchrone ferait perdre l'activation du geste et
   * refermerait la porte de la feuille de partage.
   */
  function share() {
    const card = cardRef.current;
    if (!card) return;
    setNotice(null);
    void shareImage(card, imageFileName(tripDate(trip, locale), isRun ? nav("run.title") : trip.to)).then((outcome) => {
      if (outcome === "copied") setNotice(nav("history.copied"));
      if (outcome === "downloaded") setNotice(nav("history.downloaded"));
    });
  }

  return (
    <div className={`history-detail ${isRun ? "is-run" : ""}`}>
      {routeLabel(trip) && <p className="history-detail-route">{routeLabel(trip)}</p>}

      {isRun ? (
        <RunFigures trip={trip} />
      ) : (
      <ul className="history-figures">
        <li>
          <Timer size={14} />
          <span className="history-figure-value">{formatDuration(trip.elapsedSeconds)}</span>
          <small>{deltaText(trip)}</small>
        </li>
        <li>
          <Route size={14} />
          <span className="history-figure-value">{formatDistance(trip.distanceMeters)}</span>
          {trip.ascent !== null && (
            <small>
              {`D+\u00a0${trip.ascent}\u00a0m · D−\u00a0${trip.descent}\u00a0m`}
            </small>
          )}
        </li>
        <li>
          <Footprints size={14} />
          <span className="history-figure-value">{trip.steps.toLocaleString(locale)}</span>
          <small>{stepsOrigin(trip)}</small>
        </li>
        <li>
          <Gauge size={14} />
          <span className="history-figure-value">{speed === null ? "—" : formatSpeed(speed, locale)}</span>
          {rhythm !== null && (
            <small>
              {formatPace(rhythm)}
              {nav("trip.paceUnit")}
            </small>
          )}
        </li>
      </ul>
      )}

      {/* La carte n'est montée qu'au dépli : chaque instance MapLibre a son
          contexte WebGL, et les navigateurs en comptent peu — en poser une par
          ligne de la liste les épuiserait. */}
      {hasMap && (
        <TripMap points={trip.points} theme={theme} onReady={onMapReady} color={isRun ? RUN_COLOR : undefined} />
      )}

      {isRun && <PaceChart samples={trip.samples ?? []} totalMeters={trip.distanceMeters} />}

      {trip.profile ? (
        <ElevationProfile
          profile={{
            samples: trip.profile,
            ascent: trip.ascent ?? 0,
            descent: trip.descent ?? 0,
            minElevation: Math.min(...trip.profile.map((s) => s.elevation)),
            maxElevation: Math.max(...trip.profile.map((s) => s.elevation)),
          }}
          // Le trajet est fini : il n'y a plus d'endroit où l'on serait, et
          // rien à distinguer entre le fait et le reste.
          traveledMeters={0}
          totalMeters={trip.distanceMeters}
          showPosition={false}
        />
      ) : (
        <p className="history-detail-note">{nav("history.noProfile")}</p>
      )}

      {/* La confirmation se déplie à la place des boutons, comme partout dans
          l'application : `window.confirm` sort du cadre de l'interface, ne suit
          pas le thème, et certains navigateurs mobiles l'escamotent purement et
          simplement. */}
      {confirming ? (
        <div className="history-confirm">
          <p>{nav("history.confirmDelete")}</p>
          <div className="history-confirm-actions">
            <button onClick={() => setConfirming(false)}>{nav("history.confirmNo")}</button>
            <button className="is-danger" onClick={onDelete}>
              {nav("history.confirmYes")}
            </button>
          </div>
        </div>
      ) : (
        <div className="history-detail-actions">
          {/* Grisé tant que l'image n'est pas prête : un partage qui attendrait
              le rendu perdrait le geste, et la feuille ne s'ouvrirait pas. */}
          <button className="history-action" onClick={share} disabled={!ready}>
            {ready ? <Share2 size={15} /> : <LoaderCircle size={15} className="nav-spin" />}
            {ready ? nav("history.share") : nav("history.preparing")}
          </button>
          <button className="history-action is-danger" onClick={() => setConfirming(true)}>
            <Trash2 size={15} />
            {nav("history.delete")}
          </button>
        </div>
      )}

      {notice && <p className="history-detail-note">{notice}</p>}
    </div>
  );
}
