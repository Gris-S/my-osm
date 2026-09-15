import { useState } from "react";
import { Music, Pause, Play, SkipBack, SkipForward, X } from "lucide-react";
import { useNav } from "../strings";
import { controlMusic, useNowPlaying } from "./nowPlaying";

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
      {track.artwork ? (
        <img className="music-art" src={track.artwork} alt="" />
      ) : (
        <span className="music-art is-empty">
          <Music size={22} />
        </span>
      )}

      <div className="music-text">
        <span className="music-title">{track.title || track.artist}</span>
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
