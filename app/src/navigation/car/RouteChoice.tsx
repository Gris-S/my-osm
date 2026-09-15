import { LoaderCircle, X } from "lucide-react";
import { useNav } from "../strings";
import type { CarNavSession } from "./useCarNavigation";
import { useBackClose } from "../../hooks/useBackClose";

// ---------------------------------------------------------------------------
// Le choix d'itinéraire, avant de démarrer.
//
// **Le choix se fait sur la carte, pas dans ce composant.** Les parcours y sont
// tracés côte à côte — celui qu'on regarde en plein, les autres en gris — et
// chacun porte sa bulle, posée là où il s'écarte des autres : la durée, puis le
// péage. On touche la bulle pour retenir le parcours (voir `NavChoice` dans
// `useNavigation.ts`, et le rendu dans `MapView`).
//
// C'est le contraire de ce qui existait ici : une fenêtre au centre, sur un
// voile, qui listait trois propositions en chiffres. Elle avait deux défauts,
// et ils tenaient au même principe. Elle **masquait la carte**, alors que
// choisir entre deux itinéraires, c'est précisément vouloir regarder par où ils
// passent — et le voile interdisait même de déplacer la vue pour aller voir.
// Et elle **redisait les mêmes choses** : un libellé « Sans péage » au-dessus
// d'un « Aucun péage », faute de savoir quoi mettre dans deux lignes quand une
// seule a quelque chose à dire.
//
// Ne reste donc ici qu'une barre : ce qu'on attend de l'utilisateur, et de quoi
// renoncer. Elle est volontairement basse et étroite — tout le reste de l'écran
// est la carte, qui est l'outil du choix.
// ---------------------------------------------------------------------------

export function RouteChoice({ session }: { session: CarNavSession }) {
  const { nav } = useNav();
  // Le geste retour annule le choix, comme « Annuler » : ce n'est pas encore
  // une navigation.
  useBackClose(session.active && session.status === "choosing", session.stop);
  if (!session.active || session.status !== "choosing") return null;

  const count = session.proposals?.length ?? 0;

  return (
    <div className="car-choice-bar">
      <span className="car-choice-text">
        {!session.proposals && !session.error && (
          <>
            <LoaderCircle size={15} className="nav-spin" />
            {nav("car.computingChoices")}
          </>
        )}
        {session.error && <span className="car-choice-failed">{session.error}</span>}
        {/* Une seule proposition n'est pas un choix : on le dit autrement, sinon
            « touchez une bulle pour partir » invite à comparer ce qui n'a pas
            d'alternative. */}
        {count > 0 && nav(count > 1 ? "car.pickOnMap" : "car.pickOnMapSingle")}
      </span>

      {/* Sans clé TomTom, OSRM rend un seul trajet et ne sait rien ni du trafic
          ni des péages. Le dire vaut mieux que de laisser croire qu'il n'existe
          qu'un chemin. */}
      {count === 1 && session.proposals?.[0].route.live === false && (
        <span className="car-choice-hint">{nav("car.noKeyHint")}</span>
      )}

      <button className="car-choice-cancel" onClick={session.stop}>
        <X size={15} />
        {nav("car.cancel")}
      </button>
    </div>
  );
}
