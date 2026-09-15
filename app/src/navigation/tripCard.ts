import { formatDistance, formatDuration } from "../utils/format";
import type { Theme } from "../hooks/useTheme";
import type { ElevationSample } from "./elevation";
import type { Trip } from "./history";
import {
  averageSpeed,
  deltaText,
  formatPace,
  formatSpeed,
  pace,
  routeLabel,
  stepsOrigin,
  tripDate,
} from "./trip";
import { navText } from "./strings";
import { RUN_COLOR, RUN_COLOR_DARK } from "./running/run";

// ---------------------------------------------------------------------------
// L'image d'un trajet : tout le bloc du détail, dessiné sur un canvas.
//
// Ce n'est **pas une capture du DOM** — aucune API du navigateur ne sait
// rastériser un morceau de page, et les bibliothèques qui prétendent le faire
// réinterprètent la CSS à leur façon. Le bloc est donc redessiné, à partir des
// mêmes valeurs que l'écran : la date et le parcours, les quatre chiffres, la
// carte (celle-là vraiment capturée, voir `tripShare.ts`) et le profil du
// dénivelé.
//
// Le dessin est fait à deux fois la taille finale puis mis à l'échelle : sur un
// écran de téléphone, une image partagée à un pixel par point paraît floue dès
// qu'on la regarde en plein écran.
// ---------------------------------------------------------------------------

/** Largeur de l'image, en points (le canvas fait le double). */
const WIDTH = 900;
const SCALE = 2;

const PAD = 44;
const MAP_HEIGHT = 420;
const PROFILE_HEIGHT = 190;
const RADIUS = 22;

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

interface Palette {
  background: string;
  card: string;
  text: string;
  muted: string;
  accent: string;
  good: string;
  bad: string;
  hairline: string;
}

/** Les couleurs de l'application, reprises telles quelles (voir `base.css`). */
function paletteFor(theme: Theme): Palette {
  return theme === "dark"
    ? {
        background: "#000000",
        card: "#1c1c1e",
        text: "#f2f2f7",
        muted: "#98989f",
        accent: "#0a84ff",
        good: "#30d158",
        bad: "#ff453a",
        hairline: "rgba(120, 120, 128, 0.32)",
      }
    : {
        background: "#f2f2f7",
        card: "#ffffff",
        text: "#1c1c1e",
        muted: "#8e8e93",
        accent: "#007aff",
        good: "#34c759",
        bad: "#ff3b30",
        hairline: "rgba(60, 60, 67, 0.16)",
      };
}

interface Figure {
  label: string;
  value: string;
  note: string;
  noteColor?: string;
}

function figuresOf(trip: Trip, locale: string, palette: Palette): Figure[] {
  const speed = averageSpeed(trip);
  const rhythm = pace(trip);
  // Une course : durée, distance, allure, dénivelé — sans pas ni temps annoncé.
  if (trip.kind === "run") {
    const paused = trip.pausedSeconds ?? 0;
    return [
      {
        label: navText("run.duration"),
        value: formatDuration(trip.elapsedSeconds),
        note: paused >= 5 ? navText("run.pausedFor", { time: formatDuration(paused) }) : "",
      },
      { label: navText("run.distance"), value: formatDistance(trip.distanceMeters), note: "" },
      {
        label: navText("run.avgPaceLong"),
        value: rhythm === null ? "—" : `${formatPace(rhythm)}${navText("trip.paceUnit")}`,
        note: speed === null ? "" : formatSpeed(speed, locale),
      },
      {
        label: navText("run.elevation"),
        value: trip.ascent !== null ? `D+ ${trip.ascent} m` : "—",
        note: trip.ascent !== null ? `D− ${trip.descent ?? 0} m` : "",
      },
    ];
  }
  const delta = trip.elapsedSeconds - trip.announcedSeconds;
  return [
    {
      label: navText("trip.elapsed"),
      value: formatDuration(trip.elapsedSeconds),
      note: deltaText(trip),
      noteColor:
        Math.abs(delta) < 60 ? undefined : delta < 0 ? palette.good : palette.bad,
    },
    {
      label: navText("trip.distance"),
      value: formatDistance(trip.distanceMeters),
      note: trip.ascent !== null ? `D+ ${trip.ascent} m · D− ${trip.descent} m` : "",
    },
    {
      label: navText("trip.steps"),
      value: trip.steps.toLocaleString(locale),
      note: stepsOrigin(trip),
    },
    {
      label: navText("trip.speed"),
      value: speed === null ? "—" : formatSpeed(speed, locale),
      note: rhythm === null ? "" : `${formatPace(rhythm)}${navText("trip.paceUnit")}`,
    },
  ];
}

