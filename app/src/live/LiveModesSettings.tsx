import { Bike, Fuel } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useI18n, type TranslationKey } from "../i18n";
import { fuelLabel } from "./labels";
import {
  FUEL_TYPES,
  setBikesModeEnabled,
  setFuelLayerOn,
  setFuelModeEnabled,
  setFuelType,
  useBikesModeEnabled,
  useFuelModeEnabled,
  useFuelType,
  type FuelType,
} from "./settings";

// ---------------------------------------------------------------------------
// Les deux modes en direct, dans la fenêtre « Modes » : même ligne et même
// curseur que ses autres interrupteurs. Le carburant ne se choisit qu'ici
// (demande explicite), électrique compris.
// ---------------------------------------------------------------------------

function Row(props: { icon: LucideIcon; label: TranslationKey; hint: TranslationKey; checked: boolean; onChange: (next: boolean) => void }) {
  const { t } = useI18n();
  const Icon = props.icon;
  return (
    <button className="modes-row" onClick={() => props.onChange(!props.checked)} role="switch" aria-checked={props.checked}>
      <span className="modes-row-text">
        <span className="modes-row-label">
          <Icon size={16} />
          {t(props.label)}
        </span>
        <span className="modes-row-hint">{t(props.hint)}</span>
      </span>
      <span className={`toggle-switch ${props.checked ? "is-on" : ""}`} aria-hidden="true">
        <span className="toggle-switch-knob" />
      </span>
    </button>
  );
}

export function LiveModesSettings() {
  const { t } = useI18n();
  const bikes = useBikesModeEnabled();
  const fuel = useFuelModeEnabled();
  const fuelType = useFuelType();
  return (
    <div className="modes-list">
      <Row icon={Bike} label="live.bikes" hint="live.bikes.hint" checked={bikes} onChange={setBikesModeEnabled} />
      <Row
        icon={Fuel}
        label="live.fuel"
        hint="live.fuel.hint"
        checked={fuel}
        onChange={(next) => {
          setFuelModeEnabled(next);
          // Allumer le mode montre aussitôt le calque : sinon rien ne dirait qu'il a marché.
          if (next) setFuelLayerOn(true);
        }}
      />
      {fuel && (
        <div className="live-fuel-choice">
          <label className="settings-field-label" htmlFor="live-fuel-type">
            {t("live.fuelType")}
          </label>
          <select
            id="live-fuel-type"
            className="live-select"
            value={fuelType}
            onChange={(e) => setFuelType(e.target.value as FuelType)}
          >
            {FUEL_TYPES.map((id) => (
              <option key={id} value={id}>
                {t(fuelLabel(id))}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
