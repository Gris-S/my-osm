import { ChevronLeft, ChevronRight, Flag, Footprints, Play, Square, X } from "lucide-react";
import type { CSSProperties } from "react";
import type { StationExit } from "./exits";
import { useNavDockRef } from "./dockClearance";
import { MusicCard } from "./music/MusicCard";
import type { TransitStep } from "./transitSteps";
import { formatClock, navPlural, useNav } from "./strings";
import type { TransitNavSession } from "./useTransitNavigation";

// ---------------------------------------------------------------------------
// Ce qu'on a sous les yeux dans le couloir.
//
// Deux blocs, comme le guidage à pied : le **geste à faire** en haut, là où le
// regard se porte, et **la suite du trajet** en bas, sous le pouce.
//
// La liste du bas ne montre que ce qui reste. Une action franchie disparaît —
// c'est la demande, et c'est aussi ce qui rend la liste lisible d'un coup d'œil
// dans une rame bondée : ce qui est encore écrit est ce qu'il reste à faire.
//
// Le geste du haut change avec l'action en cours, et c'est le découpage de
// `transitSteps.ts` qui le donne : marcher, monter, descendre, arriver. Dans le
// véhicule, c'est donc bien la station de descente qui s'affiche, et non la
// ligne qu'on vient de prendre.
// ---------------------------------------------------------------------------

