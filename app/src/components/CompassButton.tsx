import { memo } from "react";
import { useI18n } from "../i18n";

// ---------------------------------------------------------------------------
// Boussole (sous l'encart météo, en haut à droite).
//
// Elle fait deux choses d'un seul objet : elle **dit** où est le nord, et un
// clic **y ramène** la carte. C'est ce qui justifie qu'elle reste visible même
// carte au nord — un bouton qui n'apparaît qu'une fois la carte tournée ne se
// laisse pas chercher, et l'aiguille reste une indication utile en 3D, où
// l'inclinaison brouille les repères.
// ---------------------------------------------------------------------------

interface CompassButtonProps {
  /** Orientation de la carte en degrés, au sens de MapLibre : le cap affiché
   *  vers le haut de l'écran. 0 = nord en haut. */
  bearing: number;
  onClick: () => void;
}

// Protégé contre les rendus inutiles (`memo`) : `App` se redessine à chaque
// relevé GPS d'une navigation, et ce composant n'a alors rien de neuf à montrer.
export const CompassButton = memo(function CompassButton({ bearing, onClick }: CompassButtonProps) {
  const { t } = useI18n();
  // L'aiguille montre le nord **à l'écran** : la carte tournée de `bearing`
  // vers la droite, le nord se trouve d'autant vers la gauche.
  const north = -bearing;
  const off = ((bearing % 360) + 360) % 360;
  const aligned = off < 0.5 || off > 359.5;

  return (
    <button
      className={`compass-button ${aligned ? "is-aligned" : ""}`}
      onClick={onClick}
      aria-label={t("compass.aria")}
      title={aligned ? t("compass.aligned") : t("compass.aria")}
    >
      {/* Aiguille à deux pans, comme sur une rose des vents : le pan rouge
          pointe le nord, le gris le sud. Un simple triangle se lirait comme une
          flèche de direction — celle de la position, déjà présente sur la
          carte. */}
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        aria-hidden="true"
        style={{ transform: `rotate(${north}deg)` }}
      >
        <path d="M12 2.5 L16 13 L12 11 L8 13 Z" fill="#FF3B30" />
        <path d="M12 21.5 L8 11 L12 13 L16 11 Z" fill="currentColor" />
      </svg>
    </button>
  );
});
