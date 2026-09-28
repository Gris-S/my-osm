import { CONFIG } from "../../config";
import { parseWikipediaTag, wikiKey, wikidataTitles, type WikiRef, type WikiSummary } from "../wikipedia";
import { currentLang } from "../../i18n";
import { getWiki, listRegions, putRegion, putWiki, wikiRefsOfRegion, type OfflineRegion, type StoredWiki } from "./store";

// ---------------------------------------------------------------------------
// Wikipédia dans une zone hors ligne, sur le modèle d'OsmAnd (demande
// explicite, 28 septembre 2026) : les résumés des villes, quartiers, musées et
// monuments de la zone sont pris avec elle, et leurs photos si la case est
// cochée. La fiche les lit alors sur l'appareil, sans rien demander.
//
// Le coût reste mesuré : les titres se demandent à Wikidata par lots de
// cinquante, les résumés à Wikipédia par lots de vingt — pour Paris, de
// l'ordre de la centaine de requêtes, pas de milliers.
//
// Les résumés sont pris dans la langue de l'interface au moment du
// téléchargement. Changer de langue ensuite ne les rend pas faux, seulement
// moins utiles : la fiche retombe alors sur Wikipédia en ligne.
// ---------------------------------------------------------------------------

/** Résumés demandés par requête : le plafond d'`exintro` chez Wikipédia. */
const BATCH = 20;
/** Photos téléchargées de front. */
const PHOTO_PARALLEL = 4;

interface QueryPage {
  title: string;
  missing?: boolean;
  extract?: string;
  fullurl?: string;
  thumbnail?: { source: string };
  pageprops?: { disambiguation?: string };
}

interface QueryResponse {
  query?: {
    pages?: QueryPage[];
    normalized?: { from: string; to: string }[];
    redirects?: { from: string; to: string }[];
  };
}

