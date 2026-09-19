import { useEffect, useState } from "react";
import { ChevronDown, Crosshair, Footprints, LoaderCircle, Mountain, Play, Square, X } from "lucide-react";
import { formatDistance } from "../utils/format";
import { ElevationProfile } from "./ElevationProfile";
import { useNavBannerRef, useNavDockRef } from "./dockClearance";
import { MusicCard } from "./music/MusicCard";
import { sampleElevation, type ElevationProfile as Profile } from "./elevation";
import { maneuverIcon, maneuverSide, maneuverText, roundaboutExit } from "./maneuver";
import { OFF_ROUTE_METERS } from "./progress";
import { estimateSteps, METERS_PER_STEP } from "./useStepCounter";
import type { NavRoute } from "./route";
import { formatClock, formatGuidanceDistance, splitDuration, useNav } from "./strings";
import { TripSummary } from "./TripSummary";
import type { NavSession } from "./useNavigation";
import { useBackClose } from "../hooks/useBackClose";

// ---------------------------------------------------------------------------
// Ce qu'on a sous les yeux en marchant.
//
// Deux blocs, et pas un panneau unique : le **bandeau de manœuvre** en haut,
// là où le regard se porte en levant les yeux de la rue, et la **barre de
// route** en bas, sous le pouce, avec ce qui ne change pas d'un pas à l'autre —
// temps restant, heure d'arrivée, distance. Entre les deux, la carte reste
// entièrement visible ; c'est elle qu'on regarde.
//
// Le détail se déplie **par-dessus la barre du bas** et porte le profil du
// dénivelé. Il n'est calculé qu'à ce moment-là : lire le relief coûte quelques
// tuiles, et tous les marcheurs ne l'ouvriront pas.
// ---------------------------------------------------------------------------

export function NavigationPanel({ session }: { session: NavSession }) {
  const { nav } = useNav();
  // Hauteur de la colonne du bas, lue par `App` pour y ranger les boutons de droite.
  const dockRef = useNavDockRef();
  // Bas du bandeau, lu par la feuille de style pour y ranger le burger et la météo.
  const bannerRef = useNavBannerRef();
  const [detailOpen, setDetailOpen] = useState(false);
  // Le geste retour replie le détail ; la navigation elle-même ne s'arrête jamais par ce geste.
  useBackClose(session.active && detailOpen, () => setDetailOpen(false));
  const { progress, route, status } = session;

  if (!session.active) return null;

  const next = progress?.next ?? null;
  const arrived = status === "arrived";

  return (
    <>
      <div className="nav-banner" ref={bannerRef}>
        {arrived ? (
          <ArrivalBanner name={session.destinationName} />
        ) : next ? (
          <ManeuverBanner
            distanceMeters={next.distanceMeters}
            text={maneuverText(next.step.maneuver)}
            Icon={maneuverIcon(next.step.maneuver)}
            side={maneuverSide(next.step.maneuver)}
            exit={roundaboutExit(next.step.maneuver)}
          />
        ) : (
          <p className="nav-banner-waiting">
            <LoaderCircle size={16} className="nav-spin" />
            {status === "computing"
              ? nav("nav.computing")
              : session.error
                ? session.error
                : nav("nav.locating")}
          </p>
        )}

        {/* Le recalcul se dit sans effacer l'instruction : tant qu'il n'a pas
            abouti, la précédente reste la meilleure indication disponible. */}
        {session.rerouting && <p className="nav-banner-note">{nav("nav.rerouting")}</p>}
        {!session.rerouting && progress && progress.offsetMeters > OFF_ROUTE_METERS && !arrived && (
          <p className="nav-banner-note">{nav("nav.offRoute")}</p>
        )}
      </div>

      {/* Le bouton de recentrage et la barre partagent une colonne ancrée en
          bas, plutôt que d'être posés chacun de son côté — même motif que
          `.map-dock` pour la météo et la boussole. C'est ce qui garde le bouton
          *au-dessus* de la barre quand le détail se déplie et la fait grandir :
          un décalage chiffré à la main finissait par passer dessous. */}
      <div className="nav-dock" ref={dockRef}>
        {!session.follow && (
          <button className="nav-recenter" onClick={session.recenter}>
            <Crosshair size={15} />
            {nav("nav.recenter")}
          </button>
        )}

        {/* Musique en cours : l'encart n'existe que s'il y en a une (voir `music/`). */}
        <MusicCard />
        <div className={`nav-bar ${detailOpen ? "is-open" : ""}`}>
          {detailOpen && route && (
            <Detail route={route} traveledMeters={progress?.traveledMeters ?? 0} />
          )}

          <div className="nav-bar-main">
            <button
              className="nav-bar-figures"
              onClick={() => setDetailOpen((open) => !open)}
              aria-expanded={detailOpen}
              aria-label={nav("nav.details")}
            >
              {/* Trois chiffres nus : un temps, une heure, une distance. Leur
                  forme les distingue, et un libellé sous chacun mangeait la
                  place du seul qui compte vraiment — le temps qui reste. Les
                  intitulés restent en infobulle, pour la synthèse vocale. */}
              <span className="nav-eta" title={nav("nav.remaining")}>
                {progress ? splitDuration(progress.remainingSeconds).value : "—"}
                {progress && splitDuration(progress.remainingSeconds).unit && (
                  <small>{splitDuration(progress.remainingSeconds).unit}</small>
                )}
              </span>
              <span className="nav-figure" title={nav("nav.arrival")}>
                {progress ? formatClock(progress.arrivalAt) : "—"}
              </span>
              <span className="nav-figure" title={nav("nav.distance")}>
                {progress ? formatDistance(progress.remainingMeters) : "—"}
              </span>
              {/* Le chevron est la seule promesse d'un détail : la barre entière
                  est le bouton, mais rien d'autre ne dit qu'elle s'ouvre. */}
              <span className="nav-chevron-slot">
                <Mountain size={13} />
                <ChevronDown size={16} className={`nav-chevron ${detailOpen ? "is-open" : ""}`} />
              </span>
            </button>

            {/* La simulation n'existe qu'en développement : sans navigateur sous
                la main, c'est le seul moyen de voir le bandeau changer de
                manœuvre et le graphe avancer. Vite retire ce bloc au build. */}
            {import.meta.env.DEV && route && (
              <button
                className={`nav-sim ${session.simulating ? "is-on" : ""}`}
                onClick={session.toggleSimulation}
                aria-label={session.simulating ? nav("sim.stop") : nav("sim.start")}
                title={session.simulating ? nav("sim.stop") : nav("sim.start")}
              >
                {session.simulating ? <Square size={14} /> : <Play size={14} />}
              </button>
            )}

            {/* « Terminer » ne referme pas : il **clôt le trajet**, et la
                fiche qui s'ouvre rend compte de ce qui a été fait. C'est elle
                qui referme ensuite. */}
            <button className="nav-stop" onClick={session.finish}>
              <X size={16} />
              {nav("nav.stop")}
            </button>
          </div>
        </div>
      </div>

      {/* Ouverte par l'arrivée comme par le bouton, et c'est elle qui met fin
          au guidage : tant qu'elle est là, les capteurs sont déjà arrêtés mais
          la carte garde le tracé sous les yeux. */}
      {session.summary && <TripSummary trip={session.summary} onClose={session.stop} />}
    </>
  );
}

