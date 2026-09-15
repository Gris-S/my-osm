import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { useNav } from "../strings";
import { getMusicAccess, hasNowPlaying, openMusicAccessSettings } from "./nowPlaying";

// ---------------------------------------------------------------------------
// « Musique pendant le guidage », dans la section Navigation des paramètres.
//
// Ce n'est pas un interrupteur de l'encart — il n'en a pas, il apparaît seul
// quand de la musique joue. C'est l'endroit où l'on accorde, **une fois**,
// l'accès qu'Android exige pour voir les lecteurs : « Accès aux notifications ».
// Sans lui, l'encart n'apparaît jamais, et rien d'autre ne le dirait.
//
// L'état est relu au retour dans l'application : l'autorisation se donne dans
// les réglages du téléphone, hors de la page.
// ---------------------------------------------------------------------------

type Access = "web" | "checking" | "granted" | "missing";

export function MusicSettings() {
  const { nav } = useNav();
  const [access, setAccess] = useState<Access>(() => (hasNowPlaying() ? "checking" : "web"));

  useEffect(() => {
    if (!hasNowPlaying()) return;
    let cancelled = false;
    const check = () => {
      void getMusicAccess().then((granted) => {
        if (!cancelled) setAccess(granted ? "granted" : "missing");
      });
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    check();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return (
    <>
      <span className="settings-field-label nav-settings-second">{nav("settings.music")}</span>
      {access === "missing" && (
        <button className="nav-settings-button" onClick={openMusicAccessSettings}>
          {nav("settings.music.grant")}
        </button>
      )}
      {access === "granted" && (
        <div className="nav-settings-row">
          <p className="nav-settings-status">
            <Check size={15} />
            {nav("settings.music.granted")}
          </p>
          {/* Retirer l'accès : il ne figure pas dans la page « Autorisations »
              de l'application, Android le range à part (« Accès spécial des
              applications »). Le même bouton y mène directement. */}
          <button className="nav-settings-link" onClick={openMusicAccessSettings}>
            {nav("settings.music.manage")}
          </button>
        </div>
      )}
      {access !== "checking" && (
        <p className="settings-hint">
          {nav(
            access === "web"
              ? "settings.music.hint.web"
              : access === "granted"
                ? "settings.music.hint.granted"
                : "settings.music.hint.missing"
          )}
        </p>
      )}
    </>
  );
}
