import { CONFIG } from "../config";
import { currentLang, t } from "../i18n";
import type { Place } from "../types";
import { geocodeAddress } from "./geocode";
import {
  candidateFromPage,
  candidateFromSelection,
  parseMapLink,
  placeFromCandidate,
  WEB_BLOCKED_HOSTS,
  WEB_LINK_PATTERNS,
  webSearchUrl,
  type WebCandidate,
  type WebPageData,
} from "./webPlace";

// ---------------------------------------------------------------------------
// Chercher sur le web ce que la carte ne connaît pas.
//
// OpenStreetMap n'a pas tout — le McDonald's ouvert le mois dernier, un
// commerce que personne n'a encore ajouté. La barre de recherche propose donc
// toujours, en dernier, « Chercher … sur le web ». Dans l'APK, la page s'ouvre
// dans un **navigateur intégré** (greffon natif `WebSearch`,
// `apk/android/.../WebSearchPlugin.java`) ; dans un navigateur, dans un nouvel
// onglet.
//
// **Retrouver le lieu sans copier-coller**, par trois voies :
// - la page le décrit elle-même (données schema.org, balises de position, un
//   unique lien de carte, une unique adresse) : il est proposé tout de suite ;
// - on touche un lien « Itinéraire » vers Google Maps, Plans, Waze, OSM… : le
//   lien **n'est pas ouvert**, sa position est lue dans son texte ;
// - on sélectionne l'adresse dans la page : elle est placée sur la carte.
// Un bandeau en bas du navigateur montre le lieu retenu ; « Voir sur la
// carte » le rend à la barre de recherche, comme n'importe quel résultat.
//
// **Ce qui part, et vers qui** : la recherche tapée, à DuckDuckGo ; les pages
// qu'on ouvre, à leurs sites. Rien d'autre — ni position de l'appareil, ni
// cookie tiers, ni requête vers Google (voir `WEB_BLOCKED_HOSTS`). L'adresse
// sélectionnée est géocodée **sans la position** de l'appareil : une adresse
// de page porte sa ville.
// ---------------------------------------------------------------------------

type BarState = "hint" | "busy" | "found" | "notice";

interface WebSearchPlugin {
  open: (options: {
    url: string;
    dark: boolean;
    script: string;
    linkPatterns: string[];
    blockedHosts: string;
    labels: { close: string; back: string; hint: string };
  }) => unknown;
  setCandidate: (options: { state: BarState; title: string; subtitle?: string; action: string }) => unknown;
  close: () => unknown;
  addListener: (event: string, listener: (data: unknown) => void) => unknown;
}

interface CapacitorGlobal {
  Plugins?: Record<string, unknown>;
  isPluginAvailable?: (name: string) => boolean;
}

function plugin(): WebSearchPlugin | null {
  const capacitor = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  if (!capacitor?.isPluginAvailable?.("WebSearch")) return null;
  return (capacitor.Plugins?.WebSearch as WebSearchPlugin | undefined) ?? null;
}

/**
 * Injecté dans chaque page, au chargement puis deux fois ensuite (les pages
 * qui construisent leur contenu en JavaScript, DuckDuckGo compris). Il relève
 * ce qui peut désigner un lieu et suit la sélection de texte ; le tri se fait
 * ici, dans `webPlace.ts`, où il est testé. `MyOsmWeb` est l'interface que le
 * greffon expose à la page, et elle ne fait que transmettre.
 */
const PAGE_SCRIPT = `(function () {
  try {
    if (!window.__myOsmSelection) {
      window.__myOsmSelection = true;
      var timer = 0;
      document.addEventListener("selectionchange", function () {
        clearTimeout(timer);
        timer = setTimeout(function () {
          var text = String(window.getSelection() || "").trim();
          if (text) MyOsmWeb.selection(text);
        }, 400);
      });
    }
    var all = function (selector) { return Array.prototype.slice.call(document.querySelectorAll(selector)); };
    var metas = {};
    ["og:title", "place:location:latitude", "place:location:longitude", "og:latitude", "og:longitude", "geo.position", "ICBM"].forEach(function (name) {
      var meta = document.querySelector('meta[property="' + name + '"], meta[name="' + name + '"]');
      if (meta) metas[name] = meta.getAttribute("content");
    });
    var keys = ["maps", "geo:", "waze", "openstreetmap", "osm.org", "here.com"];
    MyOsmWeb.page(JSON.stringify({
      url: location.href,
      title: document.title,
      ld: all('script[type="application/ld+json"]').slice(0, 20).map(function (s) { return s.textContent; }),
      addr: all('address, [itemprop="address"]').slice(0, 5).map(function (e) { return e.innerText; }),
      card: (function () {
        var cards = all('article[data-testid="maps-vertical-detail"]');
        if (cards.length !== 1) return null;
        var card = cards[0], title = card.querySelector("h1, h2, h3");
        var site = Array.prototype.slice.call(card.querySelectorAll('a[href^="http"]')).filter(function (a) {
          return /^(www\\.)?[a-z0-9-]+\\.[a-z]/i.test((a.innerText || "").trim()) && a.href.indexOf("duckduckgo.com") < 0;
        })[0];
        return {
          name: title ? title.innerText : "",
          fields: Array.prototype.slice.call(card.querySelectorAll("dd")).slice(0, 12).map(function (d) { return d.innerText; }),
          website: site ? site.href : ""
        };
      })(),
      metas: metas,
      links: all("a[href]").map(function (a) { return a.href; }).filter(function (href) {
        var h = href.toLowerCase();
        return keys.some(function (k) { return h.indexOf(k) >= 0; });
      }).slice(0, 30)
    }));
  } catch (e) {}
})();`;

