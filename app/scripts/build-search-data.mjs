// Génère les deux dictionnaires de la recherche :
//
//   src/search/data/categories/<langue>.json   les catégories et leurs mots
//                                              (« pharmacie », « Apotheke »…)
//   src/search/data/brands.json                les enseignes du monde entier
//
//   node scripts/build-search-data.mjs      (ou : npm run build:search-data)
//
// Les deux sources sont des projets OpenStreetMap libres, publiés sur npm :
//
// - @openstreetmap/id-tagging-schema (ISC)   les catégories de l'éditeur iD,
//   leurs noms et synonymes traduits dans une centaine de langues
// - name-suggestion-index (BSD-3-Clause)     les enseignes connues et leurs
//   autres noms (« macdo » pour McDonald's)
//
// Pourquoi engendrer plutôt que dépendre : les deux paquets pèsent 150 Mo une
// fois décompressés, pour quelques centaines de Ko utiles. Ils ne sont donc
// **pas** dans package.json (la construction F-Droid n'a pas à les installer) :
// ce script les télécharge à la version épinglée — `npm pack` vérifie leur
// empreinte — et n'en garde que les noms. Une langue n'est chargée qu'à la
// première recherche, et seulement celles du téléphone.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCHEMA = '@openstreetmap/id-tagging-schema@7.3.0'
const NSI = 'name-suggestion-index@8.0.20261101'
const OUT = fileURLToPath(new URL('../src/search/data/', import.meta.url))

// Les clés qui désignent ce qu'on cherche sur une carte : un commerce, un
// service, un lieu à visiter. Pas `highway`, `building` ni `natural`.
// `emergency` écarté : « station » y désignait un poste de sauvetage en mer.
const KEYS = new Set(['amenity', 'shop', 'tourism', 'leisure', 'craft', 'office', 'healthcare', 'historic'])
// Les seuls mots ajoutés à la main, là où les données d'iD trompent : en
// français, « poste » n'y est qu'un synonyme du centre de tri, pas du bureau de
// poste. Chacun devient un **nom** de la catégorie (ligne à part).
const EXTRA_NAMES = { fr: { 'amenity=post_office': ['poste', 'la poste'] } }
// Une langue dont on connaît moins de catégories n'apporte presque rien.
const MIN_CATEGORIES = 60

const tmp = mkdtempSync(join(tmpdir(), 'search-data-'))
function unpack(spec) {
  const file = execFileSync('npm', ['pack', spec, '--silent', '--pack-destination', tmp], { encoding: 'utf8' }).trim()
  const dir = join(tmp, file.replace(/\.tgz$/, ''))
  mkdirSync(dir)
  execFileSync('tar', ['xzf', join(tmp, file), '-C', dir])
  return join(dir, 'package/dist')
}
const json = (path) => JSON.parse(readFileSync(path, 'utf8'))
const list = (value) => (Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [])

try {
  // --- Catégories --------------------------------------------------------
  const schema = unpack(SCHEMA)
  const presets = json(join(schema, 'presets.json'))
  const categories = new Map() // id du preset -> "clé=valeur"
  for (const [id, preset] of Object.entries(presets)) {
    if (preset.searchable === false) continue
    const tags = Object.entries(preset.tags ?? {})
    if (tags.length !== 1) continue
    const [[key, value]] = tags
    if (!KEYS.has(key) || value === '*') continue
    categories.set(id, `${key}=${value}`)
  }

  mkdirSync(join(OUT, 'categories'), { recursive: true })
  for (const f of readdirSync(join(OUT, 'categories'))) rmSync(join(OUT, 'categories', f))
  const dir = join(schema, 'translations')
  let langs = 0
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json') && !f.endsWith('.min.json')).sort()) {
    const lang = file.slice(0, -5)
    const translated = json(join(dir, file))[lang]?.presets?.presets ?? {}
    const out = []
    for (const [id, tag] of categories) {
      const entry = translated[id]
      if (!entry?.name) continue
      // Le nom de la catégorie en premier : il l'emporte sur un synonyme partagé
      // (« restaurant » est le nom d'une catégorie et un synonyme de « café »).
      const name = entry.name.trim().toLowerCase()
      const others = new Set([...list(entry.terms), ...list(entry.aliases)].map((w) => w.trim().toLowerCase()).filter((w) => w && w !== name))
      out.push([tag, [name, ...[...others].sort()]])
    }
    for (const [tag, names] of Object.entries(EXTRA_NAMES[lang] ?? {})) for (const name of names) out.push([tag, [name]])
    if (out.length < MIN_CATEGORIES) continue
    out.sort((a, b) => a[0].localeCompare(b[0]))
    writeFileSync(join(OUT, 'categories', `${lang}.json`), JSON.stringify(out))
    langs++
  }

  // --- Enseignes ---------------------------------------------------------
  const nsi = json(join(unpack(NSI), 'json/nsi.json')).nsi
  const brands = new Map() // nom affiché -> autres noms
  for (const [path, group] of Object.entries(nsi)) {
    if (!path.startsWith('brands/')) continue
    for (const item of group.items) {
      const name = item.tags?.brand ?? item.tags?.name ?? item.displayName
      if (!name) continue
      const others = brands.get(name) ?? new Set()
      for (const alt of item.matchNames ?? []) if (alt.toLowerCase() !== name.toLowerCase()) others.add(alt.toLowerCase())
      brands.set(name, others)
    }
  }
  const brandList = [...brands].sort((a, b) => a[0].localeCompare(b[0])).map(([name, others]) => (others.size ? [name, ...[...others].sort()] : [name]))
  writeFileSync(join(OUT, 'brands.json'), JSON.stringify(brandList))

  console.log(`${categories.size} catégories en ${langs} langues, ${brandList.length} enseignes`)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
