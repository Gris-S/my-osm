import type { ReactNode } from "react";
import { Gauge, Mountain, Route, Timer } from "lucide-react";
import { formatDistance, formatDuration } from "../../utils/format";
import type { Trip } from "../history";
import { useNav } from "../strings";
import { averageSpeed, formatPace, formatSpeed, pace } from "../trip";

// ---------------------------------------------------------------------------
// Les quatre chiffres d'une course : durée, distance, allure, dénivelé.
//
// Partagés par la fiche de fin et le détail de l'historique, pour qu'une course
// se lise pareil le soir même et six mois plus tard. Le dénivelé a son propre
// chiffre — c'était une demande explicite — et n'est pas une glose de la
// distance comme pour la marche.
// ---------------------------------------------------------------------------

export function RunFigures({ trip, pendingElevation = false }: { trip: Trip; pendingElevation?: boolean }) {
  const { nav, locale } = useNav();
  const average = pace(trip);
  const speed = averageSpeed(trip);
  const paused = trip.pausedSeconds ?? 0;

  return (
    <dl className="trip-stats run-stats">
      <RunStat
        icon={<Timer size={15} />}
        label={nav("run.duration")}
        value={formatDuration(trip.elapsedSeconds)}
        note={paused >= 5 ? nav("run.pausedFor", { time: formatDuration(paused) }) : null}
      />
      <RunStat icon={<Route size={15} />} label={nav("run.distance")} value={formatDistance(trip.distanceMeters)} />
      <RunStat
        icon={<Gauge size={15} />}
        label={nav("run.avgPaceLong")}
        value={average === null ? "—" : `${formatPace(average)}${nav("trip.paceUnit")}`}
        note={speed === null ? null : nav("run.avgSpeed", { speed: formatSpeed(speed, locale) })}
      />
      <RunStat
        icon={<Mountain size={15} />}
        label={nav("run.elevation")}
        value={trip.ascent !== null ? `D+ ${trip.ascent} m` : "—"}
        note={
          trip.ascent !== null
            ? `D− ${trip.descent ?? 0} m`
            : nav(pendingElevation ? "run.elevationPending" : "run.elevationMissing")
        }
      />
    </dl>
  );
}

function RunStat({ icon, label, value, note }: { icon: ReactNode; label: string; value: string; note?: string | null }) {
  return (
    <div>
      <dt className="trip-stat-label">
        {icon}
        {label}
      </dt>
      <dd className="trip-stat-value">
        {value}
        {note && <span className="trip-stat-note">{note}</span>}
      </dd>
    </div>
  );
}
