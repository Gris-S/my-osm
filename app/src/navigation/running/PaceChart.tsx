import { useMemo } from "react";
import type { RunSample } from "../history";
import { useNav, type NavKey } from "../strings";
import { formatPace } from "../trip";
import { paceSeries, regularity } from "./run";

// ---------------------------------------------------------------------------
// Le graphe de l'allure : est-on resté régulier ?
//
// **L'axe vertical est inversé** — le plus rapide en haut — parce qu'une allure
// se compte en minutes par kilomètre : un chiffre qui baisse est une bonne
// nouvelle, et un graphe où la bonne nouvelle descend se lit à contresens.
//
// La moyenne est une ligne pointillée : c'est la référence à laquelle l'œil
// compare chaque tronçon. Le domaine est bâti sur les allures **usuelles** (du
// 5ᵉ au 95ᵉ centile) : un arrêt au feu rouge sans pause produirait sinon une
// pointe qui écraserait tout le reste du graphe contre un bord.
// ---------------------------------------------------------------------------

const WIDTH = 360;
const HEIGHT = 150;
const PAD_TOP = 12;
const PAD_BOTTOM = 22;
const PAD_LEFT = 44;
const PAD_RIGHT = 8;
const PLOT_WIDTH = WIDTH - PAD_LEFT - PAD_RIGHT;
const PLOT_HEIGHT = HEIGHT - PAD_TOP - PAD_BOTTOM;

export function PaceChart({ samples, totalMeters }: { samples: RunSample[]; totalMeters: number }) {
  const { nav } = useNav();
  const series = useMemo(() => paceSeries(samples, totalMeters), [samples, totalMeters]);

  if (series.length < 2) {
    return (
      <div className="run-chart">
        <p className="run-chart-empty">{nav("run.chartTooShort")}</p>
      </div>
    );
  }

  const values = series.map((point) => point.secondsPerKm);
  const sorted = [...values].sort((a, b) => a - b);
  const q05 = sorted[Math.floor((sorted.length - 1) * 0.05)];
  const q95 = sorted[Math.ceil((sorted.length - 1) * 0.95)];
  const span = Math.max(30, q95 - q05);
  const fast = Math.max(60, q05 - span * 0.2);
  const slow = q95 + span * 0.2;

  const last = samples[samples.length - 1];
  const mean = last && last.d > 0 ? last.t / (last.d / 1000) : values.reduce((a, b) => a + b, 0) / values.length;

  const toX = (meters: number) => PAD_LEFT + (Math.min(meters, totalMeters) / totalMeters) * PLOT_WIDTH;
  const toY = (secondsPerKm: number) =>
    PAD_TOP + ((Math.min(Math.max(secondsPerKm, fast), slow) - fast) / (slow - fast)) * PLOT_HEIGHT;

  const line = series
    .map((point, index) => `${index ? "L" : "M"}${toX(point.atMeters).toFixed(1)},${toY(point.secondsPerKm).toFixed(1)}`)
    .join(" ");
  const first = series[0];
  const final = series[series.length - 1];
  const bottom = PAD_TOP + PLOT_HEIGHT;
  const area = `${line} L${toX(final.atMeters).toFixed(1)},${bottom} L${toX(first.atMeters).toFixed(1)},${bottom} Z`;

  // Un repère par kilomètre, ou par deux, cinq au-delà de dix et vingt km.
  const km = totalMeters / 1000;
  const step = km <= 8 ? 1 : km <= 20 ? 2 : 5;
  const ticks: number[] = [];
  for (let k = step; k < km; k += step) ticks.push(k);

  const steady = regularity(series);
  const meanY = toY(mean);

  return (
    <div className="run-chart">
      <div className="run-chart-head">
        <span className="run-chart-title">{nav("run.paceChart")}</span>
        {steady && (
          <span className={`run-chart-regularity is-${steady.level}`}>
            {nav(`run.regularity.${steady.level}` as NavKey)} · {nav("run.regularityDetail", { seconds: steady.spreadSeconds })}
          </span>
        )}
      </div>

      <svg className="run-chart-svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={nav("run.paceChart")}>
        {ticks.map((k) => (
          <line key={k} className="run-chart-grid" x1={toX(k * 1000)} x2={toX(k * 1000)} y1={PAD_TOP} y2={bottom} />
        ))}
        <path className="run-chart-area" d={area} />
        <line className="run-chart-mean" x1={PAD_LEFT} x2={WIDTH - PAD_RIGHT} y1={meanY} y2={meanY} />
        <path className="run-chart-line" d={line} />
        <line className="run-chart-axis" x1={PAD_LEFT} x2={WIDTH - PAD_RIGHT} y1={bottom} y2={bottom} />

        <text className="run-chart-label" x={PAD_LEFT - 6} y={PAD_TOP + 8} textAnchor="end">
          {formatPace(fast)}
        </text>
        <text className="run-chart-label" x={PAD_LEFT - 6} y={bottom} textAnchor="end">
          {formatPace(slow)}
        </text>
        <text className="run-chart-label is-mean" x={PAD_LEFT - 6} y={meanY + 4} textAnchor="end">
          {formatPace(mean)}
        </text>
        {ticks.map((k) => (
          <text key={`t${k}`} className="run-chart-label" x={toX(k * 1000)} y={HEIGHT - 6} textAnchor="middle">
            {k} km
          </text>
        ))}
      </svg>

      <p className="run-chart-hint">{nav("run.paceChartHint")}</p>
    </div>
  );
}
