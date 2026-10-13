import { useLayoutEffect, useRef, useState } from "react";
import { Music, Pause, Play, SkipBack, SkipForward, X } from "lucide-react";
import { useNav } from "../strings";
import { controlMusic, openMusicPlayer, useNowPlaying } from "./nowPlaying";

// ---------------------------------------------------------------------------
// L'encart de la musique en cours, au-dessus de la barre du bas des navigations.
//
// **Il n'existe que s'il y a de la musique** : pas de bouton pour l'ouvrir, pas
// de place réservée. Une musique lancée en cours de route le fait apparaître,
// un lecteur fermé le fait disparaître. En pause, il reste — c'est justement le
// moment où l'on veut pouvoir relancer.
//
// **Une exception : l'accès n'a pas été accordé.** L'application ne peut alors
// pas savoir s'il y a de la musique, et un encart qui n'apparaît jamais ne dit
// pas pourquoi. Il laisse donc place à un message qui renvoie aux paramètres,
// masquable d'une croix pour le reste de la navigation (le panneau est remonté
// à chaque départ, le message revient donc à la navigation suivante).
//
// Tout y est taillé pour le pouce et le coup d'œil : des boutons de 52 px et
// 60 px, le titre sur une ligne, l'artiste dessous. Pas de barre de progression
// ni de liste : au volant, on ne lit pas, on reconnaît.
// ---------------------------------------------------------------------------

export function MusicCard() {
  const { nav } = useNav();
  const { track, permission } = useNowPlaying();
  const [noticeHidden, setNoticeHidden] = useState(false);

  if (permission === false) {
    if (noticeHidden) return null;
    return (
      <div className="music-card is-notice" role="note">
        <span className="music-art is-empty">
          <Music size={22} />
        </span>
        <p className="music-notice">{nav("music.noAccess")}</p>
        <button className="music-dismiss" onClick={() => setNoticeHidden(true)} aria-label={nav("music.dismiss")}>
          <X size={20} />
        </button>
      </div>
    );
  }

  if (!track) return null;

  const subtitle = track.artist && track.title ? track.artist : track.app;

  return (
    <div className="music-card" role="group" aria-label={nav("music.label")}>
      {/* La pochette ouvre le lecteur : c'est le geste qu'on fait
          spontanément, et l'encart ne montre volontairement ni liste ni barre
          de progression — pour tout le reste, il faut l'application d'origine. */}
      <button
        className={`music-art ${track.artwork ? "" : "is-empty"}`}
        onClick={openMusicPlayer}
        aria-label={nav("music.open")}
        title={track.app || undefined}
      >
        {track.artwork ? <img src={track.artwork} alt="" /> : <Music size={22} />}
      </button>

      <div className="music-text">
        <Marquee className="music-title" text={track.title || track.artist} />
        {subtitle && <span className="music-artist">{subtitle}</span>}
      </div>

      <div className="music-controls">
        <button onClick={() => controlMusic("previous")} aria-label={nav("music.previous")}>
          <SkipBack size={24} />
        </button>
        <button
          className="is-main"
          onClick={() => controlMusic("playPause")}
          aria-label={nav(track.playing ? "music.pause" : "music.play")}
        >
          {track.playing ? <Pause size={28} /> : <Play size={28} />}
        </button>
        <button onClick={() => controlMusic("next")} aria-label={nav("music.next")}>
          <SkipForward size={24} />
        </button>
      </div>
    </div>
  );
}

/** Vitesse du défilement, en pixels par seconde : assez lente pour se lire d'un coup d'œil. */
const MARQUEE_SPEED = 28;

/**
 * Une ligne qui **défile si elle ne tient pas** (demande explicite,
 * 13 octobre 2026 : « Mr. Jambo… » ne disait pas quelle chanson jouait).
 *
 * Un aller-retour, avec une pause à chaque bout, plutôt qu'une boucle sans
 * fin : le début du titre — ce qu'on reconnaît — reste à l'écran le plus
 * longtemps. Un texte qui tient ne bouge pas, et rien ne bouge non plus si
 * l'appareil demande moins d'animations (voir la feuille de style).
 */
function Marquee({ text, className }: { text: string; className: string }) {
  const outer = useRef<HTMLSpanElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);

  useLayoutEffect(() => {
    const measure = () => {
      if (!outer.current || !inner.current) return;
      setOverflow(Math.max(0, Math.ceil(inner.current.scrollWidth - outer.current.clientWidth)));
    };
    measure();
    // La place change quand l'écran tourne ou que la fenêtre est redimensionnée.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (outer.current) observer?.observe(outer.current);
    return () => observer?.disconnect();
  }, [text]);

  return (
    <span ref={outer} className={`${className} marquee ${overflow ? "is-scrolling" : ""}`} title={text}>
      <span
        ref={inner}
        className="marquee-inner"
        style={
          overflow
            ? ({ "--marquee-shift": `-${overflow}px`, "--marquee-time": `${Math.max(4, overflow / MARQUEE_SPEED + 3)}s` } as React.CSSProperties)
            : undefined
        }
      >
        {text}
      </span>
    </span>
  );
}
