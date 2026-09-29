import type { Map as MLMap } from "maplibre-gl";

// ---------------------------------------------------------------------------
// Les cartouches des numéros de route, aux couleurs de la signalisation
// française — celles du bandeau de la navigation voiture (`roadClass`,
// `navigation.css`) : A et N rouges, D jaunes, E et F verts, M cyan, le reste
// blanc cerné.
//
// Le style clair (`styles/appleLight.ts`) les demande sous le nom
// `fr-shield-<couleur>-<longueur du numéro>`. Le sprite de Liberty n'a qu'un
// cartouche, blanc, et une image de sprite ne se recolore pas : on les dessine
// donc ici, **à la demande** (`styleimagemissing`), c'est-à-dire seulement ceux
// que la carte affiche, et à nouveau après chaque changement de style, qui
// efface les images ajoutées.
// ---------------------------------------------------------------------------

const COLORS: Record<string, { fill: string; stroke?: string }> = {
  red: { fill: "#d70015" },
  yellow: { fill: "#ffcc00" },
  green: { fill: "#248a3d" },
  cyan: { fill: "#0093b0" },
  white: { fill: "#ffffff", stroke: "rgba(60, 60, 67, 0.45)" },
};

const PATTERN = /^fr-shield-(red|yellow|green|cyan|white)-(\d+)$/;
/** Deux pixels d'image par pixel d'écran : net sur un téléphone. */
const RATIO = 2;

function drawShield(color: keyof typeof COLORS, length: number): ImageData {
  // La largeur suit la longueur du numéro, comme les cartouches de Liberty :
  // le texte (10 px, gras) y est posé par la couche.
  const width = (10 + 7 * Math.max(1, length)) * RATIO;
  const height = 18 * RATIO;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext("2d")!;
  const { fill, stroke } = COLORS[color];
  const r = 4 * RATIO;
  g.beginPath();
  g.roundRect(RATIO, RATIO, width - 2 * RATIO, height - 2 * RATIO, r);
  g.fillStyle = fill;
  g.fill();
  // Un liseré blanc autour des couleurs, un cerne gris autour du blanc : le
  // cartouche doit se détacher d'une route claire comme d'un bois.
  g.lineWidth = RATIO * 1.2;
  g.strokeStyle = stroke ?? "rgba(255, 255, 255, 0.95)";
  g.stroke();
  return g.getImageData(0, 0, width, height);
}

/**
 * Branche le dessin à la demande sur une carte. MapLibre 6 attend un
 * **résolveur** (`setMissingStyleImageResolver`) : l'événement
 * `styleimagemissing` n'est plus qu'une notification, et une image ajoutée
 * depuis lui arrive trop tard pour la tuile qui la demandait. Une carte n'a
 * qu'un résolveur : si d'autres images devaient un jour être dessinées à la
 * demande, c'est ici qu'elles se brancheraient.
 */
export function installRoadShields(map: MLMap) {
  map.setMissingStyleImageResolver((id) => {
    const match = PATTERN.exec(id);
    if (!match || map.hasImage(id)) return;
    map.addImage(id, drawShield(match[1] as keyof typeof COLORS, Number(match[2])), { pixelRatio: RATIO });
  });
}
