import { useEffect, useRef } from "react";
import { useI18n } from "../i18n";

// ---------------------------------------------------------------------------
// Le jour et l'heure de « Partir plus tard », dessinés par l'application.
//
// Les champs `date` et `time` ouvraient le calendrier et l'horloge d'Android,
// qui suivent le thème du téléphone et non celui de l'application : la nuit,
// la grille du mois s'écrivait en blanc sur blanc (captures du 15 octobre
// 2026). Demande explicite : un sélecteur à nous, au thème de l'application,
// le même dans l'APK et dans la version Docker.
//
// - **Les jours** : une rangée de pastilles, « Aujourd'hui », « Demain », puis
//   la semaine qui suit. Un trajet en transports se prévoit rarement plus loin.
// - **L'heure** : deux roues, heures et minutes par cinq, qu'on fait défiler du
//   pouce ; la valeur sous la bande du milieu est la valeur retenue. Toucher
//   une valeur l'amène au milieu.
// ---------------------------------------------------------------------------

/** Jours proposés, aujourd'hui compris. */
const DAYS = 8;
/** Hauteur d'une valeur des roues, en pixels : la même que dans la feuille de style. */
const ROW = 36;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const MINUTES = Array.from({ length: 12 }, (_, step) => step * 5);

export function WhenAt({ at, onChange }: { at: number; onChange: (at: number) => void }) {
  const { t, locale } = useI18n();
  const chosen = new Date(at);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Array.from({ length: DAYS }, (_, offset) => {
    const day = new Date(today);
    day.setDate(today.getDate() + offset);
    return day;
  });
  const dayFormat = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric" });

  const set = (day: Date, hour: number, minute: number) => {
    const next = new Date(day);
    next.setHours(hour, minute, 0, 0);
    if (next.getTime() !== at) onChange(next.getTime());
  };
  // Une heure qui ne tombe pas sur cinq minutes (venue d'ailleurs) se montre à
  // la tranche la plus proche.
  const minute = Math.min(55, Math.round(chosen.getMinutes() / 5) * 5);

  return (
    <div className="when-at">
      <div className="when-days" role="radiogroup" aria-label={t("itinerary.when.day")}>
        {days.map((day, offset) => {
          const active = day.toDateString() === chosen.toDateString();
          return (
            <button
              key={day.getTime()}
              role="radio"
              aria-checked={active}
              className={`when-day ${active ? "is-active" : ""}`}
              onClick={() => set(day, chosen.getHours(), minute)}
            >
              {offset === 0 ? t("itinerary.when.today") : offset === 1 ? t("itinerary.when.tomorrow") : dayFormat.format(day)}
            </button>
          );
        })}
      </div>
      <div className="when-clock" aria-label={t("itinerary.when.time")}>
        <Wheel
          values={HOURS}
          value={chosen.getHours()}
          label={t("itinerary.when.hours")}
          onPick={(hour) => set(chosen, hour, minute)}
        />
        <span className="when-colon" aria-hidden="true">
          :
        </span>
        <Wheel values={MINUTES} value={minute} label={t("itinerary.when.minutes")} onPick={(next) => set(chosen, chosen.getHours(), next)} />
      </div>
    </div>
  );
}

/**
 * Une roue : une colonne qui défile et s'arrête sur une valeur
 * (`scroll-snap`), la valeur du milieu étant la retenue. Elle se règle sur
 * `value` quand celle-ci change d'ailleurs, et ne rend la sienne qu'une fois le
 * défilement arrêté : en cours de geste, chaque valeur traversée relancerait
 * un calcul d'itinéraire.
 */
function Wheel({
  values,
  value,
  label,
  onPick,
}: {
  values: number[];
  value: number;
  label: string;
  onPick: (value: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const settle = useRef(0);
  const index = Math.max(0, values.indexOf(value));

  useEffect(() => {
    const wheel = ref.current;
    if (wheel && Math.round(wheel.scrollTop / ROW) !== index) wheel.scrollTo({ top: index * ROW });
  }, [index]);

  useEffect(() => () => window.clearTimeout(settle.current), []);

  const onScroll = () => {
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => {
      const wheel = ref.current;
      if (!wheel) return;
      const picked = values[Math.max(0, Math.min(values.length - 1, Math.round(wheel.scrollTop / ROW)))];
      if (picked !== value) onPick(picked);
    }, 150);
  };

  return (
    <div className="when-wheel" ref={ref} onScroll={onScroll} role="listbox" aria-label={label}>
      {values.map((option, rank) => (
        <button
          key={option}
          role="option"
          aria-selected={rank === index}
          className={`when-wheel-value ${rank === index ? "is-active" : ""}`}
          onClick={() => ref.current?.scrollTo({ top: rank * ROW, behavior: "smooth" })}
        >
          {String(option).padStart(2, "0")}
        </button>
      ))}
    </div>
  );
}
