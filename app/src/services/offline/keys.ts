// ---------------------------------------------------------------------------
// Clés de cache des tuiles hors ligne.
//
// Ce module est **partagé avec le Service Worker** (`src/sw.ts`) : il ne doit
// donc rien importer qui suppose une fenêtre. C'est aussi la raison de son
// existence — la reconnaissance d'une URL de tuile et sa traduction en clé de
// cache doivent être écrites une seule fois, sans quoi le téléchargement
// rangerait sous une clé que la lecture ne saurait pas retrouver.
// ---------------------------------------------------------------------------

export type TileKind = "vector" | "esri" | "ign" | "dem" | "contour";

export interface TileRef {
  kind: TileKind;
  z: number;
  x: number;
  y: number;
}

/**
 * L'URL des tuiles vectorielles porte un **numéro de version daté**
 * (`…/planet/20260830_080001_pt/14/8298/5637.pbf`), qui change à chaque
 * republication d'OpenFreeMap. Les tuiles ne sont donc pas rangées sous leur
 * URL mais sous une clé normalisée, débarrassée de cette version.
 *
 * Sans cette normalisation, une republication amont rendrait d'un coup toutes
 * les zones téléchargées invisibles — les URLs demandées ne correspondraient
 * plus à celles rangées — et la carte redeviendrait vide hors ligne sans que
 * rien ne l'explique.
 */
export function cacheKeyFor({ kind, z, x, y }: TileRef): string {
  return `https://hors-ligne.local/${kind}/${z}/${x}/${y}`;
}

const VECTOR_RE = /^https:\/\/tiles\.openfreemap\.org\/planet\/[^/]+\/(\d+)\/(\d+)\/(\d+)\.pbf$/;
const DEM_RE = /^https:\/\/s3\.amazonaws\.com\/elevation-tiles-prod\/terrarium\/(\d+)\/(\d+)\/(\d+)\.png$/;
const ESRI_RE =
  /^https:\/\/server\.arcgisonline\.com\/ArcGIS\/rest\/services\/World_Imagery\/MapServer\/tile\/(\d+)\/(\d+)\/(\d+)/;

/**
 * Reconnaît une URL de tuile et en tire sa clé de cache, ou `null` si l'URL
 * n'est pas une tuile que l'on sache stocker.
 *
 * L'IGN est un WMTS : ses coordonnées sont dans la chaîne de requête, et non
 * dans le chemin. Attention à l'ordre — `TILEROW` est la ligne, donc `y`.
 */
export function tileRefFromUrl(url: string): TileRef | null {
  const vector = VECTOR_RE.exec(url);
  if (vector) return { kind: "vector", z: +vector[1], x: +vector[2], y: +vector[3] };

  const esri = ESRI_RE.exec(url);
  // Esri sert ses tuiles dans l'ordre z/y/x, contrairement à tout le reste.
  if (esri) return { kind: "esri", z: +esri[1], y: +esri[2], x: +esri[3] };

  const dem = DEM_RE.exec(url);
  if (dem) return { kind: "dem", z: +dem[1], x: +dem[2], y: +dem[3] };

  if (url.startsWith("https://data.geopf.fr/wmts")) {
    const q = new URL(url).searchParams;
    const z = q.get("TILEMATRIX");
    const y = q.get("TILEROW");
    const x = q.get("TILECOL");
    // Deux couches de la Géoplateforme passent par la même URL :
    // l'orthophotographie et les courbes de niveau. C'est `LAYER` qui les
    // sépare, et les confondre rangerait les unes sous la clé des autres.
    if (z && y && x) {
      const kind = q.get("LAYER")?.includes("CONTOUR") ? "contour" : "ign";
      return { kind, z: +z, x: +x, y: +y };
    }
  }
  return null;
}

/** Les ressources d'habillage : style, pictogrammes, polices. */
export function isStyleAssetUrl(url: string): boolean {
  return (
    url.startsWith("https://tiles.openfreemap.org/styles/") ||
    url.startsWith("https://tiles.openfreemap.org/sprites/") ||
    url.startsWith("https://tiles.openfreemap.org/fonts/") ||
    url === "https://tiles.openfreemap.org/planet"
  );
}
