import { useEffect, useRef, useState } from "react";
import { Bike, LifeBuoy, ShieldCheck, Zap, type LucideIcon } from "lucide-react";
import { setBikeSettings, useBikeSettings } from "../services/bikeSettings";
import { useI18n, type TranslationKey } from "../i18n";
import { useLatest } from "../hooks/useLatest";

// ---------------------------------------------------------------------------
// La section « Vélo » de la fenêtre des paramètres : ce qui oriente le calcul
// d'un itinéraire à vélo (`services/bikeSettings.ts`).
//
// Elle est hors de `src/navigation/`, comme le réglage lui-même : le panneau
// d'itinéraire s'en sert aussi, et retirer la navigation ne doit pas priver le
// vélo de ses préférences.
//
// Un itinéraire déjà affiché se recalcule à chaque changement (`useItinerary`
// s'abonne au magasin) : on voit tout de suite ce que le réglage change.
// ---------------------------------------------------------------------------

export function BikeSettings() {
  const { t } = useI18n();
  const settings = useBikeSettings();

  return (
    <div className="settings-field bike-settings">
      <h3 className="bike-settings-title">
        <Bike size={14} />
        {t("bike.section")}
      </h3>

      <Slider
        id="bike-avoid-traffic"
        label={t("bike.avoidTraffic")}
        low={t("bike.avoidTraffic.low")}
        high={t("bike.avoidTraffic.high")}
        value={settings.safety ? 1 : settings.avoidTraffic}
        // La sécurité force le curseur à son maximum : il reste visible, mais
        // figé, pour qu'on comprenne pourquoi il ne bouge plus.
        disabled={settings.safety}
        onChange={(avoidTraffic) => setBikeSettings({ avoidTraffic })}
      />

      <Slider
        id="bike-avoid-hills"
        label={t("bike.avoidHills")}
        low={t("bike.avoidHills.low")}
        high={t("bike.avoidHills.high")}
        value={settings.avoidHills}
        onChange={(avoidHills) => setBikeSettings({ avoidHills })}
      />

      <Row
        icon={Zap}
        label="bike.electric"
        hint="bike.electric.hint"
        checked={settings.electric}
        onChange={(electric) => setBikeSettings({ electric })}
      />
      <Row
        icon={ShieldCheck}
        label="bike.safety"
        hint="bike.safety.hint"
        checked={settings.safety}
        onChange={(safety) => setBikeSettings({ safety })}
      />
      <Row
        icon={LifeBuoy}
        label="bike.fallback"
        hint="bike.fallback.hint"
        checked={settings.allowFallback}
        onChange={(allowFallback) => setBikeSettings({ allowFallback })}
      />
    </div>
  );
}

/**
 * Un curseur de 0 à 1, par dixièmes, avec ses deux bouts nommés.
 *
 * Le réglage n'est pris qu'**une fois le curseur posé** (un demi-temps sans
 * mouvement) : chaque cran relancerait sinon un calcul d'itinéraire, et le
 * serveur public n'en accepte qu'un par seconde.
 */
function Slider(props: {
  id: string;
  label: string;
  low: string;
  high: string;
  value: number;
  disabled?: boolean;
  onChange: (next: number) => void;
}) {
  // Le brouillon n'existe que pendant qu'on fait glisser : `null`, le curseur
  // montre la valeur du magasin. Rien à resynchroniser, donc.
  const [draft, setDraft] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChange = useLatest(props.onChange);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  function move(next: number) {
    setDraft(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      onChange.current(next);
      setDraft(null);
    }, 500);
  }

  // Figé (sécurité), le curseur montre la valeur imposée, pas un brouillon.
  const shown = props.disabled ? props.value : (draft ?? props.value);

  return (
    <div className="bike-slider">
      <label className="settings-field-label" htmlFor={props.id}>
        {props.label}
      </label>
      <input
        id={props.id}
        type="range"
        min={0}
        max={10}
        step={1}
        value={Math.round(shown * 10)}
        disabled={props.disabled}
        onChange={(e) => move(Number(e.target.value) / 10)}
      />
      <span className="bike-slider-ends" aria-hidden="true">
        <span>{props.low}</span>
        <span>{props.high}</span>
      </span>
    </div>
  );
}

/** Une ligne à interrupteur, sur le modèle de la fenêtre « Modes ». */
function Row(props: {
  icon: LucideIcon;
  label: TranslationKey;
  hint: TranslationKey;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
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
