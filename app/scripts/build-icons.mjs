// Génère les icônes de l'application depuis une source unique.
//
//   node scripts/build-icons.mjs      (ou : npm run build:icons)
//
// Le dessin est décrit **une seule fois** ci-dessous, puis décliné en quatre
// fichiers de `public/`. Ne pas retoucher ces fichiers à la main — SVG compris,
// ils sont écrasés à chaque exécution.
//
// La rastérisation passe par ImageMagick (délégué librsvg). C'est le seul
// prérequis, et il n'est pas dans les dépendances npm : le script le dit
// clairement s'il manque.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url))

// Palette. Le fond reprend les couleurs de Plans (sable, parcs, eau, axes
// ocre) plutôt que celles du style sombre : l'icône ne suit pas le thème.
const C = {
  land: '#f7f3ea', // terre
  paper: '#f4f2ed', // fond hors de la maison, et fond du manifeste
  park: '#7ed267', // espaces verts
  parkDeep: '#5cbf46', // bosquets, pour que le vert ne soit pas un aplat
  water: '#35a9ec', // eau
  building: '#e6dcc9', // pâtés de maisons
  casing: '#d6ccb8', // liseré des voies
  road: '#ffffff', // chaussée
  major: '#ffc93c', // axe majeur
  majorCasing: '#e0a000',
  edge: '#33373d', // trait de la maison
  arrow: '#ff3b30', // flèche, au rouge du marqueur de l'application
  ink: '#ffffff',
}


// La silhouette : proportions du logo Home Assistant — pignon large, corps
// carré, bas arrondi. Elle **découpe** la carte, elle ne se pose pas dessus :
// c'est ce qui dit que la carte est hébergée ici et pas ailleurs.
const HOUSE =
  'M30 5 L54 26.5 L54 50 A4.5 4.5 0 0 1 49.5 54.5 L10.5 54.5 A4.5 4.5 0 0 1 6 50 L6 26.5 Z'

// Le fond, aux couleurs de Plans. Les tracés débordent largement du cadre :
// c'est la découpe en maison qui les arrête, et non leurs extrémités.
const map = (id) => `
    <g clip-path="url(#h${id})">
      <rect x="-2" y="-2" width="68" height="68" fill="${C.land}" />
      <path d="M-2 6 C 14 2, 28 13, 26 29 C 24 45, 2 49, -2 44 Z" fill="${C.park}" />
      <path d="M1 14 C 10 11, 18 17, 17 26 C 16 35, 5 38, -2 34 Z" fill="${C.parkDeep}" />
      <path d="M30 -2 C 39 11, 52 15, 66 11 L66 -2 Z" fill="${C.park}" />
      <path d="M-2 55 C 8 52, 16 57, 17 66 L-2 66 Z" fill="${C.park}" />
      <path d="M66 20 C 48 27, 40 44, 39 66 L66 66 Z" fill="${C.water}" />
      <g fill="${C.building}">
        <rect x="28" y="9" width="10" height="8" rx="1" />
        <rect x="27" y="43" width="9" height="9" rx="1" />
      </g>
      <g fill="none" stroke-linecap="round">
        <path d="M22 -4 C 24 14, 23 34, 18 66" stroke="${C.casing}" stroke-width="8.5" />
        <path d="M-4 62 C 12 57, 25 50, 36 38 C 46 27, 53 15, 58 -2"
              stroke="${C.majorCasing}" stroke-width="9" />
        <path d="M-4 26 C 12 31, 32 30, 66 19" stroke="${C.casing}" stroke-width="7" />
        <path d="M22 -4 C 24 14, 23 34, 18 66" stroke="${C.road}" stroke-width="5.6" />
        <path d="M-4 62 C 12 57, 25 50, 36 38 C 46 27, 53 15, 58 -2"
              stroke="${C.major}" stroke-width="6.4" />
        <path d="M-4 26 C 12 31, 32 30, 66 19" stroke="${C.road}" stroke-width="4.6" />
      </g>
    </g>`

