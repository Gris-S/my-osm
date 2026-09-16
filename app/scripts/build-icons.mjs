// ---------------------------------------------------------------------------
// Toutes les icônes de l'application, à partir d'une seule image.
//
// `npm run build:icons` réécrit le favicon, les icônes du manifeste web, celles
// du lanceur Android et celle de la fiche F-Droid. **Ne retoucher aucun de ces
// fichiers à la main** : la source unique est `scripts/icon-source.png`, et
// tout le reste en découle.
//
// Le dessin précédent était décrit en SVG dans ce script — une maison, une
// carte en aplats, le dard de Mapillary — et rastérisé par ImageMagick. Il a
// été remplacé (demande explicite) par une image fournie. Deux conséquences
// tiennent à ce changement de nature :
//
// - **Plus de `favicon.svg`.** Une image matricielle n'a pas de forme
//   vectorielle ; le navigateur reçoit désormais un PNG (`favicon.png`).
// - **Plus de palette de 256 couleurs.** Elle rendait l'ancien dessin à
//   l'identique pour un quart du poids, les aplats n'ayant pas de dégradés.
//   Celle-ci en a : la réduire la ferait baguer.
//
// ImageMagick (« magick ») est requis, et n'est pas une dépendance npm.
// ---------------------------------------------------------------------------

import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPTS_DIR = fileURLToPath(new URL('./', import.meta.url))
const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url))
const RACINE = fileURLToPath(new URL('../../', import.meta.url))
const RES_DIR = join(RACINE, 'apk/android/app/src/main/res')
const FASTLANE_ICON = join(RACINE, 'fastlane/metadata/android/en-US/images/icon.png')

const SOURCE = join(SCRIPTS_DIR, 'icon-source.png')

/** Le fond des surfaces qui n'acceptent pas la transparence (iOS, lanceurs). */
const FOND = '#FFFFFF'

const magick = (args) => execFileSync('magick', args)

/**
 * Une icône carrée, à la taille voulue.
 *
 * `fond` aplatit sur du blanc : l'image a des coins transparents, et les écrans
 * d'accueil d'iOS comme les gabarits du lanceur Android n'acceptent pas la
 * transparence — ils la rendraient en noir.
 */
function carre(sortie, taille, { fond = false, palette = false } = {}) {
  magick([
    SOURCE,
    '-resize', `${taille}x${taille}`,
    ...(fond ? ['-background', FOND, '-flatten'] : ['-background', 'none']),
    ...(palette ? ['-colors', '255'] : []),
    '-strip', '-define', 'png:compression-level=9',
    `${palette ? 'PNG8' : 'PNG32'}:${sortie}`,
  ])
}

/**
 * La variante ronde du lanceur : l'image recadrée dans un disque.
 *
 * Elle est **agrandie avant d'être découpée** (`-resize` à 100 % puis masque),
 * l'image portant déjà ses propres coins arrondis : sans cela, le disque
 * mordrait dans le vide laissé par ces coins.
 */
function rond(sortie, taille, { palette = false } = {}) {
  magick([
    SOURCE,
    '-resize', `${taille}x${taille}`,
    '-background', FOND, '-flatten',
    ...(palette ? ['-colors', '255'] : []),
    '(', '+clone', '-alpha', 'transparent', '-fill', 'white',
    '-draw', `circle ${taille / 2 - 0.5},${taille / 2 - 0.5} ${taille / 2 - 0.5},0`, ')',
    '-compose', 'copyopacity', '-composite',
    '-strip', '-define', 'png:compression-level=9',
    `PNG32:${sortie}`,
  ])
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

if (!existsSync(SOURCE)) {
  console.error(`Image source introuvable : ${SOURCE}`)
  process.exit(1)
}

console.log('Web :')
// Le navigateur : un PNG suffit, et de 256 px il reste net sur un onglet comme
// dans les favoris.
carre(join(PUBLIC_DIR, 'favicon.png'), 256)
console.log('  favicon.png (256×256)')
carre(join(PUBLIC_DIR, 'icon-512.png'), 512)
console.log('  icon-512.png (512×512)')
carre(join(PUBLIC_DIR, 'apple-touch-icon.png'), 180, { fond: true })
console.log('  apple-touch-icon.png (180×180)')
// « maskable » : le lanceur rogne à sa propre forme. L'image est donc posée
// pleine bord et aplatie — ses coins arrondis seront recoupés par le masque,
// et le sujet, centré, reste dans la zone sûre.
carre(join(PUBLIC_DIR, 'icon-maskable-512.png'), 512, { fond: true })
console.log('  icon-maskable-512.png (512×512)')

// L'ancien favicon vectoriel n'a plus de source : on ne laisse pas traîner un
// fichier que plus rien ne régénère.
const ancienSvg = join(PUBLIC_DIR, 'favicon.svg')
if (existsSync(ancienSvg)) {
  rmSync(ancienSvg)
  console.log('  favicon.svg retiré (plus de source vectorielle)')
}

console.log('Lanceur Android :')
// Icône adaptative : le premier plan occupe 108 dp dont 18 de débord, le
// système ne montrant que les 72 dp centraux. L'image étant elle-même une
// icône complète, elle est posée pleine bord : le masque recoupe sa bordure de
// carte, jamais son sujet.
const DENSITES = [
  ['mdpi', 48, 108],
  ['hdpi', 72, 162],
  ['xhdpi', 96, 216],
  ['xxhdpi', 144, 324],
  ['xxxhdpi', 192, 432],
]
//
// Ces quinze fichiers sont **quantifiés** à 255 couleurs, contrairement aux
// icônes web. Mesuré : sur le 512, la palette coûte 2,2 % d'écart quadratique
// et divise le poids par cinq. Agrandi trois fois, l'écart se voit — le ciel
// bleu se marche en paliers, la route rose se mouchette — mais ces rasters-là
// ne sont **jamais** agrandis : le lanceur les dessine de 48 à 192 px, taille à
// laquelle les deux versions sont indiscernables. Les grandes, elles, restent
// en couleurs pleines : `icon-512.png` sert aussi de logo au README et de
// vignette à la fiche F-Droid, où on la regarde en grand.
for (const [densite, legacy, premierPlan] of DENSITES) {
  const dossier = join(RES_DIR, `mipmap-${densite}`)
  carre(join(dossier, 'ic_launcher_foreground.png'), premierPlan, { fond: true, palette: true })
  carre(join(dossier, 'ic_launcher.png'), legacy, { palette: true })
  rond(join(dossier, 'ic_launcher_round.png'), legacy, { palette: true })
  console.log(`  ${densite} : ${legacy}×${legacy}, premier plan ${premierPlan}×${premierPlan}`)
}

console.log('F-Droid :')
copyFileSync(join(PUBLIC_DIR, 'icon-512.png'), FASTLANE_ICON)
console.log('  fastlane/…/images/icon.png (copie du 512)')