/**
 * Compose l'image du trajet.
 *
 * `mapImage` est la capture de la carte, quand elle a pu être faite ; sans
 * elle, le bloc se resserre sur les chiffres et le dénivelé plutôt que de
 * laisser un rectangle vide.
 */
export async function drawTripCard(
  trip: Trip,
  theme: Theme,
  locale: string,
  mapImage: Blob | null
): Promise<Blob | null> {
  const base = paletteFor(theme);
  const palette = trip.kind === "run" ? { ...base, accent: theme === "dark" ? RUN_COLOR_DARK : RUN_COLOR } : base;
  const figures = figuresOf(trip, locale, palette);
  const bitmap = mapImage ? await createImageBitmap(mapImage).catch(() => null) : null;

  // La hauteur se déduit de ce qu'il y a à montrer : sans carte ni relief, le
  // bloc n'est qu'un en-tête et quatre chiffres.
  const headerHeight = 116;
  const figuresHeight = 96;
  const mapBlock = bitmap ? MAP_HEIGHT + 26 : 0;
  const profileBlock = trip.profile && trip.profile.length > 1 ? PROFILE_HEIGHT + 26 : 0;
  const height = PAD + headerHeight + figuresHeight + mapBlock + profileBlock + PAD;

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH * SCALE;
  canvas.height = height * SCALE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(SCALE, SCALE);
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, WIDTH, height);

  const inner = WIDTH - PAD * 2;
  let y = PAD;

  // --- En-tête : la date, puis le parcours ---------------------------------
  ctx.fillStyle = palette.muted;
  ctx.font = `600 20px ${FONT}`;
  ctx.fillText(tripDate(trip, locale), PAD, y + 20);
  y += 42;

  ctx.fillStyle = palette.text;
  ctx.font = `700 34px ${FONT}`;
  const headline = trip.kind === "run" ? [navText("run.title"), trip.from].filter(Boolean).join(" · ") : routeLabel(trip);
  if (trip.kind === "run") ctx.fillStyle = palette.accent;
  fitText(ctx, headline, PAD, y + 30, inner, `700 34px ${FONT}`);
  y += headerHeight - 42;

  // --- Les quatre chiffres, en colonnes ------------------------------------
  const column = inner / figures.length;
  figures.forEach((figure, index) => {
    const x = PAD + column * index;
    ctx.fillStyle = palette.muted;
    ctx.font = `600 15px ${FONT}`;
    ctx.fillText(figure.label.toLocaleUpperCase(locale), x, y + 14);

    ctx.fillStyle = palette.text;
    ctx.font = `700 30px ${FONT}`;
    fitText(ctx, figure.value, x, y + 48, column - 14, `700 30px ${FONT}`);

    if (figure.note) {
      ctx.fillStyle = figure.noteColor ?? palette.muted;
      ctx.font = `500 16px ${FONT}`;
      fitText(ctx, figure.note, x, y + 74, column - 14, `500 16px ${FONT}`);
    }
  });
  y += figuresHeight;

  // --- La carte ------------------------------------------------------------
  if (bitmap) {
    ctx.save();
    roundRect(ctx, PAD, y, inner, MAP_HEIGHT, RADIUS);
    ctx.clip();
    // La capture est faite dans un rapport voisin ; `cover` évite les bandes
    // sans déformer le quartier.
    const ratio = Math.max(inner / bitmap.width, MAP_HEIGHT / bitmap.height);
    const w = bitmap.width * ratio;
    const h = bitmap.height * ratio;
    ctx.drawImage(bitmap, PAD + (inner - w) / 2, y + (MAP_HEIGHT - h) / 2, w, h);
    ctx.restore();
    bitmap.close();
    y += mapBlock;
  }

  // --- Le dénivelé ---------------------------------------------------------
  if (trip.profile && trip.profile.length > 1) {
    drawProfile(ctx, trip.profile, PAD, y, inner, PROFILE_HEIGHT, palette);
  }

  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

