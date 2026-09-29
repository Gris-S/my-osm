import { LoaderCircle, X } from "lucide-react";
import { useNav } from "./strings";
import type { NavSession } from "./useNavigation";
import { useBackClose } from "../hooks/useBackClose";

// ---------------------------------------------------------------------------
// La barre du choix d'itinéraire à vélo — la même que celle de la voiture
// (`car/RouteChoice.tsx`), et pour la même raison : le choix se fait **sur la
// carte**, en touchant la bulle d'un parcours ; ici ne restent que ce qu'on
// attend de l'utilisateur et de quoi renoncer. Mêmes classes, même allure.
// ---------------------------------------------------------------------------

export function BikeRouteChoice({ session }: { session: NavSession }) {
  const { nav } = useNav();
  // Le geste retour annule le choix, comme « Annuler » : ce n'est pas encore
  // une navigation.
  useBackClose(session.active && session.status === "choosing", session.stop);
  if (!session.active || session.status !== "choosing") return null;

  const count = session.choiceCount ?? 0;
  return (
    <div className="car-choice-bar">
      <span className="car-choice-text">
        {session.choiceCount === null && !session.error && (
          <>
            <LoaderCircle size={15} className="nav-spin" />
            {nav("car.computingChoices")}
          </>
        )}
        {session.error && <span className="car-choice-failed">{session.error}</span>}
        {count > 0 && nav(count > 1 ? "car.pickOnMap" : "car.pickOnMapSingle")}
      </span>
      <button className="car-choice-cancel" onClick={session.stop}>
        <X size={15} />
        {nav("car.cancel")}
      </button>
    </div>
  );
}