export function TransitNavigationPanel({ session }: { session: TransitNavSession }) {
  const { nav } = useNav();
  // Hauteur de la colonne du bas, lue par `App` pour y ranger les boutons de droite.
  const dockRef = useNavDockRef();
  const { current, upcoming, offset } = session;

  if (!session.active || !current) return null;

  return (
    <>
      <div className="nav-banner">
        <Instruction
          step={current}
          next={session.upcoming[0] ?? null}
          stopsLeft={session.stopsLeft}
          exit={session.exit}
        />
        {/* Le décalage manuel se dit : sans cela, un guidage volontairement
            décalé d'une étape passerait pour une erreur du calcul. */}
        {offset !== 0 && (
          <p className="nav-banner-note">
            {offsetText(offset, nav)}
            <button className="transit-resync" onClick={() => (offset > 0 ? session.back() : session.advance())}>
              {nav("transit.resync")}
            </button>
          </p>
        )}
      </div>

      <div className="nav-dock" ref={dockRef}>
        {/* Musique en cours : l'encart n'existe que s'il y en a une (voir `music/`). */}
        <MusicCard />
        <div className="nav-bar is-transit">
          <div className="transit-remaining">
            <h3 className="transit-remaining-title">
              {upcoming.length ? nav("transit.remaining") : nav("transit.done")}
            </h3>
            <ol className="transit-steps">
              {upcoming.map((step, rank) => (
                <li key={`${step.legIndex}-${step.kind}-${rank}`} className="transit-step">
                  <span className="transit-step-time">{formatClock(step.at)}</span>
                  <Badge step={step} />
                  <span className="transit-step-text">{shortText(step, nav)}</span>
                </li>
              ))}
            </ol>
          </div>

          <div className="nav-bar-main">
            {/* Deux boutons de recalage : l'horaire de Navitia est une
                prévision, et un train en retard rend le guidage faux sans que
                rien ne permette de le dire. */}
            <div className="transit-nudge">
              <button onClick={session.back} aria-label={nav("transit.previous")}>
                <ChevronLeft size={16} />
              </button>
              <button onClick={session.advance} aria-label={nav("transit.next")}>
                <ChevronRight size={16} />
              </button>
            </div>

            {/* Comme pour la marche, la simulation n'existe qu'en
                développement : ici elle accélère l'horloge, seul moteur d'un
                trajet en transports. */}
            {import.meta.env.DEV && (
              <button
                className={`nav-sim ${session.simulating ? "is-on" : ""}`}
                onClick={session.toggleSimulation}
                aria-label={session.simulating ? nav("sim.stop") : nav("sim.start")}
                title={session.simulating ? nav("sim.stop") : nav("sim.start")}
              >
                {session.simulating ? <Square size={14} /> : <Play size={14} />}
              </button>
            )}

            <button className="nav-stop" onClick={session.stop}>
              <X size={16} />
              {nav("nav.stop")}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/** La pastille d'une action : la ligne à ses couleurs, ou le pictogramme. */
function Badge({ step }: { step: TransitStep }) {
  if (step.kind === "walk") {
    return (
      <span className="transit-badge is-walk">
        <Footprints size={13} />
      </span>
    );
  }
  if (step.kind === "arrive") {
    return (
      <span className="transit-badge is-arrive">
        <Flag size={13} />
      </span>
    );
  }
  return (
    <span
      className="line-badge"
      style={{ background: step.line?.color, color: step.line?.textColor }}
    >
      {step.line?.label}
    </span>
  );
}

type Nav = ReturnType<typeof useNav>["nav"];

/** Le geste à faire, en grand. */
function Instruction({
  step,
  next,
  stopsLeft,
  exit,
}: {
  step: TransitStep;
  /** L'action d'après : elle complète la marche qui mène à un arrêt. */
  next: TransitStep | null;
  stopsLeft: number | null;
  exit: StationExit | null;
}) {
  const { nav } = useNav();
  const minutes = Math.max(1, Math.round((step.durationSeconds ?? 0) / 60));

  const title =
    step.kind === "walk"
      ? step.place
        ? nav("transit.walkTo", { minutes, place: step.place })
        : nav("transit.walk", { minutes })
      : step.kind === "board"
        ? step.line?.label
          ? nav("transit.board", { line: step.line.label, place: step.place })
          : nav("transit.boardPlain", { place: step.place })
        : step.kind === "alight"
          ? nav("transit.alight", { place: step.place })
          : step.place
            ? nav("transit.arrivedAt", { place: step.place })
            : nav("transit.arrived");

  // La ligne du dessous répond à « et ensuite ? » : la direction et l'heure de
  // départ avant de monter, ce qui reste à parcourir une fois dedans.
  const aside: string[] = [];
  // Une marche qui mène à un arrêt annonce **déjà la ligne**. Mesuré sur un
  // trajet réel : Navitia fait parfois arriver la marche à la seconde même du
  // départ, si bien que l'action « monter » ne dure rien et que le bandeau
  // passerait directement de « marcher » à « descendre » — on n'aurait jamais
  // lu quelle ligne prendre.
  if (step.kind === "walk" && next?.kind === "board") {
    if (next.line?.label) {
      aside.push(nav("transit.board", { line: next.line.label, place: next.place }));
    }
    if (next.direction) aside.push(nav("transit.direction", { direction: next.direction }));
    aside.push(nav("transit.departsAt", { time: formatClock(next.until) }));
  }
  if (step.kind === "board") {
    if (step.direction) aside.push(nav("transit.direction", { direction: step.direction }));
    aside.push(nav("transit.departsAt", { time: formatClock(step.until) }));
  }
  if (step.kind === "alight") {
    if (stopsLeft !== null) aside.push(navPlural("transit.stopsLeft", stopsLeft));
    aside.push(nav("transit.arriveAt", { time: formatClock(step.until) }));
  }

  return (
    <div className="nav-maneuver" style={{ "--step-color": step.line?.color } as CSSProperties}>
      <span className={`nav-maneuver-icon is-${step.kind}`}>
        {step.kind === "walk" ? (
          <Footprints size={26} />
        ) : step.kind === "arrive" ? (
          <Flag size={26} />
        ) : (
          <span className="transit-icon-badge">{step.line?.label ?? "?"}</span>
        )}
      </span>
      <div className="nav-maneuver-text">
        <span className="nav-maneuver-instruction is-transit">{title}</span>
        {aside.length > 0 && <span className="transit-aside">{aside.join(" · ")}</span>}
        {/* La sortie n'apparaît que sur une descente, et seulement là où la
            station en déclare une : un arrêt de bus n'en a pas. */}
        {step.kind === "alight" && exit && <span className="transit-exit">{exitText(exit, nav)}</span>}
      </div>
    </div>
  );
}

/** Une action dans la liste du bas : une ligne, sans détail. */
function shortText(step: TransitStep, nav: Nav): string {
  const minutes = Math.max(1, Math.round((step.durationSeconds ?? 0) / 60));
  switch (step.kind) {
    case "walk":
      return step.place ? nav("transit.walkTo", { minutes, place: step.place }) : nav("transit.walk", { minutes });
    case "board":
      return step.line?.label
        ? nav("transit.board", { line: step.line.label, place: step.place })
        : nav("transit.boardPlain", { place: step.place });
    case "alight":
      return nav("transit.alight", { place: step.place });
    default:
      return step.place ? nav("transit.arrivedAt", { place: step.place }) : nav("transit.arrived");
  }
}

function exitText(exit: StationExit, nav: Nav): string {
  if (exit.number) return nav("transit.exit", { number: exit.number, name: exit.name });
  return nav("transit.exitUnnumbered", { name: exit.name });
}

function offsetText(offset: number, nav: Nav): string {
  const count = Math.abs(offset);
  if (offset > 0) return count === 1 ? nav("transit.ahead") : nav("transit.aheadMany", { count });
  return count === 1 ? nav("transit.behind") : nav("transit.behindMany", { count });
}
