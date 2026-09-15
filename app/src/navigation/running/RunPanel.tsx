import { useEffect, useState } from "react";
import { Crosshair, Pause, Play, Square } from "lucide-react";
import { useNavDockRef } from "../dockClearance";
import { MusicCard } from "../music/MusicCard";
import { useNav } from "../strings";
import { formatPace } from "../trip";
import { currentPace, formatRunClock, formatRunDistance } from "./run";
import { RunSummary } from "./RunSummary";
import type { RunSession } from "./useRunSession";

// ---------------------------------------------------------------------------
// Ce qu'on voit en courant.
//
// **Le mode se signale sans ambiguïté** : un bandeau en haut, liseré et point
// pulsant orange, qui dit « Course en cours » et porte le chronomètre, avec
// Pause et Terminer à portée de pouce. En pause, le point cesse de battre et le
// libellé change — on ne doit jamais se demander si le chronomètre tourne.
//
// En bas, la même colonne que les navigations (`.nav-dock`) : l'encart de
// musique s'il y en a, puis trois chiffres — distance, allure du moment,
// allure moyenne. Le temps est déjà en haut ; le répéter en bas mangerait la
// place du chiffre qui change le plus, l'allure.
// ---------------------------------------------------------------------------

/**
 * L'heure, rafraîchie chaque seconde tant que le chronomètre tourne. Elle vit
 * **ici** et non dans la session : seul ce panneau se redessine alors, et non
 * toute l'application (mesure et règle dans `app/CLAUDE.md`).
 */
function useSecondTick(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  return now;
}

export function RunPanel({ session }: { session: RunSession }) {
  const { nav, locale } = useNav();
  const dockRef = useNavDockRef();
  const clock = useSecondTick(session.status === "running");

  if (!session.active) {
    return session.summary ? <RunSummary trip={session.summary} onClose={session.closeSummary} /> : null;
  }

  const paused = session.status === "paused";
  // Un battement en retard au démarrage donnerait un temps négatif : borné à zéro.
  const movingSeconds =
    (session.movingBaseMs + (session.status === "running" ? Math.max(0, clock - session.resumedAt) : 0)) / 1000;
  const now = currentPace(session.samples);
  const average = session.distanceMeters >= 50 ? movingSeconds / (session.distanceMeters / 1000) : null;

  return (
    <>
      <div className={`run-banner ${paused ? "is-paused" : ""}`} role="status" aria-live="polite">
        <span className="run-pulse" aria-hidden="true" />
        <div className="run-banner-text">
          <span className="run-banner-label">{nav(paused ? "run.pausedLabel" : "run.active")}</span>
          <span className="run-banner-time">{formatRunClock(movingSeconds)}</span>
          {!session.fix && <span className="run-banner-note">{session.error ?? nav("run.waiting")}</span>}
        </div>
        <button
          className="run-pause"
          onClick={paused ? session.resume : session.pause}
          aria-label={nav(paused ? "run.resume" : "run.pause")}
          title={nav(paused ? "run.resume" : "run.pause")}
        >
          {paused ? <Play size={20} /> : <Pause size={20} />}
        </button>
        <button className="run-stop" onClick={session.stop}>
          <Square size={14} />
          {nav("run.stop")}
        </button>
      </div>

      <div className="nav-dock" ref={dockRef}>
        {!session.follow && (
          <button className="nav-recenter" onClick={session.recenter}>
            <Crosshair size={15} />
            {nav("run.recenter")}
          </button>
        )}

        <MusicCard />

        <div className="nav-bar run-bar">
          <div className="run-figures">
            <span className="run-figure">
              <span className="run-figure-label">{nav("run.distance")}</span>
              <span className="run-figure-value">{formatRunDistance(session.distanceMeters, locale)}</span>
            </span>
            <span className="run-figure is-main">
              <span className="run-figure-label">{nav("run.pace")}</span>
              <span className="run-figure-value">{now === null ? "—" : formatPace(now)}</span>
            </span>
            <span className="run-figure">
              <span className="run-figure-label">{nav("run.avgPace")}</span>
              <span className="run-figure-value">{average === null ? "—" : formatPace(average)}</span>
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
