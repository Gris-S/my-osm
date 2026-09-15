// Génère les deux jeux de référence de la navigation voiture :
//
//   src/navigation/car/data/tolls.ts    les gares de péage et la grille APRR/AREA
//   src/navigation/car/data/radars.ts   les radars fixes du ministère de l'Intérieur
//
//   node scripts/build-car-data.mjs      (ou : npm run build:car-data)
//
// Pourquoi engendrer plutôt que télécharger au vol, alors que les trois
// sources autorisent l'origine croisée (mesuré) : les fichiers bruts pèsent
// 1,5 Mo, ils demandent une reprojection Lambert-93 et ils portent des défauts
// de forme qu'il vaut mieux traiter **une fois ici** que dans chaque
// navigateur. Le module produit est chargé par import dynamique au premier
// itinéraire voiture : il ne pèse rien au démarrage.
//
// Les trois sources, toutes publiques et sans clé :
//
// - tarifs APRR/AREA        seule société d'autoroutes à publier sa grille
// - gares de péage          référentiel national, coordonnées en Lambert-93
// - radars fixes            ministère de l'Intérieur, décembre 2025
//
// À relancer quand l'une d'elles est republiée — les tarifs bougent chaque
// février, les radars deux fois l'an.

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const OUT_TOLLS = fileURLToPath(new URL('../src/navigation/car/data/tolls.ts', import.meta.url))
const OUT_RADARS = fileURLToPath(new URL('../src/navigation/car/data/radars.ts', import.meta.url))

// Les jeux sont désignés par leur *dataset* et non par l'URL d'un fichier :
// data.gouv.fr change l'adresse d'une ressource à chaque republication, mais
// l'identifiant du jeu, lui, ne bouge pas.
const DATASETS = {
  tariffs: 'tarifs-autoroutes-aprr',
  gates: 'gares-de-peage-du-reseau-routier-national-concede',
  radars: 'liste-des-radars-fixes-en-france',
}

// ---------------------------------------------------------------------------
// Lambert-93 → WGS84
//
// Le référentiel des gares donne ses coordonnées en Lambert-93 (EPSG:2154),
// projection légale française. Les constantes sont celles de la note technique
// NT/G 71 de l'IGN ; l'inverse a été vérifié sur un point de contrôle — la
// tour Eiffel, (648227, 6862270) → 2,29436°, 48,85838°, soit un mètre de
// l'attendu.
// ---------------------------------------------------------------------------

const L93 = { n: 0.725607765053267, c: 11754255.426096, xs: 700000, ys: 12655612.049876 }
/** Excentricité de l'ellipsoïde GRS80. */
const E = 0.08181919106

function lambert93ToWgs84(x, y) {
  const dx = x - L93.xs
  const dy = y - L93.ys
  const r = Math.hypot(dx, dy)
  const lon = 3 + (Math.atan2(dx, -dy) / L93.n) * (180 / Math.PI)
  // Latitude isométrique, puis latitude géographique par itérations : la suite
  // converge à moins d'un millimètre en une dizaine de tours.
  const iso = -Math.log(Math.abs(r / L93.c)) / L93.n
  let phi = 2 * Math.atan(Math.exp(iso)) - Math.PI / 2
  for (let i = 0; i < 12; i++) {
    const s = E * Math.sin(phi)
    phi = 2 * Math.atan(Math.pow((1 + s) / (1 - s), E / 2) * Math.exp(iso)) - Math.PI / 2
  }
  return { lon, lat: (phi * 180) / Math.PI }
}

// ---------------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------------

/**
 * Nom de gare ramené à une forme comparable : majuscules sans accents, et
 * séparateurs uniformisés.
 *
 * C'est indispensable ici, parce que les trois sources n'écrivent pas les mêmes
 * noms de la même façon — le référentiel dit « St Martin-Du-Fresne », la grille
 * tarifaire « ST MARTIN DU FRESNE ».
 */