/** Écrit un texte en le rétrécissant plutôt qu'en le laissant déborder. */
function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  font: string
) {
  if (!text) return;
  const size = Number(font.match(/(\d+)px/)?.[1] ?? 16);
  let current = size;
  ctx.font = font;
  // Un nom de rue peut être très long : plutôt que de le couper — on perdrait
  // justement la fin, qui distingue deux adresses voisines — on réduit le
  // corps, jusqu'à un plancher en deçà duquel c'est l'ellipse qui prend le
  // relais.
  while (ctx.measureText(text).width > maxWidth && current > size * 0.62) {
    current -= 1;
    ctx.font = font.replace(/\d+px/, `${current}px`);
  }
  let shown = text;
  while (shown.length > 1 && ctx.measureText(shown).width > maxWidth) {
    shown = shown.slice(0, -2) + "…";
  }
  ctx.fillText(shown, x, y);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Le profil du dénivelé, aux mêmes règles que le graphe de l'écran : domaine
 * élargi d'un dixième et d'au moins vingt mètres, altitudes extrêmes écrites
 * sur l'axe — c'est ce qui empêche une échelle serrée d'exagérer une côte.
 */
function drawProfile(
  ctx: CanvasRenderingContext2D,
  samples: ElevationSample[],
  x: number,
  y: number,
  width: number,
  height: number,
  palette: Palette
) {
  const total = samples[samples.length - 1].atMeters || 1;
  const elevations = samples.map((sample) => sample.elevation);
  const min = Math.min(...elevations);
  const max = Math.max(...elevations);
  const span = Math.max(20, max - min);
  const low = min - span * 0.1;
  const high = max + span * 0.1;

  const left = x + 52;
  const plot = width - 52;
  const toX = (meters: number) => left + (meters / total) * plot;
  const toY = (elevation: number) => y + height - ((elevation - low) / (high - low)) * height;

  const line = new Path2D();
  samples.forEach((sample, index) => {
    const px = toX(sample.atMeters);
    const py = toY(sample.elevation);
    if (index === 0) line.moveTo(px, py);
    else line.lineTo(px, py);
  });

  const area = new Path2D(line);
  area.lineTo(toX(total), y + height);
  area.lineTo(left, y + height);
  area.closePath();

  const fill = ctx.createLinearGradient(0, y, 0, y + height);
  fill.addColorStop(0, withAlpha(palette.accent, 0.34));
  fill.addColorStop(1, withAlpha(palette.accent, 0.04));
  ctx.fillStyle = fill;
  ctx.fill(area);

  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  ctx.stroke(line);

  ctx.strokeStyle = palette.hairline;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(left, y + height);
  ctx.lineTo(x + width, y + height);
  ctx.stroke();

  ctx.fillStyle = palette.muted;
  ctx.font = `500 15px ${FONT}`;
  ctx.textAlign = "right";
  ctx.fillText(`${Math.round(high)}`, left - 10, y + 12);
  ctx.fillText(`${Math.round(low)}`, left - 10, y + height);
  ctx.textAlign = "left";
}

/** Une couleur `#rrggbb` avec une transparence. */
function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
