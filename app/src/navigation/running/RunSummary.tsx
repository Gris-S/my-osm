import { useEffect, useRef } from "react";
import { Activity } from "lucide-react";
import type { Trip } from "../history";
import { historyRetention } from "../settings";
import { useNav } from "../strings";
import { routeLabel, tripTimes } from "../trip";
import { PaceChart } from "./PaceChart";
import { RunFigures } from "./RunFigures";
import { useBackClose } from "../../hooks/useBackClose";

// ---------------------------------------------------------------------------
// La fiche de fin de course : la même fenêtre que celle de la marche, en orange.
//
// Les chiffres d'abord (durée, distance, allure, dénivelé), puis le graphe de
// l'allure, qui est ce que la demande voulait voir « surtout ». Le dénivelé
// arrive quelques secondes après l'ouverture, quand les tuiles d'altitude ont
// répondu : la fiche le dit plutôt que de faire attendre.
// ---------------------------------------------------------------------------

export function RunSummary({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  const { nav, locale } = useNav();
  useBackClose(true, onClose);
  const closeRef = useRef<HTMLButtonElement>(null);
  const recorded = historyRetention() !== "off";

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    closeRef.current?.focus();
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const place = routeLabel(trip);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="settings-dialog trip-summary is-run"
        role="dialog"
        aria-modal="true"
        aria-labelledby="run-summary-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="trip-summary-head">
          <span className="trip-summary-badge is-run">
            <Activity size={22} />
          </span>
          <div>
            <h2 className="trip-summary-title" id="run-summary-title">
              {nav("run.summaryTitle")}
            </h2>
            <p className="trip-summary-route">
              {tripTimes(trip, locale)}
              {place ? ` · ${place}` : ""}
            </p>
          </div>
        </div>

        <RunFigures trip={trip} pendingElevation={recorded && trip.ascent === null} />
        <PaceChart samples={trip.samples ?? []} totalMeters={trip.distanceMeters} />

        <p className="trip-summary-foot">{recorded ? nav("trip.saved") : nav("trip.notSaved")}</p>

        <button ref={closeRef} className="trip-summary-close" onClick={onClose}>
          {nav("trip.close")}
        </button>
      </div>
    </div>
  );
}