function normalize(name) {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[-'/.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function resourceUrl(dataset, pick) {
  const res = await fetch(`https://www.data.gouv.fr/api/1/datasets/${dataset}/`)
  if (!res.ok) throw new Error(`${dataset} : HTTP ${res.status}`)
  const found = (await res.json()).resources.filter(pick)
  if (!found.length) throw new Error(`${dataset} : aucune ressource ne correspond`)
  return found
}

async function fetchText(url, encoding = 'utf-8') {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} : HTTP ${res.status}`)
  return new TextDecoder(encoding).decode(await res.arrayBuffer())
}

/** Lecteur CSV minimal : ces trois fichiers n'ont ni guillemets ni retours encadrés. */
function parseCsv(text, delimiter) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length)
  const header = lines[0].split(delimiter).map((h) => h.trim())
  return lines.slice(1).map((line) => {
    const cells = line.split(delimiter)
    return Object.fromEntries(header.map((key, i) => [key, (cells[i] ?? '').trim()]))
  })
}

// ---------------------------------------------------------------------------
// Les péages
// ---------------------------------------------------------------------------

async function buildTolls() {
  // --- le référentiel des gares -------------------------------------------
  const [gatesRes] = await resourceUrl(DATASETS.gates, (r) => r.format === 'csv' && /20\d\d/.test(r.title))
  const gateRows = parseCsv(await fetchText(gatesRes.url), ';')

  // Le référentiel décrit chaque gare **deux fois**, une par sens de
  // circulation, à quelques mètres près. Une seule position nous intéresse :
  // on cherche à savoir si le trajet passe par cette gare, pas dans quel sens.
  const gates = new Map()
  for (const row of gateRows) {
    const x = Number(row.x?.replace(',', '.'))
    const y = Number(row.y?.replace(',', '.'))
    if (!Number.isFinite(x) || !Number.isFinite(y) || !row.nomGare) continue
    const key = normalize(row.nomGare)
    if (gates.has(key)) continue
    gates.set(key, {
      key,
      name: row.nomGare,
      ...lambert93ToWgs84(x, y),
      // Une barrière « pleine voie » se paie en la franchissant ; un
      // « échangeur » n'est qu'une entrée ou une sortie du réseau. La
      // distinction sert à décrire le péage, pas à le chiffrer.
      barrier: row.typeGare_lib === 'Pleine voie',
    })
  }

  // --- la grille tarifaire -------------------------------------------------
  //
  // Deux fichiers, deux formes : APRR nomme ses gares en clair, AREA les
  // numérote *et* les nomme. Seul le libellé nous sert, puisque c'est par lui
  // qu'on rejoint le référentiel.
  const tariffRes = await resourceUrl(DATASETS.tariffs, (r) => r.format === 'csv')
  const latest = (prefix) =>
    tariffRes
      .filter((r) => r.title.startsWith(prefix))
      .sort((a, b) => a.title.localeCompare(b.title))
      .pop()

  const prices = new Map()
  for (const resource of [latest('APRR'), latest('AREA')]) {
    if (!resource) continue
    for (const row of parseCsv(await fetchText(resource.url), ',')) {
      const from = normalize(row.gare_entree ?? row.libelle_gare_entree ?? '')
      const to = normalize(row.gare_sortie ?? row.libelle_gare_sortie ?? '')
      // La classe 1 est celle des voitures : c'est le seul véhicule que
      // l'application guide.
      const price = Number(row.tarif_classe_1)
      if (!from || !to || !Number.isFinite(price)) continue
      // On ne garde que les couples dont les **deux** gares sont localisées.
      // Le reste — les limites de concession, et les libellés composés que la
      // grille APRR emploie pour les trajets inter-réseaux — désigne des points
      // que le référentiel ne connaît pas : impossible de dire si un trajet y
      // passe, donc impossible de s'en servir.
      if (!gates.has(from) || !gates.has(to)) continue
      prices.set(`${from}>${to}`, Math.round(price * 100))
    }
  }

  // Seules les gares qui apparaissent dans la grille sont écrites : les autres
  // ne mènent à aucun prix, et les chercher le long d'un tracé coûterait sans
  // rien rendre.
  const used = new Set()
  for (const pair of prices.keys()) {
    const [from, to] = pair.split('>')
    used.add(from)
    used.add(to)
  }
  const kept = [...used].sort().map((key) => gates.get(key))
  const index = new Map(kept.map((gate, i) => [gate.key, i]))

  // Les couples sont écrits en **une seule chaîne** plutôt qu'en objet : neuf
  // mille clés JavaScript coûtent leur poids en analyse au chargement, là où
  // une chaîne découpée à la première lecture ne coûte rien tant qu'on n'ouvre
  // pas d'itinéraire voiture.
  const packed = [...prices]
    .map(([pair, cents]) => {
      const [from, to] = pair.split('>')
      return `${index.get(from)},${index.get(to)},${cents}`
    })
    .join(';')

  const body = `// Fichier **engendré** par \`scripts/build-car-data.mjs\` — ne pas l'éditer à la main.
//
// Les gares de péage localisées (référentiel national, reprojeté depuis le
// Lambert-93) et la grille tarifaire d'APRR/AREA pour la classe 1, c'est-à-dire
// les voitures. Seules les sociétés APRR et AREA publient leurs tarifs : un
// trajet qui n'emprunte que leurs réseaux est chiffré au centime, tout autre
// est annoncé sans prix. Voir \`src/navigation/car/tolls.ts\`.
//
// Engendré le ${new Date().toISOString().slice(0, 10)} — ${kept.length} gares, ${prices.size} couples tarifés.

/** Une gare de péage localisée. */
export interface TollGate {
  name: string
  lon: number
  lat: number
  /** Barrière de pleine voie (on la franchit) plutôt qu'échangeur (on y entre ou sort). */
  barrier: boolean
}

export const TOLL_GATES: TollGate[] = ${JSON.stringify(
    kept.map((g) => ({
      name: g.name,
      lon: Number(g.lon.toFixed(5)),
      lat: Number(g.lat.toFixed(5)),
      barrier: g.barrier,
    })),
    null,
    0
  ).replace(/\},\{/g, '},\n  {').replace(/^\[/, '[\n  ').replace(/\]$/, ',\n]')}

/**
 * Les tarifs, empaquetés : \`entrée,sortie,centimes\` séparés par des
 * point-virgules, les deux premiers étant des rangs dans \`TOLL_GATES\`.
 */
export const TOLL_PRICES = ${JSON.stringify(packed)}
`
  writeFileSync(OUT_TOLLS, body)
  console.log(`tolls.ts  : ${kept.length} gares, ${prices.size} couples, ${(body.length / 1024).toFixed(0)} ko`)
}

// ---------------------------------------------------------------------------
// Les radars
// ---------------------------------------------------------------------------

/**
 * Les codes du ministère, traduits en familles.
 *
 * `ETVM` — le radar de vitesse moyenne — mesure entre deux portiques et non en
 * un point : c'est le seul dont l'annonce vaut pour tout un tronçon, d'où sa
 * famille à part.
 */
const RADAR_KINDS = {
  ETF: 'fixed', // radar fixe
  ETD: 'fixed', // fixe discriminant (distingue les poids lourds)
  ETT: 'tower', // tourelle
  ETU: 'fixed', // radar urbain
  ETVM: 'average', // vitesse moyenne
  ETFR: 'light', // franchissement de feu rouge
  ETPN: 'crossing', // passage à niveau
}

async function buildRadars() {
  const [resource] = await resourceUrl(
    DATASETS.radars,
    (r) => r.format === 'csv' && /radars-fixes-en-france-\d\d-20\d\d/.test(r.url)
  )
  // Le fichier est en latin-1, et son en-tête porte des espaces parasites
  // (« VMA », « Longitude ») : le lecteur les retire déjà.
  const rows = parseCsv(await fetchText(resource.url, 'latin1'), ';')

  const radars = []
  for (const row of rows) {
    const lat = Number(row.Latitude)
    const lon = Number(row.Longitude)
    const kind = RADAR_KINDS[row['Type de radar']]
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !kind) continue
    // « NA » pour les radars dont la vitesse dépend de la voie ou du véhicule :
    // on annonce alors le radar sans annoncer de limite, ce qui vaut mieux
    // qu'un chiffre inventé.
    const speed = Number(row['VMA'])
    radars.push([
      Number(lat.toFixed(5)),
      Number(lon.toFixed(5)),
      kind,
      Number.isFinite(speed) && speed > 0 ? speed : 0,
    ])
  }
  radars.sort((a, b) => a[0] - b[0])

  const body = `// Fichier **engendré** par \`scripts/build-car-data.mjs\` — ne pas l'éditer à la main.
//
// Les radars fixes publiés par le ministère de l'Intérieur. C'est la seule
// source de l'application à déclencher un son : voir \`src/navigation/car/radars.ts\`.
//
// La liste est **triée par latitude**, ce qui permet d'en extraire une bande
// par recherche dichotomique au lieu de la parcourir en entier à chaque trajet.
//
// Engendré le ${new Date().toISOString().slice(0, 10)} — ${radars.length} radars.

export type RadarKind = 'fixed' | 'tower' | 'average' | 'light' | 'crossing'

/** Un radar : latitude, longitude, famille, vitesse annoncée (0 = non publiée). */
export type PackedRadar = [number, number, RadarKind, number]

export const RADARS: PackedRadar[] = ${JSON.stringify(radars)
    .replace(/\],\[/g, '],\n  [')
    .replace(/^\[/, '[\n  ')
    .replace(/\]$/, ',\n]')}
`
  writeFileSync(OUT_RADARS, body)
  console.log(`radars.ts : ${radars.length} radars, ${(body.length / 1024).toFixed(0)} ko`)
}

await buildTolls()
await buildRadars()
