import type { IconNode } from "../filters";

// ---------------------------------------------------------------------------
// Fabrication des marqueurs de POI dessinés sur la carte.
//
// Chaque catégorie a sa pastille : un disque de sa couleur, cerclé de blanc,
// portant son pictogramme (le même que dans le menu de filtres — voir le champ
// `icon` de `src/filters.ts`). Les pictogrammes sont au format Lucide, tracés
// dans un carré 24×24 avec un trait de 2 : on les rejoue ici sur un canvas via
// `Path2D`, qui comprend directement la syntaxe des attributs `d` du SVG.
// ---------------------------------------------------------------------------

/** Diamètre de la pastille, en pixels CSS. */
const DIAMETER = 26;
/** Côté du pictogramme à l'intérieur de la pastille. */
const GLYPH = 14;
/** Marge autour du disque, pour que l'ombre portée ne soit pas rognée. */
const PADDING = 3;
/** Épaisseur du trait du pictogramme, exprimée dans le repère 24×24 de Lucide. */
const GLYPH_STROKE = 2.4;

/** Trace un élément d'icône Lucide dans le repère 24×24 courant. */
function strokeElement(ctx: CanvasRenderingContext2D, [element, attrs]: IconNode[number]) {
  const num = (key: string) => Number(attrs[key] ?? 0);

  ctx.beginPath();
  switch (element) {
    case "path":
      ctx.stroke(new Path2D(attrs.d ?? ""));
      return;
    case "circle":
      ctx.arc(num("cx"), num("cy"), num("r"), 0, Math.PI * 2);
      break;
    case "rect":
      ctx.roundRect(num("x"), num("y"), num("width"), num("height"), num("rx"));
      break;
    case "line":
      ctx.moveTo(num("x1"), num("y1"));
      ctx.lineTo(num("x2"), num("y2"));
      break;
    case "polyline":
    case "polygon": {
      const points = (attrs.points ?? "").trim().split(/[\s,]+/).map(Number);
      for (let i = 0; i + 1 < points.length; i += 2) {
        if (i === 0) ctx.moveTo(points[i], points[i + 1]);
        else ctx.lineTo(points[i], points[i + 1]);
      }
      if (element === "polygon") ctx.closePath();
      break;
    }
    default:
      return;
  }
  ctx.stroke();
}

/**
 * Dessine le marqueur d'une catégorie et le renvoie sous une forme acceptée par
 * `map.addImage`. `pixelRatio` doit être passé tel quel à `addImage` pour que
 * MapLibre affiche l'image à la bonne taille sur les écrans à haute densité.
 */
export function buildMarkerImage(icon: IconNode, color: string, pixelRatio: number): ImageData {
  const size = DIAMETER + PADDING * 2;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = Math.round(size * pixelRatio);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D indisponible");
  ctx.scale(pixelRatio, pixelRatio);

  const center = size / 2;

  // Disque blanc + ombre portée : sert de cerne, pour que la pastille se
  // détache aussi bien du plan clair que de l'imagerie satellite.
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
  ctx.shadowBlur = 2.5;
  ctx.shadowOffsetY = 1;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(center, center, DIAMETER / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(center, center, DIAMETER / 2 - 1.75, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(center - GLYPH / 2, center - GLYPH / 2);
  ctx.scale(GLYPH / 24, GLYPH / 24);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = GLYPH_STROKE;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const node of icon) strokeElement(ctx, node);
  ctx.restore();

  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

// ---------------------------------------------------------------------------
// Marqueur d'un arrêt de transport : les pastilles des lignes qui le desservent.
// ---------------------------------------------------------------------------

/** Dimensions d'une pastille de ligne, en pixels CSS. */
const CHIP_HEIGHT = 15;
const CHIP_GAP = 2;
const CHIP_RADIUS = 4;
const CHIP_MIN_WIDTH = 19;
const CHIP_FONT = "700 11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
/** Pastille « + N », plus discrète : elle compte, elle ne nomme pas. */
const EXTRA_HEIGHT = 12;
const EXTRA_FONT = "700 9px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

export interface LineChip {
  label: string;
  color: string;
  textColor: string;
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/**
 * Empile les pastilles des lignes desservant un arrêt (trois au plus), et
 * ajoute un « + N » quand il y en a davantage — l'arrêt reste cliquable pour
 * voir le reste.
 *
 * Les pastilles reprennent le libellé et les couleurs officielles de chaque
 * ligne : c'est ce qu'on lit sur le poteau ou sur le quai, et c'est ce qui
 * permet de repérer sa ligne sur la carte sans ouvrir de fiche.
 */
export function buildLineMarkerImage(chips: LineChip[], extra: number, pixelRatio: number): ImageData {
  const measure = document.createElement("canvas").getContext("2d");
  if (!measure) throw new Error("Canvas 2D indisponible");
  measure.font = CHIP_FONT;

  const widths = chips.map((chip) => Math.max(CHIP_MIN_WIDTH, Math.ceil(measure.measureText(chip.label).width) + 10));
  const extraLabel = extra > 0 ? `+${extra}` : "";
  measure.font = EXTRA_FONT;
  const extraWidth = extra > 0 ? Math.max(16, Math.ceil(measure.measureText(extraLabel).width) + 8) : 0;

  const width = Math.max(...widths, extraWidth) + PADDING * 2;
  const rows = chips.length;
  const height =
    PADDING * 2 + rows * CHIP_HEIGHT + Math.max(0, rows - 1) * CHIP_GAP + (extra > 0 ? CHIP_GAP + EXTRA_HEIGHT : 0);

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D indisponible");
  ctx.scale(pixelRatio, pixelRatio);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  let y = PADDING;
  chips.forEach((chip, index) => {
    const w = widths[index];
    const x = (width - w) / 2;

    // Cerne blanc et ombre légère : les pastilles doivent tenir aussi bien sur
    // le plan clair que sur l'imagerie satellite.
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
    ctx.shadowBlur = 2.5;
    ctx.shadowOffsetY = 1;
    ctx.fillStyle = "#ffffff";
    roundedRect(ctx, x - 1.5, y - 1.5, w + 3, CHIP_HEIGHT + 3, CHIP_RADIUS + 1.5);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = chip.color;
    roundedRect(ctx, x, y, w, CHIP_HEIGHT, CHIP_RADIUS);
    ctx.fill();

    ctx.fillStyle = chip.textColor;
    ctx.font = CHIP_FONT;
    ctx.fillText(chip.label, width / 2, y + CHIP_HEIGHT / 2 + 0.5);

    y += CHIP_HEIGHT + CHIP_GAP;
  });

  if (extra > 0) {
    const x = (width - extraWidth) / 2;
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.3)";
    ctx.shadowBlur = 2;
    ctx.shadowOffsetY = 1;
    ctx.fillStyle = "#ffffff";
    roundedRect(ctx, x - 1.5, y - 1.5, extraWidth + 3, EXTRA_HEIGHT + 3, CHIP_RADIUS + 1);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = "#5b5b66";
    roundedRect(ctx, x, y, extraWidth, EXTRA_HEIGHT, CHIP_RADIUS - 1);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = EXTRA_FONT;
    ctx.fillText(extraLabel, width / 2, y + EXTRA_HEIGHT / 2 + 0.5);
  }

  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}