/** Les résumés d'un lot de titres d'une même langue, rangés par titre demandé. */
async function fetchBatch(lang: string, titles: string[], signal: AbortSignal): Promise<Map<string, WikiSummary | null>> {
  const url = new URL(CONFIG.WIKIPEDIA_API_URL.replace("{lang}", lang));
  for (const [k, v] of Object.entries({
    action: "query",
    format: "json",
    formatversion: "2",
    origin: "*",
    prop: "extracts|pageimages|info|pageprops",
    exintro: "1",
    explaintext: "1",
    exlimit: String(BATCH),
    piprop: "thumbnail",
    pithumbsize: String(CONFIG.OFFLINE.WIKI_PHOTO_WIDTH),
    pilimit: String(BATCH),
    inprop: "url",
    ppprop: "disambiguation",
    redirects: "1",
    titles: titles.join("|"),
  })) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Wikipédia ${res.status}`);
  const data = (await res.json()) as QueryResponse;

  // Un titre demandé peut revenir normalisé, puis redirigé : on remonte la
  // chaîne pour ranger chaque résumé sous le titre qu'on avait demandé.
  const renamed = new Map<string, string>();
  for (const step of [...(data.query?.normalized ?? []), ...(data.query?.redirects ?? [])]) renamed.set(step.from, step.to);
  const finalTitle = (title: string) => {
    let current = title;
    for (let i = 0; i < 4 && renamed.has(current); i++) current = renamed.get(current)!;
    return current;
  };

  const pages = new Map((data.query?.pages ?? []).map((page) => [page.title, page]));
  const out = new Map<string, WikiSummary | null>();
  for (const title of titles) {
    const page = pages.get(finalTitle(title));
    if (!page || page.missing || !page.extract || page.pageprops?.disambiguation !== undefined) {
      out.set(title, null);
      continue;
    }
    out.set(title, {
      title: page.title,
      extract: page.extract,
      thumbnail: page.thumbnail?.source,
      url: page.fullurl ?? `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(page.title)}`,
      lang,
    });
  }
  return out;
}

async function fetchPhoto(url: string, signal: AbortSignal): Promise<Blob | undefined> {
  try {
    const res = await fetch(url, { signal });
    return res.ok ? await res.blob() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Prend les résumés Wikipédia des lieux d'une zone. Rend le nombre d'articles
 * trouvés et le poids écrit. Un lot qui échoue laisse un trou, pas un échec :
 * la fiche retombera sur Wikipédia en ligne pour ces lieux-là.
 */
export async function downloadWiki(
  region: OfflineRegion,
  refs: WikiRef[],
  lang: string,
  signal: AbortSignal,
  onProgress: (done: number, total: number) => void
): Promise<{ count: number; bytes: number }> {
  // Une seule fois chaque lieu, et seulement ceux qui ont une référence.
  const byKey = new Map<string, WikiRef>();
  for (const ref of refs) {
    const key = wikiKey(ref, lang);
    if (key && !byKey.has(key)) byKey.set(key, ref);
  }
  const entries = [...byKey.entries()];
  if (!entries.length) return { count: 0, bytes: 0 };

  // Le titre dans la langue de l'interface, par Wikidata ; celui de la balise
  // `wikipedia` sinon, dans sa propre langue.
  const ids = entries.map(([, ref]) => ref.wikidata).filter((id): id is string => !!id);
  let titles = new Map<string, Record<string, string>>();
  try {
    titles = await wikidataTitles(ids, [lang], signal);
  } catch {
    // Sans Wikidata, on s'en tient aux balises `wikipedia`.
  }
  const wanted = new Map<string, { key: string; title: string }[]>(); // langue → titres
  for (const [key, ref] of entries) {
    const id = ref.wikidata?.split(";")[0].trim();
    const inLang = id ? titles.get(id)?.[lang] : undefined;
    const tag = parseWikipediaTag(ref.wikipedia);
    const target = inLang ? { lang, title: inLang } : tag;
    if (!target) continue;
    const list = wanted.get(target.lang) ?? [];
    list.push({ key, title: target.title });
    wanted.set(target.lang, list);
  }

  const total = [...wanted.values()].reduce((sum, list) => sum + list.length, 0);
  let done = 0;
  let count = 0;
  let bytes = 0;
  onProgress(0, total);

  for (const [articleLang, list] of wanted) {
    for (let i = 0; i < list.length; i += BATCH) {
      if (signal.aborted) throw new DOMException("Annulé", "AbortError");
      const batch = list.slice(i, i + BATCH);
      let summaries: Map<string, WikiSummary | null>;
      try {
        summaries = await fetchBatch(articleLang, batch.map((b) => b.title), signal);
      } catch (err) {
        if (signal.aborted) throw err;
        done += batch.length;
        onProgress(done, total);
        continue;
      }

      const records: StoredWiki[] = batch.map(({ key, title }) => ({ key, region: region.id, summary: summaries.get(title) ?? null }));
      if (region.wikiPhotos) {
        const withPhoto = records.filter((r) => r.summary?.thumbnail);
        for (let j = 0; j < withPhoto.length; j += PHOTO_PARALLEL) {
          await Promise.all(
            withPhoto.slice(j, j + PHOTO_PARALLEL).map(async (record) => {
              record.photo = await fetchPhoto(record.summary!.thumbnail!, signal);
            })
          );
        }
      }
      await putWiki(records);
      for (const record of records) {
        if (!record.summary) continue;
        count += 1;
        bytes += record.summary.extract.length * 2 + (record.photo?.size ?? 0);
      }
      done += batch.length;
      onProgress(done, total);
      // Wikipédia est un service partagé : on ne le mitraille pas.
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  return { count, bytes };
}

// Une adresse locale par photo lue, gardée pour la session : la recréer à
// chaque ouverture de fiche en laisserait traîner une par ouverture.
const photoUrls = new Map<string, string>();

/**
 * Le résumé pris avec une zone, `undefined` si aucune zone ne l'a, `null` si
 * la zone sait qu'il n'y a pas d'article.
 */
export async function readOfflineWiki(key: string): Promise<WikiSummary | null | undefined> {
  try {
    const stored = await getWiki(key);
    if (!stored) return undefined;
    if (!stored.summary) return null;
    if (!stored.photo) return stored.summary;
    let url = photoUrls.get(key);
    if (!url) {
      url = URL.createObjectURL(stored.photo);
      photoUrls.set(key, url);
    }
    return { ...stored.summary, thumbnail: url };
  } catch {
    return undefined;
  }
}

let refreshing = false;

/**
 * Reprend les résumés des zones qui les ont depuis plus d'un mois
 * (`WIKI_REFRESH_MS`) — un article bouge peu, mais une photo change, une
 * population est mise à jour. Seuls les résumés sont repris : les tuiles ont
 * leur propre vérification. Appelé par la vérification des zones
 * (`useFreshness`), jamais deux fois de front.
 */
export async function refreshStaleWiki(): Promise<void> {
  if (refreshing || !navigator.onLine) return;
  refreshing = true;
  try {
    const now = Date.now();
    for (const region of await listRegions()) {
      if (region.status !== "ready" || !region.wiki) continue;
      if (now - (region.wikiAt ?? 0) < CONFIG.OFFLINE.WIKI_REFRESH_MS) continue;
      const refs = await wikiRefsOfRegion(region.id);
      const controller = new AbortController();
      try {
        const got = await downloadWiki(region, refs, currentLang(), controller.signal, () => {});
        await putRegion({ ...region, wikiAt: Date.now(), wikiCount: got.count });
      } catch {
        // Réseau perdu en route : ce sera pour la prochaine vérification.
      }
    }
  } finally {
    refreshing = false;
  }
}
