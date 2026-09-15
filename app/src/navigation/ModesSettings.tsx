import type { LucideIcon } from "lucide-react";
import { Activity, Flag, Footprints } from "lucide-react";
import {
  setRunModeEnabled,
  setRunSummaryEnabled,
  setWalkSummaryEnabled,
  useRunModeEnabled,
  useRunSummaryEnabled,
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
// ---------------------------------------------------------------------------

export function ModesSettings() {
  const runMode = useRunModeEnabled();
  const walkSummary = useWalkSummaryEnabled();
  const runSummary = useRunSummaryEnabled();

  return (
    <div className="modes-list">
      <ModeRow
        icon={Activity}
        label="modes.run"
        hint="modes.run.hint"
        checked={runMode}
        onChange={setRunModeEnabled}
      />
      <ModeRow
        icon={Footprints}
        label="modes.walkSummary"
        hint="modes.walkSummary.hint"
        checked={walkSummary}
        onChange={setWalkSummaryEnabled}
      />
      <ModeRow
        icon={Flag}
        label="modes.runSummary"
        hint="modes.runSummary.hint"
        checked={runSummary}
        onChange={setRunSummaryEnabled}
      />
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
