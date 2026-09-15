import { useId, useMemo, useState } from "react";
import { formatDistance } from "../utils/format";
import type { ElevationProfile as Profile } from "./elevation";
import { useNav } from "./strings";

// ---------------------------------------------------------------------------
// Le profil du dénivelé, en SVG.
//
// Une seule série — l'altitude le long du parcours — donc **pas de légende** :
// le titre la nomme. Ce qui est encodé en couleur n'est pas une identité mais
// un état : ce qui est **parcouru** passe à l'encre grise, ce qui **reste** garde
// la couleur de l'itinéraire. C'est la seule question qu'on se pose en marchant
// — ce qui reste à monter — et elle se lit d'un coup d'œil, sans lire un chiffre.
//
// L'échelle verticale ne part pas de zéro, comme tout profil de randonnée :
// cinquante mètres de dénivelé sur un fond partant du niveau de la mer seraient
// une ligne plate. Les altitudes minimale et maximale sont donc **écrites** sur
// l'axe — c'est ce qui empêche l'échelle serrée d'exagérer une côte sans le dire.
// ---------------------------------------------------------------------------

/** Repères de dessin, dans le repère du `viewBox`. */
const WIDTH = 360;
const HEIGHT = 132;
const PAD_TOP = 16;
const PAD_BOTTOM = 22;
const PAD_LEFT = 34;
const PAD_RIGHT = 8;

const PLOT_WIDTH = WIDTH - PAD_LEFT - PAD_RIGHT;
const PLOT_HEIGHT = HEIGHT - PAD_TOP - PAD_BOTTOM;

interface Props {
  profile: Profile;
  /** Distance déjà parcourue, en mètres : c'est le « vous êtes ici ». */
  traveledMeters: number;
  /** Longueur totale du parcours. */
  totalMeters: number;
  /**
   * Faux pour un trajet terminé, dans l'historique : il n'y a plus d'endroit
   * où l'on serait, et découper le graphe en « fait » et « à faire » n'aurait
   * plus de sens — tout est fait. Le repère disparaît et le relief garde sa
   * couleur d'un bout à l'autre.
   */
  showPosition?: boolean;
}

