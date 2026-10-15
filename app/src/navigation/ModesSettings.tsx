import type { LucideIcon } from "lucide-react";
import { Activity, BellRing, Bike, Car, Flag, Footprints, ListOrdered, Music, TramFront } from "lucide-react";
import { openExactAlarmSettings, useGetOffStatus } from "./getOffAlert";
import {
  setGetOffAlertEnabled,
  useGetOffAlertEnabled,
  setMusicShown,
  useMusicModes,
  type MusicMode,
  setRunModeEnabled,
  setRunSummaryEnabled,
  setTransitStationsEnabled,
  setWalkSummaryEnabled,
  useRunModeEnabled,
  useRunSummaryEnabled,
  useTransitStationsEnabled,
  useWalkSummaryEnabled,
} from "./settings";
import { useNav, type NavKey } from "./strings";

// ---------------------------------------------------------------------------
// Le contenu de la fenêtre « Modes », ouverte depuis le menu burger.
//
// Trois interrupteurs, et chacun ne fait que ce qu'il dit :
//
// - **Mode course** : le bouton orange apparaît ou non. Le couper pendant une
//   course ne l'interrompt pas — il ne s'agit que du bouton de lancement.
// - **Résumé après une marche / une course** : la fiche de fin s'ouvre ou non.
//   **Le trajet s'enregistre dans les deux cas** (demande explicite) : on
//   choisit ce qui s'affiche, pas ce qui se garde — la conservation se règle
//   dans les paramètres.
// - **Lecteur de musique** : une pastille par navigation, allumée ou non
//   (demande explicite : « pas une liste à cocher, un truc sympa »).
// ---------------------------------------------------------------------------

export function ModesSettings() {
  const runMode = useRunModeEnabled();
  const walkSummary = useWalkSummaryEnabled();
  const runSummary = useRunSummaryEnabled();
  const transitStations = useTransitStationsEnabled();

  return (
    <div className="modes-list">
      {/* La version Docker n'a pas de mode course (`__RUN_MODE__`). */}
      {__RUN_MODE__ && (
        <ModeRow
          icon={Activity}
          label="modes.run"
          hint="modes.run.hint"
          checked={runMode}
          onChange={setRunModeEnabled}
        />
      )}
      <ModeRow
        icon={Footprints}
        label="modes.walkSummary"
        hint="modes.walkSummary.hint"
        checked={walkSummary}
        onChange={setWalkSummaryEnabled}
      />
      {/* En transports : les stations de la ligne en cours, sous le bandeau du
          bas (demande explicite, 13 octobre 2026). */}
      <ModeRow
        icon={ListOrdered}
        label="modes.transitStations"
        hint="modes.transitStations.hint"
        checked={transitStations}
        onChange={setTransitStationsEnabled}
      />
      <GetOffRow />
      <MusicModes />
      {__RUN_MODE__ && (
        <ModeRow
          icon={Flag}
          label="modes.runSummary"
          hint="modes.runSummary.hint"
          checked={runSummary}
          onChange={setRunSummaryEnabled}
        />
      )}
    </div>
  );
}

/**
 * L'alerte de descente, et ce qui l'empêcherait de marcher : « Alarmes et
 * rappels » refusé (elle peut tomber en retard) ou notifications coupées (elle
 * vibre sans dire où). Ces lignes n'existent que dans l'APK, réglage allumé.
 */
function GetOffRow() {
  const { nav } = useNav();
  const on = useGetOffAlertEnabled();
  const status = useGetOffStatus();
  return (
    <div className="modes-group">
      <ModeRow icon={BellRing} label="modes.getOff" hint="modes.getOff.hint" checked={on} onChange={setGetOffAlertEnabled} />
      {on && status && !status.exact && (
        <button className="modes-warning" onClick={openExactAlarmSettings}>
          {nav("modes.getOff.exact")}
        </button>
      )}
      {on && status && !status.notifications && <p className="modes-warning">{nav("modes.getOff.notifications")}</p>}
    </div>
  );
}

const MUSIC_MODES: { mode: MusicMode; icon: LucideIcon; label: NavKey }[] = [
  { mode: "walking", icon: Footprints, label: "modes.music.walking" },
  { mode: "cycling", icon: Bike, label: "modes.music.cycling" },
  { mode: "car", icon: Car, label: "modes.music.car" },
  { mode: "transit", icon: TramFront, label: "modes.music.transit" },
  // La version Docker n'a pas de mode course (`__RUN_MODE__`).
  ...(__RUN_MODE__ ? [{ mode: "running" as const, icon: Activity, label: "modes.music.running" as const }] : []),
];

/**
 * L'encart de musique, navigation par navigation : une rangée de pastilles qui
 * s'allument d'un toucher. Le curseur de la ligne les allume ou les éteint
 * toutes, et se met à mi-course quand certaines seulement le sont.
 */
function MusicModes() {
  const { nav } = useNav();
  const on = useMusicModes();
  const shown = MUSIC_MODES.map(({ mode }) => on.has(mode));
  const count = shown.filter(Boolean).length;
  const all = count === MUSIC_MODES.length;
  const state = all ? "is-all" : count ? "is-some" : "";
  return (
    <div className="modes-group">
      <button
        className="modes-row"
        onClick={() => MUSIC_MODES.forEach(({ mode }) => setMusicShown(mode, !all))}
        role="switch"
        aria-checked={all ? true : count ? "mixed" : false}
      >
        <span className="modes-row-text">
          <span className="modes-row-label">
            <Music size={16} />
            {nav("modes.music")}
          </span>
          <span className="modes-row-hint">{nav("modes.music.hint")}</span>
        </span>
        <span className={`toggle-switch ${state}`} aria-hidden="true">
          <span className="toggle-switch-knob" />
        </span>
      </button>
      <div className="music-modes">
        {MUSIC_MODES.map(({ mode, icon: Icon, label }, rank) => (
          <button
            key={mode}
            className={`music-mode ${shown[rank] ? "is-on" : ""}`}
            onClick={() => setMusicShown(mode, !shown[rank])}
            aria-pressed={shown[rank]}
          >
            <span className="music-mode-icon">
              <Icon size={20} />
            </span>
            {nav(label)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Une ligne : pictogramme, libellé, phrase d'aide, et le curseur à droite. */
function ModeRow(props: {
  icon: LucideIcon;
  label: NavKey;
  hint: NavKey;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  const { nav } = useNav();
  const Icon = props.icon;
  return (
    <button className="modes-row" onClick={() => props.onChange(!props.checked)} role="switch" aria-checked={props.checked}>
      <span className="modes-row-text">
        <span className="modes-row-label">
          <Icon size={16} />
          {nav(props.label)}
        </span>
        <span className="modes-row-hint">{nav(props.hint)}</span>
      </span>
      {/* Le curseur partagé avec le menu des calques (`map-options.css`). */}
      <span className={`toggle-switch ${props.checked ? "is-on" : ""}`} aria-hidden="true">
        <span className="toggle-switch-knob" />
      </span>
    </button>
  );
}