/** Retire un écouteur du greffon, quelle que soit la forme de la poignée (voir `ambientLight.ts`). */
function removeHandle(handle: unknown) {
  try {
    const remove = (handle as { remove?: unknown } | null)?.remove;
    if (typeof remove === "function") void Promise.resolve(remove.call(handle)).catch(() => {});
  } catch {
    /* rien à retirer */
  }
}

/** La session en cours : les écouteurs du greffon sont communs, une seule à la fois. */
let endSession: (() => void) | null = null;

/**
 * Ouvre la recherche `query` sur le web. `onPlace` reçoit le lieu retrouvé,
 * quand l'utilisateur touche « Voir sur la carte ».
 */
export function openWebSearch(query: string, onPlace: (place: Place) => void): void {
  const url = webSearchUrl(CONFIG.WEB_SEARCH_URL, query, {
    lang: currentLang(),
    dark: document.documentElement.dataset.theme === "dark",
  });
  const browser = plugin();
  if (!browser) {
    // Navigateur : un onglet, sans lien de retour. L'adresse trouvée se colle
    // dans la barre, qui reconnaît aussi les liens de carte.
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }

  endSession?.();
  const handles: unknown[] = [];
  let found: Place | null = null;
  /** Vrai dès que l'utilisateur a désigné un lieu sur la page en cours : la page ne le remplace plus. */
  let chosen = false;
  let lastPage = "";
  /**
   * Le nom du lieu que la page décrit, s'il n'y en a qu'un. Un lien
   * « Itinéraire » ou une adresse sélectionnée sur cette même page n'en portent
   * pas : c'est celui-ci qu'ils prennent (« McDonald's » plutôt que l'adresse).
   */
  let pageName: string | undefined;
  /** Chaque proposition porte son numéro : un géocodage qui revient trop tard ne s'affiche pas. */
  let turn = 0;

  const call = (action: () => unknown) => {
    try {
      void Promise.resolve(action()).catch(() => {});
    } catch {
      /* le navigateur a pu être fermé entre-temps */
    }
  };
  const show = (state: BarState, title: string, subtitle?: string) =>
    call(() => browser.setCandidate({ state, title, subtitle, action: t("webSearch.go") }));

  async function propose(candidate: WebCandidate, byUser: boolean) {
    if (!byUser && chosen) return;
    if (byUser) chosen = true;
    if (byUser && !candidate.name && pageName) candidate = { ...candidate, name: pageName };
    const mine = ++turn;
    found = null;
    let located = candidate;
    if (located.lat === undefined && located.address) {
      show("busy", t("webSearch.locating"), located.address);
      const first = await geocodeAddress(located.address).catch(() => null);
      if (mine !== turn) return;
      if (!first) {
        show("notice", t("webSearch.notFound"), t("webSearch.notFoundHint"));
        return;
      }
      located = { ...located, lat: first.lat, lon: first.lon, name: located.name ?? first.name };
    }
    const place = placeFromCandidate(located, query);
    if (!place || mine !== turn) return;
    found = place;
    show("found", place.name, place.address);
  }

  const listen = (event: string, listener: (data: Record<string, unknown>) => void) => {
    try {
      const handle = browser.addListener(event, (data) => listener((data ?? {}) as Record<string, unknown>));
      void Promise.resolve(handle).then((resolved) => handles.push(resolved), () => {});
    } catch {
      /* greffon incomplet : la page s'ouvre quand même */
    }
  };

  const end = () => {
    handles.splice(0).forEach(removeHandle);
    if (endSession === end) endSession = null;
  };
  endSession = end;

  listen("navigate", () => {
    chosen = false;
    lastPage = "";
    pageName = undefined;
    found = null;
    turn++;
    show("hint", t("webSearch.hint"));
  });
  listen("page", (data) => {
    const json = typeof data.json === "string" ? data.json : "";
    if (!json || json === lastPage) return;
    lastPage = json;
    let page: WebPageData;
    try {
      page = JSON.parse(json) as WebPageData;
    } catch {
      return;
    }
    const candidate = candidateFromPage(page);
    if (candidate?.name) pageName = candidate.name;
    if (candidate) void propose(candidate, false);
  });
  listen("selection", (data) => {
    const candidate = typeof data.text === "string" ? candidateFromSelection(data.text) : null;
    if (candidate) void propose(candidate, true);
  });
  listen("link", (data) => {
    const link = typeof data.url === "string" ? parseMapLink(data.url) : null;
    if (!link) return;
    if (link.kind === "short") {
      turn++;
      found = null;
      show("notice", t("webSearch.shortLink"), t("webSearch.shortLinkHint"));
    } else if (link.kind === "point") {
      void propose({ lat: link.lat, lon: link.lon, name: link.label }, true);
    } else {
      void propose({ address: link.text }, true);
    }
  });
  listen("blocked", () => {
    if (!found) show("notice", t("webSearch.blocked"), t("webSearch.blockedHint"));
  });
  listen("go", () => {
    if (!found) return;
    const place = found;
    call(() => browser.close());
    onPlace(place);
  });
  listen("closed", end);

  call(() =>
    browser.open({
      url,
      dark: document.documentElement.dataset.theme === "dark",
      script: PAGE_SCRIPT,
      linkPatterns: WEB_LINK_PATTERNS,
      blockedHosts: WEB_BLOCKED_HOSTS,
      labels: { close: t("webSearch.close"), back: t("webSearch.back"), hint: t("webSearch.hint") },
    })
  );
}
