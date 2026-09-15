import { Compass } from "lucide-react";
import {
  setHistoryRetention,
  setNavCameraMode,
  useHistoryRetention,
  useNavCameraMode,
  type HistoryRetention,
  type NavCameraMode,
} from "./settings";
import { clearTrips, purgeTrips } from "./history";
import { MusicSettings } from "./music/MusicSettings";
import { useNav } from "./strings";

// ---------------------------------------------------------------------------
// La section « Navigation » de la fenêtre des paramètres.
//
// Elle est ici, et non dans `AppMenu`, pour la même raison que le bouton
// « Démarrer » : retirer le dossier ne doit laisser qu'une ligne à défaire dans
// la fenêtre, pas un bloc de rendu et une poignée de clés de traduction.
//
// Chaque choix porte sa phrase d'aide : « adaptatif » et « fixe » ne
// s'expliquent pas d'eux-mêmes, et le réglage se prend le plus souvent avant de
// partir, sans pouvoir le comparer. Il s'applique néanmoins à un guidage en
// cours — les menus restent ouverts en marchant.
// ---------------------------------------------------------------------------

const MODES: NavCameraMode[] = ["adaptive", "fixed"];

/**
 * Du plus permissif au plus strict : « sans limite » d'abord, parce que c'est
 * le défaut et ce que la plupart voudront, « ne rien enregistrer » en dernier,
 * parce que c'est le choix qui efface.
 */
const RETENTIONS: HistoryRetention[] = [
  "never",
  "year",
  "6months",
  "3months",
  "month",
  "week",
  "day",
  "off",
];

const RETENTION_LABEL: Record<HistoryRetention, string> = {
  never: "settings.retention.never",
  year: "settings.retention.year",
  "6months": "settings.retention.6months",
  "3months": "settings.retention.3months",
  month: "settings.retention.month",
  week: "settings.retention.week",
  day: "settings.retention.day",
  off: "settings.retention.off",
};

export function NavigationSettings() {
  const { nav } = useNav();
  const mode = useNavCameraMode();
  const retention = useHistoryRetention();

  /**
   * Le choix s'applique **tout de suite** à ce qui est déjà enregistré, et pas
   * seulement aux trajets à venir : ramener la conservation à une semaine sans
   * toucher aux trajets de l'an dernier ne répondrait pas à la demande, et
   * « ne rien enregistrer » serait une promesse creuse tant que l'historique
   * existant resterait consultable.
   */
  function changeRetention(next: HistoryRetention) {
    setHistoryRetention(next);
    void (next === "off" ? clearTrips() : purgeTrips()).catch(() => {
      /* base indisponible : le réglage reste pris, la purge se refera */
    });
  }

  return (
    <div className="settings-field nav-settings">
      <h3 className="nav-settings-title">
        <Compass size={14} />
        {nav("settings.section")}
      </h3>

      <label className="settings-field-label" htmlFor="nav-camera-mode">
        {nav("settings.camera")}
      </label>
      <select
        id="nav-camera-mode"
        className="nav-settings-select"
        value={mode}
        onChange={(e) => setNavCameraMode(e.target.value as NavCameraMode)}
      >
        {MODES.map((id) => (
          <option key={id} value={id}>
            {nav(id === "adaptive" ? "settings.camera.adaptive" : "settings.camera.fixed")}
          </option>
        ))}
      </select>

      <p className="settings-hint">
        {nav(mode === "adaptive" ? "settings.camera.hint.adaptive" : "settings.camera.hint.fixed")}
      </p>

      <label className="settings-field-label nav-settings-second" htmlFor="nav-retention">
        {nav("settings.retention")}
      </label>
      <select
        id="nav-retention"
        className="nav-settings-select"
        value={retention}
        onChange={(e) => changeRetention(e.target.value as HistoryRetention)}
      >
        {RETENTIONS.map((id) => (
          <option key={id} value={id}>
            {nav(RETENTION_LABEL[id] as Parameters<typeof nav>[0])}
          </option>
        ))}
      </select>
      <p className="settings-hint">
        {nav(
          retention === "never"
            ? "settings.retention.hint.never"
            : retention === "off"
              ? "settings.retention.hint.off"
              : "settings.retention.hint.span"
        )}
      </p>

      <MusicSettings />
    </div>
  );
}