function ManeuverBanner({
  distanceMeters,
  text,
  Icon,
  side,
  exit,
}: {
  distanceMeters: number;
  text: string;
  Icon: React.ComponentType<{ size?: number }>;
  side: "left" | "right" | "straight" | "uturn";
  /** Numéro de sortie d'un rond-point, inscrit dans le pictogramme. */
  exit: number | null;
}) {
  return (
    <div className="nav-maneuver">
      <span className={`nav-maneuver-icon is-${side}`}>
        <Icon size={40} />
        {exit !== null && <span className="nav-exit">{exit}</span>}
      </span>
      <div className="nav-maneuver-text">
        <span className="nav-maneuver-distance">{formatGuidanceDistance(distanceMeters)}</span>
        <span className="nav-maneuver-instruction">{text}</span>
      </div>
    </div>
  );
}

function ArrivalBanner({ name }: { name: string | null }) {
  const { nav } = useNav();
  return (
    <div className="nav-maneuver is-arrival">
      <span className="nav-maneuver-icon is-arrival">
        <Crosshair size={30} />
      </span>
      <div className="nav-maneuver-text">
        <span className="nav-maneuver-instruction">
          {name ? nav("nav.arrivedAt", { name }) : nav("nav.arrived")}
        </span>
      </div>
    </div>
  );
}

type ProfileState =
  | { status: "loading" }
  | { status: "done"; profile: Profile }
  | { status: "error" };

/**
 * Le détail : le profil du dénivelé du parcours entier, et l'endroit où l'on
 * se trouve dessus.
 *
 * Il n'est demandé qu'ici, au dépli — quelques tuiles d'altitude — et il est
 * refait quand le trajet change, c'est-à-dire après un recalcul : le profil
 * d'un parcours qu'on ne suit plus tromperait sur ce qui reste à monter.
 */
function Detail({ route, traveledMeters }: { route: NavRoute; traveledMeters: number }) {
  const { nav, locale } = useNav();
  // Le profil, rangé avec le trajet qu'il décrit : après un recalcul, on
  // repasse par « chargement » sans effet qui remette l'état à zéro.
  const [loaded, setLoaded] = useState<{ route: NavRoute; state: ProfileState } | null>(null);
  const state: ProfileState = loaded?.route === route ? loaded.state : { status: "loading" };

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    sampleElevation(route, controller.signal)
      .then((profile) => {
        if (!cancelled) setLoaded({ route, state: { status: "done", profile } });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ route, state: { status: "error" } });
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [route]);

  return (
    <div className="nav-detail">
      {/* Le nombre de pas décrit **le parcours entier**, pas ce qu'il en reste :
          c'est un ordre de grandeur qu'on regarde une fois, avant de partir ou
          au premier dépli. Il ne bouge donc pas en marchant — il n'est refait
          qu'après un recalcul, quand le parcours n'est plus le même. */}
      <p className="nav-detail-steps" title={nav("profile.stepsHint", { length: METERS_PER_STEP.toLocaleString(locale) })}>
        <Footprints size={14} />
        {nav("profile.steps", { count: estimateSteps(route.distanceMeters).toLocaleString(locale) })}
      </p>

      <h3 className="nav-detail-title">{nav("profile.title")}</h3>
      {state.status === "loading" && (
        <p className="nav-detail-note">
          <LoaderCircle size={14} className="nav-spin" />
          {nav("profile.loading")}
        </p>
      )}
      {state.status === "error" && <p className="nav-detail-note">{nav("profile.error")}</p>}
      {state.status === "done" && (
        <ElevationProfile
          profile={state.profile}
          traveledMeters={traveledMeters}
          totalMeters={route.distanceMeters}
        />
      )}
    </div>
  );
}