// La flèche est le **dard du logo Mapillary**, repris tel quel (tracé officiel,
// repère 24 × 24) et pivoté pour pointer vers la gauche comme sur le croquis.
// Elle est posée en travers de la maison et **en ressort** franchement à
// droite : c'est ce débordement qui dit que la photo de rue sort du cadre de la
// carte. Le tracé est peint deux fois — un contour blanc épais d'abord, le
// rouge par-dessus — parce que la forme est ajourée : sans cette réserve, ses
// pleins se confondraient avec l'axe ocre et le toit qu'elle traverse.
const MAPILLARY = "M.362 11.812c-.564-.305-.46-1.099.25-1.302.602-.17 5.495-1.81 6.975-2.308a.897.897 0 0 0 .565-.558L10.528.671C10.75.02 11.555.017 11.884.65c.117.224 4.546 8.25 4.7 8.591.154.341.055.718-.295.935-.35.218-.918.544-1.117.667-.36.223-.704.068-.869-.277-.163-.346-1.427-2.577-1.942-3.525-.258-.472-1.033-.654-1.295.111-.187.553-.627 1.842-.857 2.514a.93.93 0 0 1-.567.564l-2.582.855c-.509.168-.756.948-.069 1.277.144.07 3.24 1.73 3.56 1.882.32.152.497.59.31.9-.255.425-.582.962-.7 1.138a.728.728 0 0 1-.948.224c-.34-.179-8.651-4.584-8.853-4.692zm22.528 11.91c-.334-.18-10.918-5.78-11.355-6.003-.436-.222-.542-.606-.308-1.021.118-.211.376-.633.586-.972.288-.467.709-.468.946-.33.238.138 3.598 1.906 3.816 2.025.512.284 1.27-.363.93-.93-.163-.27-1.579-2.853-2.03-3.705-.203-.387-.147-.736.31-.968a17.5 17.5 0 0 0 .98-.568c.357-.216.834-.052 1.028.27.193.325 5.926 10.887 6.109 11.215.362.651-.343 1.348-1.011.988"

const ARROW = `
    <g transform="translate(41 36) rotate(133) scale(1.55) translate(-12 -12)">
      <path d="${MAPILLARY}" fill="${C.ink}" stroke="${C.ink}" stroke-width="2.4"
            stroke-linejoin="round" />
      <path d="${MAPILLARY}" fill="${C.arrow}" />
    </g>`

// Trois découpes, et une seule raison à chacune :
//   - `rounded` : le carré arrondi du favicon et de l'icône `any`.
//   - carré plein : iOS applique son propre masque, dont le rayon est celui
//     que l'on utilise — le dessin y tient donc tel quel.
//   - `safe` : Android rogne les icônes `maskable` à la forme du système. Le
//     dessin déborde très largement de la zone sûre (les angles du corps sont
//     à 36 unités du centre pour 25,6 permises) et doit donc être réduit.
function svg({ rounded = false, safe = false } = {}) {
  const id = rounded ? 'r' : safe ? 'm' : 's'
  const clip = rounded
    ? `<clipPath id="c${id}"><rect width="64" height="64" rx="14" /></clipPath>`
    : ''
  const open = rounded ? `<g clip-path="url(#c${id})">` : '<g>'
  const scale = safe ? '<g transform="translate(32 32) scale(0.72) translate(-32 -32)">' : '<g>'
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="MY OSM">
  <!-- Fichier généré par scripts/build-icons.mjs — ne pas modifier à la main. -->
  <defs>
    ${clip}
    <clipPath id="h${id}"><path d="${HOUSE}" /></clipPath>
  </defs>
  ${open}
    <rect x="-2" y="-2" width="68" height="68" fill="${C.paper}" />
    ${scale}
${map(id)}
      <path d="${HOUSE}" fill="none" stroke="${C.edge}" stroke-width="4" stroke-linejoin="round" />
${ARROW}
    </g>
  </g>
</svg>
`
}

function rasterize(source, output, size) {
  const dir = mkdtempSync(join(tmpdir(), 'osm-local-icons-'))
  const tmp = join(dir, 'icon.svg')
  try {
    writeFileSync(tmp, source)
    execFileSync('magick', [
      '-background', 'none',
      `svg:${tmp}`,
      '-resize', `${size}x${size}`,
      // Les écrans d'accueil d'iOS et d'Android n'acceptent pas la
      // transparence : on aplatit sur la couleur du fond.
      '-background', C.paper, '-flatten',
      // Le dessin est en aplats : une palette de 256 couleurs le rend à
      // l'identique pour un quart du poids. Pas de tramage, qui ferait
      // grossir le fichier sans rien apporter ici.
      '-colors', '255', '-strip', '-define', 'png:compression-level=9',
      `PNG8:${join(PUBLIC_DIR, output)}`,
    ])
    console.log(`  ${output} (${size}×${size})`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

try {
  execFileSync('magick', ['-version'], { stdio: 'ignore' })
} catch {
  console.error(
    'ImageMagick (commande « magick ») est introuvable.\n' +
      'Installez-le, par exemple : sudo dnf install ImageMagick',
  )
  process.exit(1)
}

writeFileSync(join(PUBLIC_DIR, 'favicon.svg'), svg({ rounded: true }))
console.log('  favicon.svg')
rasterize(svg({ rounded: true }), 'icon-512.png', 512)
rasterize(svg(), 'apple-touch-icon.png', 180)
rasterize(svg({ safe: true }), 'icon-maskable-512.png', 512)
