import { LoaderCircle, SlidersHorizontal, TriangleAlert, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { useOfflineState } from "../hooks/useOfflineState";

// ---------------------------------------------------------------------------
// Bandeau discret sur l'état de la carte.
//
// Les POI sont lus dans les tuiles vectorielles déjà téléchargées : ils
// s'affichent sans attente. Reste le cas où les tuiles de la zone, elles, ne
// sont pas encore arrivées — première ouverture, réseau lent. Le bandeau ne
// devient visible qu'au bout d'une demi-seconde (animation retardée dans
// `App.css`) : sur une connexion normale, personne ne le voit passer.
//
// Il porte aussi **l'état hors ligne**, qui n'était dit nulle part : une
// application dont les cartes hors ligne sont la fonction centrale doit
// distinguer « pas de réseau » de « en panne », et surtout dire quand on sort
// des zones téléchargées — sans quoi la carte se vide sans un mot.
// ---------------------------------------------------------------------------

/** `empty` : aucune catégorie cochée — la carte est vide, et le dit. */
export type PoiStatus = "idle" | "loading" | "empty";

interface MapStatusProps {
  status: PoiStatus;
  /**
   * Ce que MapLibre a refusé de faire, s'il a refusé quelque chose.
   *
   * Une carte qui reste grise est le pire des symptômes : elle ne dit pas si le
   * style n'est pas arrivé, si le réseau est coupé, ou si le rendu a échoué.
   * Ce message est la seule chose qui distingue les trois, et il vaut surtout
   * là où l'on ne peut pas ouvrir une console — dans l'application empaquetée.
   */
  mapError: string | null;
  /**
   * Ce que la géolocalisation a répondu, quand elle a refusé.
   *
   * Ce message existait, traduit dans les deux langues, et n'était affiché
   * **nulle part** : `useGeolocation` le posait, personne ne le lisait. Un
   * refus de position se soldait donc par un bouton qui tourne dix secondes et
   * rien d'autre — le symptôme exact d'une panne, pour un fonctionnement
   * normal.
   */
  locationError: string | null;
}

export function MapStatus({ status, mapError, locationError }: MapStatusProps) {
  const { t } = useI18n();
  const { offline, missingZone } = useOfflineState();
  // « Aucune catégorie » est un choix, pas un incident : il se dit, puis se
  // tait. Il restait affiché en permanence pour qui a tout décoché exprès.
  const [emptyExpired, setEmptyExpired] = useState(false);
  useEffect(() => {
    if (status !== "empty") return;
    const timer = setTimeout(() => setEmptyExpired(true), 6000);
    return () => {
      clearTimeout(timer);
      // Le prochain « aucune catégorie » se redira.
      setEmptyExpired(false);
    };
  }, [status]);

  // Une panne de carte prime sur tout le reste : tant qu'elle dure, l'état du
  // chargement des commerces n'intéresse personne.
  if (mapError) {
    return (
      <div className="map-status is-error" role="alert">
        <TriangleAlert size={15} />
        {mapError}
      </div>
    );
  }

  // La réponse à un geste précis — on vient de toucher le bouton de position —
  // passe avant l'état général de la carte : c'est celle qu'on attend.
  if (locationError) {
    return (
      <div className="map-status is-warning" role="alert">
        <TriangleAlert size={15} />
        {locationError}
      </div>
    );
  }

  // Hors ligne, et c'est permanent tant que ça dure : le chargement des
  // commerces ne veut plus rien dire dans cet état. Le message se précise quand
  // la carte a réellement laissé des cases vides — c'est la seule façon de
  // savoir, sans console, qu'on est sorti des zones téléchargées.
  if (offline) {
    return (
      <div className="map-status" role="status">
        <WifiOff size={15} />
        {t(missingZone ? "mapStatus.offlineGap" : "mapStatus.offline")}
      </div>
    );
  }

  // Une carte vide parce que rien n'est coché ressemble à une carte en panne :
  // mieux vaut le dire que laisser chercher.
  if (status === "empty" && !emptyExpired) {
    return (
      <div className="map-status" role="status">
        <SlidersHorizontal size={15} />
        {t("mapStatus.empty")}
      </div>
    );
  }

  if (status !== "loading") return null;

  return (
    <div className="map-status" role="status">
      <LoaderCircle size={15} className="map-status-spinner" />
      {t("mapStatus.loading")}
    </div>
  );
}
