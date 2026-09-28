import { CONFIG } from "../config";
import { readPersistent, writePersistent } from "../transport/persistentCache";

// ---------------------------------------------------------------------------
// Le résumé Wikipédia d'un lieu : quelques phrases, une photo, le lien vers
// l'article (demande explicite, 28 septembre 2026, sur le modèle d'OsmAnd).
//
// Les lieux d'OSM portent deux références : `wikipedia` (« fr:Musée du
// Louvre ») et `wikidata` (« Q19675 »). La première est dans **une** langue ;
// la seconde permet de trouver le titre dans celle de l'interface — « Musée
// du Louvre » en français, « Louvre » en anglais. On lit donc l'article dans
// la langue de l'interface quand il existe, dans celle de la balise sinon.
//
// En ligne, un résumé lu est gardé trente jours sur l'appareil, et revérifié
// ensuite. Hors ligne, il se lit dans la zone téléchargée qui l'a pris avec
// elle (`offline/`).
// ---------------------------------------------------------------------------

export interface WikiSummary {
  title: string;
  /** L'introduction de l'article, en texte brut. */
  extract: string;
  /** La vignette de l'article, quand il en a une. */
  thumbnail?: string;
  /** L'article complet, à ouvrir dans le navigateur. */
  url: string;
  /** La langue de l'article, qui peut différer de celle de l'interface. */
  lang: string;
}

export interface WikiRef {
  wikidata?: string;
  wikipedia?: string;
}

/** « fr:Musée du Louvre » → { lang: "fr", title: "Musée du Louvre" }. */
export function parseWikipediaTag(tag: string | undefined): { lang: string; title: string } | null {
  const m = /^([a-z]{2,3}(?:-[a-z]+)?):(.+)$/i.exec((tag ?? "").trim());
  return m ? { lang: m[1].toLowerCase(), title: m[2].trim() } : null;
}

/** Un identifiant Wikidata valide, ou rien : il part dans une adresse. */
function wikidataId(value: string | undefined): string | null {
  const id = (value ?? "").trim().split(";")[0];
  return /^Q\d+$/.test(id) ? id : null;
}

function endpoint(template: string, lang: string): string {
  // La langue vient d'une balise OSM : on n'en accepte que la forme d'un code.
  if (!/^[a-z]{2,3}(-[a-z]+)?$/.test(lang)) throw new Error(`Langue invalide : ${lang}`);
  return template.replace("{lang}", lang);
}

/** Le titre de l'article dans chaque langue demandée, pour des objets Wikidata. */
export async function wikidataTitles(ids: string[], langs: string[], signal?: AbortSignal): Promise<Map<string, Record<string, string>>> {
  const out = new Map<string, Record<string, string>>();
  const valid = [...new Set(ids.map(wikidataId).filter((id): id is string => !!id))];
  for (let i = 0; i < valid.length; i += 50) {
    let batch = valid.slice(i, i + 50);
    // Un seul identifiant inconnu fait refuser **tout** le lot par Wikidata
    // (`no-such-entity`) — et OSM en porte parfois un d'un objet supprimé.
    // L'identifiant fautif, que l'erreur nomme, est retiré et le lot redemandé.
    for (let attempt = 0; attempt < 5 && batch.length; attempt++) {
      const url = new URL(CONFIG.WIKIDATA_API_URL);
      for (const [k, v] of Object.entries({
        action: "wbgetentities",
        format: "json",
        origin: "*",
        props: "sitelinks",
        sitefilter: langs.map((l) => `${l}wiki`).join("|"),
        ids: batch.join("|"),
      })) {
        url.searchParams.set(k, v);
      }
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`Wikidata ${res.status}`);
      const data = (await res.json()) as {
        error?: { code?: string; id?: string };
        entities?: Record<string, { missing?: string; sitelinks?: Record<string, { title: string }> }>;
      };
      if (data.error) {
        const bad = data.error.id;
        if (data.error.code !== "no-such-entity" || !bad || !batch.includes(bad)) break;
        batch = batch.filter((id) => id !== bad);
        continue;
      }
      for (const [id, entity] of Object.entries(data.entities ?? {})) {
        if (entity.missing !== undefined) continue;
        const titles: Record<string, string> = {};
        for (const [site, link] of Object.entries(entity.sitelinks ?? {})) titles[site.replace(/wiki$/, "")] = link.title;
        out.set(id, titles);
      }
      break;
    }
  }
  return out;
}

/** Où lire l'article : dans la langue voulue si possible, dans celle de la balise sinon. */
export async function resolveArticle(ref: WikiRef, lang: string, signal?: AbortSignal): Promise<{ lang: string; title: string } | null> {
  const tag = parseWikipediaTag(ref.wikipedia);
  if (tag && tag.lang === lang) return tag;
  const id = wikidataId(ref.wikidata);
  if (id) {
    const titles = (await wikidataTitles([id], [lang], signal)).get(id);
    if (titles?.[lang]) return { lang, title: titles[lang] };
  }
  return tag;
}

interface RestSummary {
  type?: string;
  title?: string;
  extract?: string;
  thumbnail?: { source?: string };
  content_urls?: { desktop?: { page?: string } };
}

/** Le résumé d'un article nommé, tel que le rend l'API REST de Wikipédia. */
export async function fetchSummary(lang: string, title: string, signal?: AbortSignal): Promise<WikiSummary | null> {
  const url = endpoint(CONFIG.WIKIPEDIA_SUMMARY_URL, lang) + encodeURIComponent(title.replace(/ /g, "_"));
  const res = await fetch(url, { signal });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Wikipédia ${res.status}`);
  const data = (await res.json()) as RestSummary;
  // Une page d'homonymie ne décrit rien : mieux vaut ne rien montrer.
  if (data.type === "disambiguation" || !data.extract) return null;
  return {
    title: data.title ?? title,
    extract: data.extract,
    thumbnail: data.thumbnail?.source,
    url: data.content_urls?.desktop?.page ?? `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`,
    lang,
  };
}

/** Clé d'un résumé, dans le cache comme dans une zone téléchargée. */
export function wikiKey(ref: WikiRef, lang: string): string | null {
  const id = wikidataId(ref.wikidata) ?? parseWikipediaTag(ref.wikipedia)?.title;
  return id ? `wiki:v1:${lang}:${id}` : null;
}

/**
 * Le résumé d'un lieu, `null` s'il n'a pas d'article. Lu d'abord sur
 * l'appareil (cache, puis zones hors ligne), sinon demandé à Wikipédia et
 * gardé trente jours.
 */
export async function wikiSummary(
  ref: WikiRef,
  lang: string,
  signal?: AbortSignal,
  offline?: (key: string) => Promise<WikiSummary | null | undefined>
): Promise<WikiSummary | null> {
  const key = wikiKey(ref, lang);
  if (!key) return null;
  // Une absence est gardée aussi (`{ none: true }`) : sans quoi chaque
  // ouverture d'un lieu sans article referait les deux requêtes.
  // La zone téléchargée d'abord : c'est tout l'intérêt de l'avoir prise — la
  // fiche se lit sur l'appareil, sans rien demander (elle est reprise chaque
  // mois avec la zone).
  const stored = await offline?.(key);
  if (stored !== undefined) return stored;
  const cached = await readPersistent<WikiSummary | { none: true }>(key);
  if (cached) return "none" in cached ? null : cached;

  const article = await resolveArticle(ref, lang, signal);
  const summary = article ? await fetchSummary(article.lang, article.title, signal) : null;
  await writePersistent(key, summary ?? { none: true }, CONFIG.WIKIPEDIA_CACHE_TTL_MS);
  return summary;
}