export function ElevationProfile({
  profile,
  traveledMeters,
  totalMeters,
  showPosition = true,
}: Props) {
  const { nav } = useNav();
  const id = useId();
  // Le relevé survolé, s'il y en a un. Un graphe sans lecture ponctuelle
  // laisse deviner l'altitude d'une bosse ; le doigt et la souris y répondent.
  const [hover, setHover] = useState<number | null>(null);

  const geometry = useMemo(() => build(profile, totalMeters), [profile, totalMeters]);
  const { toX, toY, line, area, low, high } = geometry;

  // Sans repère, tout le tracé est « devant » : il garde d'un bout à l'autre
  // la couleur de l'itinéraire, au lieu de virer au gris du chemin parcouru.
  const hereX = showPosition ? toX(Math.min(traveledMeters, totalMeters)) : toX(0);
  const hereY = toY(elevationAt(profile, traveledMeters));
  const percent = totalMeters > 0 ? Math.round((traveledMeters / totalMeters) * 100) : 0;

  const hovered = hover !== null ? profile.samples[hover] : null;

  function onPointer(event: React.PointerEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    // Le pointeur est en pixels d'écran, le dessin en unités du `viewBox` :
    // le ratio ramène l'un dans l'autre, quelle que soit la largeur du panneau.
    const x = ((event.clientX - box.left) / box.width) * WIDTH;
    const ratio = Math.max(0, Math.min(1, (x - PAD_LEFT) / PLOT_WIDTH));
    setHover(Math.round(ratio * (profile.samples.length - 1)));
  }

  return (
    <div className="nav-profile">
      <div className="nav-profile-stats">
        <span className="nav-profile-stat">
          <b>+{profile.ascent} m</b> {nav("profile.ascent")}
        </span>
        <span className="nav-profile-stat">
          <b>−{profile.descent} m</b> {nav("profile.descent")}
        </span>
        {showPosition && (
          <span className="nav-profile-stat is-muted">{nav("profile.done", { percent })}</span>
        )}
      </div>

      <div className="nav-profile-plot">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="nav-profile-svg"
          role="img"
          aria-label={`${nav("profile.title")} : +${profile.ascent} m / −${profile.descent} m`}
          onPointerMove={onPointer}
          onPointerDown={onPointer}
          onPointerLeave={() => setHover(null)}
        >
          <defs>
            {/* Le dégradé s'éteint vers le bas : l'aire porte l'attention sur
                la silhouette du terrain, pas sur le bloc qu'elle remplit. */}
            <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--nav-profile-ink)" stopOpacity="0.34" />
              <stop offset="100%" stopColor="var(--nav-profile-ink)" stopOpacity="0.04" />
            </linearGradient>
            {/* Deux découpes, une par état : avant le marcheur, après lui. */}
            <clipPath id={`${id}-past`}>
              <rect x={0} y={0} width={hereX} height={HEIGHT} />
            </clipPath>
            <clipPath id={`${id}-ahead`}>
              <rect x={hereX} y={0} width={WIDTH - hereX} height={HEIGHT} />
            </clipPath>
          </defs>

          {/* Ligne de base et graduations : discrètes, elles situent sans se
              disputer la lecture avec le relief. */}
          <line
            x1={PAD_LEFT}
            y1={PAD_TOP + PLOT_HEIGHT}
            x2={WIDTH - PAD_RIGHT}
            y2={PAD_TOP + PLOT_HEIGHT}
            className="nav-profile-axis"
          />
          <line
            x1={PAD_LEFT}
            y1={PAD_TOP}
            x2={WIDTH - PAD_RIGHT}
            y2={PAD_TOP}
            className="nav-profile-grid"
          />

          <g clipPath={`url(#${id}-past)`} className="is-past">
            <path d={area} className="nav-profile-area" />
            <path d={line} className="nav-profile-line" vectorEffect="non-scaling-stroke" />
          </g>
          <g clipPath={`url(#${id}-ahead)`} className="is-ahead">
            <path d={area} className="nav-profile-area" fill={`url(#${id}-fill)`} />
            <path d={line} className="nav-profile-line" vectorEffect="non-scaling-stroke" />
          </g>

          {/* Le point haut, nommé : c'est le seul relevé qui mérite son
              étiquette — écrire l'altitude de chaque point ferait une frise de
              chiffres illisible. */}
          <text x={PAD_LEFT - 6} y={PAD_TOP + 4} className="nav-profile-tick" textAnchor="end">
            {Math.round(high)}
          </text>
          <text
            x={PAD_LEFT - 6}
            y={PAD_TOP + PLOT_HEIGHT}
            className="nav-profile-tick"
            textAnchor="end"
          >
            {Math.round(low)}
          </text>

          {/* Là où l'on se trouve : le trait descend jusqu'au sol, la pastille
              se pose sur le terrain. L'anneau clair la détache du relief quelle
              que soit la pente sous elle. */}
          {showPosition && (
            <>
              <line
                x1={hereX}
                y1={PAD_TOP - 4}
                x2={hereX}
                y2={PAD_TOP + PLOT_HEIGHT}
                className="nav-profile-here-line"
                vectorEffect="non-scaling-stroke"
              />
              <circle cx={hereX} cy={hereY} r={5} className="nav-profile-here-dot" />
            </>
          )}

          {hovered && (
            <line
              x1={toX(hovered.atMeters)}
              y1={PAD_TOP - 4}
              x2={toX(hovered.atMeters)}
              y2={PAD_TOP + PLOT_HEIGHT}
              className="nav-profile-cursor"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>

        {hovered && (
          <div
            className="nav-profile-tooltip"
            style={{ left: `${(toX(hovered.atMeters) / WIDTH) * 100}%` }}
          >
            <b>{Math.round(hovered.elevation)} m</b>
            <span>{formatDistance(hovered.atMeters)}</span>
          </div>
        )}
      </div>

      <div className="nav-profile-axis-labels">
        <span>{nav("profile.axisStart")}</span>
        <span className="is-muted">{formatDistance(totalMeters)}</span>
        <span>{nav("profile.axisEnd")}</span>
      </div>
    </div>
  );
}

interface Geometry {
  toX: (meters: number) => number;
  toY: (elevation: number) => number;
  line: string;
  area: string;
  low: number;
  high: number;
}

/**
 * Les deux tracés et les échelles.
 *
 * Le domaine vertical est **élargi d'un dixième de part et d'autre**, et d'au
 * moins vingt mètres : sans cette marge, un parcours plat collerait sa ligne
 * au bord du cadre, et le moindre creux du modèle d'altitude prendrait
 * l'allure d'un ravin.
 */
function build(profile: Profile, totalMeters: number): Geometry {
  const span = Math.max(20, profile.maxElevation - profile.minElevation);
  const low = profile.minElevation - span * 0.1;
  const high = profile.maxElevation + span * 0.1;

  const toX = (meters: number) =>
    PAD_LEFT + (totalMeters > 0 ? Math.max(0, Math.min(1, meters / totalMeters)) : 0) * PLOT_WIDTH;
  const toY = (elevation: number) =>
    PAD_TOP + PLOT_HEIGHT - ((elevation - low) / (high - low)) * PLOT_HEIGHT;

  const points = profile.samples.map((s) => `${toX(s.atMeters).toFixed(1)},${toY(s.elevation).toFixed(1)}`);
  const line = `M${points.join(" L")}`;
  const baseline = PAD_TOP + PLOT_HEIGHT;
  const area = `${line} L${toX(totalMeters).toFixed(1)},${baseline} L${PAD_LEFT},${baseline} Z`;

  return { toX, toY, line, area, low, high };
}

/** L'altitude à cette distance du départ, interpolée entre deux relevés. */
function elevationAt(profile: Profile, atMeters: number): number {
  const { samples } = profile;
  if (!samples.length) return 0;
  if (atMeters <= samples[0].atMeters) return samples[0].elevation;
  const last = samples[samples.length - 1];
  if (atMeters >= last.atMeters) return last.elevation;
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i];
    const b = samples[i + 1];
    if (atMeters <= b.atMeters) {
      const span = b.atMeters - a.atMeters;
      const t = span > 0 ? (atMeters - a.atMeters) / span : 0;
      return a.elevation + (b.elevation - a.elevation) * t;
    }
  }
  return last.elevation;
}
