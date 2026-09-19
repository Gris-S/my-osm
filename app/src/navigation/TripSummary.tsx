import { useEffect, useRef } from "react";
import { Flag, Footprints, Gauge, MapPin, Route, Timer } from "lucide-react";
import { formatDistance, formatDuration } from "../utils/format";
import type { Trip } from "./history";
import { historyRetention } from "./settings";
import {
  averageSpeed,
  deltaText,
  formatPace,
  formatSpeed,
  pace,
  routeLabel,
  stepsOrigin,
  timeDelta,
} from "./trip";
import { useNav } from "./strings";
import { useBackClose } from "../hooks/useBackClose";

// ---------------------------------------------------------------------------
// La fiche de fin de trajet : une fenêtre au centre de l'écran, sur le motif de
// celle des paramètres.
//
// Elle s'ouvre des deux façons dont un trajet se termine — l'arrivée, et le
// bouton « Terminer ». Dans le second cas les chiffres portent sur ce qui a
// **réellement** été parcouru, temps annoncé compris : s'arrêter à mi-chemin se
// compare à la moitié annoncée, pas au trajet entier.
//
// L'ordre des chiffres suit ce qu'on cherche en arrivant : le temps d'abord,
// parce que c'est lui qu'on comparait en marchant, puis la distance, puis
// l'effort (pas, vitesse, allure).
// ---------------------------------------------------------------------------

export function TripSummary({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  const { nav, locale } = useNav();
  useBackClose(true, onClose);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Échap ferme, et le clavier arrive dans la fenêtre : mêmes règles que la
  // fenêtre des paramètres. Le clic à l'extérieur est porté par le voile.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    closeRef.current?.focus();
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const speed = averageSpeed(trip);
  const rhythm = pace(trip);
  const delta = timeDelta(trip);
  const recorded = historyRetention() !== "off";

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="settings-dialog trip-summary"
        role="dialog"
        aria-modal="true"
        aria-labelledby="trip-summary-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="trip-summary-head">
          <span className={`trip-summary-badge ${trip.completed ? "is-arrived" : ""}`}>
            {trip.completed ? <Flag size={22} /> : <MapPin size={22} />}
          </span>
          <div>
            <h2 className="trip-summary-title" id="trip-summary-title">
              {nav(trip.completed ? "trip.titleArrived" : "trip.title")}
            </h2>
            {routeLabel(trip) && <p className="trip-summary-route">{routeLabel(trip)}</p>}
          </div>
        </div>

        <dl className="trip-stats">
          <Stat icon={<Timer size={15} />} label={nav("trip.elapsed")} value={formatDuration(trip.elapsedSeconds)}>
            {/* Le temps annoncé et l'écart sont sous le temps mis, et non à
                côté : c'est une glose du chiffre au-dessus, pas un second
                chiffre à comparer. */}
            <span className={`trip-stat-note is-${delta.kind}`}>
              {nav("trip.announced", { time: formatDuration(trip.announcedSeconds) })} · {deltaText(trip)}
            </span>
          </Stat>

          <Stat
            icon={<Route size={15} />}
            label={nav("trip.distance")}
            value={formatDistance(trip.distanceMeters)}
          >
            {trip.ascent !== null && trip.descent !== null && (
              <span className="trip-stat-note">
                {`D+\u00a0${trip.ascent}\u00a0m · D−\u00a0${trip.descent}\u00a0m`}
              </span>
            )}
          </Stat>

          <Stat
            icon={<Footprints size={15} />}
            label={nav("trip.steps")}
            value={trip.steps.toLocaleString(locale)}
          >
            {/* D'où vient le chiffre : un capteur qui a compté et une division
                par la longueur d'un pas ne se valent pas, et l'utilisateur doit
                pouvoir faire la différence. */}
            <span className="trip-stat-note">{stepsOrigin(trip)}</span>
          </Stat>

          <Stat
            icon={<Gauge size={15} />}
            label={nav("trip.speed")}
            value={speed === null ? "—" : formatSpeed(speed, locale)}
          >
            {rhythm !== null && (
              <span className="trip-stat-note">
                {nav("trip.pace")} {formatPace(rhythm)}
                {nav("trip.paceUnit")}
              </span>
            )}
          </Stat>
        </dl>

        <p className="trip-summary-foot">
          {!trip.completed && <span>{nav("trip.interrupted")} · </span>}
          {recorded ? nav("trip.saved") : nav("trip.notSaved")}
        </p>

        <button ref={closeRef} className="trip-summary-close" onClick={onClose}>
          {nav("trip.close")}
        </button>
      </div>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="trip-stat">
      <dt className="trip-stat-label">
        {icon}
        {label}
      </dt>
      <dd className="trip-stat-value">
        {value}
        {children}
      </dd>
    </div>
  );
}
