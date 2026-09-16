// ---------------------------------------------------------------------------
// Parcours de vérification de MY OSM, sur un téléphone branché.
//
// Il existe parce qu'un audit de code ne dit rien de ce que l'application
// **fait** : l'écart entre la durée annoncée par le panneau d'itinéraire et
// celle de l'écran de choix a vécu des mois sans être vu, et aucun test
// unitaire ne pouvait le voir — les deux nombres étaient justes chacun de son
// côté. Ce qui manquait était de les regarder **ensemble**.
//
// D'où la forme : des scénarios qui pilotent l'application comme un doigt, et
// qui **affirment** — pas qui capturent en espérant qu'on regarde.
//
//   outils/parcours.sh                 tout le parcours
//   outils/parcours.sh coherence       un scénario, par son identifiant
//   outils/parcours.sh --liste         ce qui existe
//
// L'application doit être ouverte, et l'APK **débogable** : le pilotage passe
// par le débogage de la WebView, que la version release coupe. C'est la raison
// d'être de `npm run apk:nokeys` — un APK débogable **sans clés**, seule façon
// d'essayer la configuration que recevront les utilisateurs de F-Droid.
//
// Ce que le parcours ne remplace pas : l'œil. Les captures sont écrites à côté
// du rapport, et une assertion qui passe ne dit pas qu'un panneau est joli.
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PORT = process.argv[2];
const SORTIE = process.argv[3];
const DEMANDES = process.argv.slice(4);

const PAQUET = "org.osmlocal.plans";

// --- Le pont vers la WebView -----------------------------------------------

let ws = null;
let prochainId = 1;
const enAttente = new Map();

/**
 * S'attache à la page **et attend que l'application y soit construite**.
 *
 * Les deux vont ensemble, et le premier passage du parcours l'a appris à ses
 * dépens : s'attacher juste après un rechargement donne une page vide — ni
 * `window.__myosm`, ni champ de recherche, ni carte. Le parcours accusait alors
 * l'application de ne rien afficher, alors qu'il l'avait interrogée trop tôt.
 *
 * On réessaie donc jusqu'à ce que la page soit **complète et la carte
 * dessinée** : c'est le seul état où une vérification veut dire quelque chose.
 */
/**
 * (Re)pose la redirection du port vers la socket de débogage de la WebView.
 *
 * Le nom de cette socket porte le **PID** de l'application. Or un scénario peut
 * faire redémarrer le processus — Android tue une application dont on change
 * une permission — et elle revient sous un autre PID. La redirection posée au
 * lancement du parcours pointe alors dans le vide, et tout ce qui suit échoue
 * sur un « fetch failed » qui a toutes les apparences d'une panne de
 * l'application. C'en est une du parcours.
 */
function rediriger() {
  try {
    const pid = adb("shell", "pidof", PAQUET).trim().split(/\s+/)[0];
    if (!pid) return false;
    const socket = `webview_devtools_remote_${pid}`;
    if (!adb("shell", "cat", "/proc/net/unix").includes(socket)) return false;
    try {
      adb("forward", "--remove", `tcp:${PORT}`);
    } catch {
      /* il n'y avait rien à retirer */
    }
    adb("forward", `tcp:${PORT}`, `localabstract:${socket}`);
    return true;
  } catch {
    // L'application n'est pas encore revenue : la prochaine tentative verra.
    return false;
  }
}

async function connecter(delai = 25_000) {
  const fin = Date.now() + delai;
  let dernier = "";
  while (Date.now() < fin) {
    try {
      if (ws) {
        try {
          ws.close();
        } catch {
          /* déjà fermée */
        }
        enAttente.clear();
      }
      rediriger();
      await attacher();
      const pret = await js("document.readyState === 'complete' && !!document.querySelector('.map-container canvas')");
      if (pret) return;
      dernier = "page incomplète";
    } catch (erreur) {
      dernier = String(erreur.message ?? erreur);
    }
    await dodo(700);
  }
  throw new Error(`L'application n'est pas prête après ${delai / 1000} s (${dernier}).`);
}

async function attacher() {
  const cibles = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  // **La page de l'application, pas n'importe laquelle.** Le navigateur intégré
  // de la recherche sur le web ouvre sa *propre* WebView, qui se place en tête
  // de la liste : le parcours s'y est attaché et a conclu que l'application
  // n'affichait ni carte ni champ de recherche. Elle allait très bien — il
  // regardait DuckDuckGo.
  const page = cibles.find((c) => c.type === "page" && String(c.url).startsWith("https://localhost"));
  if (!page) {
    const vues = cibles.filter((c) => c.type === "page").map((c) => c.url);
    throw new Error(
      `Page de l'application introuvable${vues.length ? ` (cibles vues : ${vues.join(", ")})` : " : l'application est-elle ouverte ?"}`
    );
  }
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok, ko) => {
    ws.addEventListener("open", ok, { once: true });
    ws.addEventListener("error", () => ko(new Error("WebView injoignable")), { once: true });
  });
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const attente = enAttente.get(message.id);
    if (!attente) return;
    enAttente.delete(message.id);
    const erreur = message.result?.exceptionDetails;
    if (erreur) attente.ko(new Error(erreur.exception?.description ?? "erreur dans la page"));
    else attente.ok(message.result?.result?.value);
  });
}

/** Évalue une expression dans la page et rend sa valeur. */
function js(expression) {
  return new Promise((ok, ko) => {
    const id = prochainId++;
    enAttente.set(id, { ok, ko });
    ws.send(
      JSON.stringify({
        id,
        method: "Runtime.evaluate",
        params: { expression, returnByValue: true, awaitPromise: true },
      })
    );
    setTimeout(() => {
      if (enAttente.delete(id)) ko(new Error("la page n'a pas répondu"));
    }, 20_000);
  });
}

// --- Les gestes -------------------------------------------------------------

const adb = (...args) => execFileSync("adb", args, { encoding: "utf8" });
const dodo = (ms) => new Promise((ok) => setTimeout(ok, ms));

/** Attend qu'un sélecteur apparaisse. Rend faux au bout du délai, sans lever. */
async function attendre(selecteur, delai = 12_000) {
  const fin = Date.now() + delai;
  while (Date.now() < fin) {
    if (await js(`!!document.querySelector(${JSON.stringify(selecteur)})`)) return true;
    await dodo(400);
  }
  return false;
}

const cliquer = (selecteur) =>
  js(`(()=>{const e=document.querySelector(${JSON.stringify(selecteur)});if(!e)return false;e.click();return true})()`);

const texte = (selecteur) =>
  js(`(()=>{const e=document.querySelector(${JSON.stringify(selecteur)});return e?e.innerText.replace(/\\n+/g,' · '):null})()`);

/** Saisit dans le champ de recherche. React écoute l'événement, pas la propriété. */
const saisir = (valeur) =>
  js(`(()=>{const i=document.querySelector('input');if(!i)return false;i.focus();
    const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
    set.call(i,${JSON.stringify(valeur)});i.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);

/** Attend qu'une condition soit vraie dans la page. Rend faux au bout du délai. */
async function attendreQue(expression, delai = 15_000) {
  const fin = Date.now() + delai;
  while (Date.now() < fin) {
    if (await js(expression)) return true;
    await dodo(400);
  }
  return false;
}

/**
 * Touche le premier **lieu** de la liste de résultats.
 *
 * Et non le premier résultat : les lignes « afficher toutes les enseignes »
 * s'affichent dès la deuxième lettre, sans rien demander à personne, alors que
 * les lieux arrivent du géocodeur une seconde plus tard. Attendre
 * `.search-result` tout court revenait donc à cliquer dans une liste qui ne
 * contenait encore que des enseignes — le premier passage du parcours a échoué
 * exactement là, et sans cette distinction il aurait accusé l'application.
 */
/**
 * Un **vrai lieu** dans la liste de résultats : un `.search-result` sans aucun
 * modificateur.
 *
 * La liste en mêle cinq sortes (`SearchBar.tsx`) : `is-shortcut` pour Maison et
 * Travail, `is-recent` pour l'historique, `is-brand` pour les enseignes et les
 * coordonnées collées, `is-web` pour « Chercher sur le web », et les lieux, qui
 * ne portent rien. Écarter les seules enseignes ne suffisait pas : le parcours
 * touchait « Chercher sur le web », ouvrait le navigateur intégré, et la suite
 * s'effondrait.
 */
const LIEU = ".search-result:not(.is-brand):not(.is-web):not(.is-shortcut):not(.is-recent)";

async function cliquerPremierLieu() {
  if (!(await attendreQue(`document.querySelectorAll('${LIEU}').length > 0`))) {
    const offert = await js(
      "[...document.querySelectorAll('.search-result')].map(e=>e.className).join(' / ') || 'aucun résultat'"
    );
    verifier("un lieu apparaît dans les résultats", false, offert);
    return null;
  }
  const nom = await js(`(()=>{const e=document.querySelector('${LIEU}');
    if(!e)return null;const t=e.innerText.replace(/\\n+/g,' · ');e.click();return t})()`);
  verifier("un lieu de la liste est touché", nom !== null, (nom ?? "").slice(0, 50));
  return nom;
}

const reglages = (objet) =>
  js(
    `(()=>{${Object.entries(objet)
      .map(([cle, valeur]) =>
        valeur === null
          ? `localStorage.removeItem(${JSON.stringify(cle)});`
          : `localStorage.setItem(${JSON.stringify(cle)},${JSON.stringify(valeur)});`
      )
      .join("")}return true})()`
  );

/**
 * Remplace la géolocalisation par une position fixe.
 *
 * Un rechargement l'efface — c'est voulu : aucun essai ne doit laisser une
 * position inventée derrière lui.
 */
const positionSimulee = (lat, lon, cap = 95, vitesse = 13.9) =>
  js(`(()=>{const f={coords:{latitude:${lat},longitude:${lon},accuracy:5,heading:${cap},speed:${vitesse},altitude:null,altitudeAccuracy:null},timestamp:Date.now()};
    navigator.geolocation.getCurrentPosition=(ok)=>ok(f);
    navigator.geolocation.watchPosition=(ok)=>{ok(f);return setInterval(()=>ok({...f,timestamp:Date.now()}),1000)};
    navigator.geolocation.clearWatch=(id)=>clearInterval(id);return true})()`);

async function recharger() {
  // La promesse ne revient jamais : la page part avant de répondre.
  js("location.reload()").catch(() => {});
  // Juste de quoi laisser le rechargement commencer ; c'est `connecter` qui
  // attend qu'il soit **fini**, et lui seul sait le vérifier.
  await dodo(2500);
  await connecter();
}

const carteVers = (lon, lat, zoom) =>
  js(`(()=>{if(!window.__myosm?.map)return false;window.__myosm.map.jumpTo({center:[${lon},${lat}],zoom:${zoom},bearing:0,pitch:0});return true})()`);

function capture(nom) {
  const fichier = join(SORTIE, `${nom}.png`);
  writeFileSync(fichier, execFileSync("adb", ["exec-out", "screencap", "-p"], { maxBuffer: 64 * 1024 * 1024 }));
  return fichier;
}

// --- Les chemins d'accès aux panneaux ---------------------------------------

/** Ouvre le menu principal et attend son panneau. */
async function ouvrirMenu() {
  await cliquer(".app-menu-button");
  return attendre(".app-menu-panel");
}

/**
 * Touche l'entrée du menu dont le libellé correspond.
 *
 * `motif` s'écrit en toutes lettres (`"/Downloads|Téléchargement/i"`) : il est
 * évalué **dans la page**, pas ici. Les deux langues y figurent parce qu'un
 * scénario peut tourner après un autre qui a laissé l'interface en français.
 */
const entreeMenu = (motif) =>
  js(`(()=>{const b=[...document.querySelectorAll('.app-menu-item')].find(x=>${motif}.test(x.innerText||''));
    if(!b)return false;b.click();return true})()`);

/** Referme une modale par sa croix, à défaut par le geste retour. */
async function fermerModale() {
  const ferme = await js("(()=>{const b=document.querySelector('.settings-close');if(!b)return false;b.click();return true})()");
  if (!ferme) adb("shell", "input", "keyevent", "4");
  await dodo(900);
}

const lire = (cle) => js(`localStorage.getItem(${JSON.stringify(cle)})`);

/**
 * Exécute `corps` — une fonction écrite en toutes lettres, qui reçoit la base —
 * sur la base des cartes hors ligne, et rend son résultat.
 */
const surLesZones = (corps) =>
  js(`(async()=>{const db=await new Promise((ok,ko)=>{const r=indexedDB.open('osm-local-hors-ligne',2);
    r.onsuccess=()=>ok(r.result);r.onerror=()=>ko(r.error)});
    const fait=await (${corps})(db);db.close();return fait})()`);

/** Ramène l'application au premier plan après un passage en veille. */
function reveiller() {
  adb("shell", "monkey", "-p", PAQUET, "-c", "android.intent.category.LAUNCHER", "1");
}

// --- Le rapport -------------------------------------------------------------

const resultats = [];
let scenarioCourant = "";

function verifier(libelle, condition, detail = "") {
  const ok = !!condition;
  resultats.push({ scenario: scenarioCourant, libelle, ok, detail });
  console.log(`   ${ok ? "✓" : "✗"} ${libelle}${detail ? `  — ${detail}` : ""}`);
  return ok;
}

// --- Les scénarios ----------------------------------------------------------

/** Remet l'appareil dans un état neutre, connu, avant chaque scénario. */
async function scene({ theme = "light", langue = "en", fond = "standard", filtres = '["transport"]' } = {}) {
  await reglages({
    "osm-local:theme": theme,
    "osm-local:lang": langue,
    "osm-local:basemap": fond,
    "osm-local:filters": filtres,
    // La fenêtre d'accueil est marquée **vue**. Sans cela, elle se poserait sur
    // l'interface après chaque rechargement — c'est-à-dire au début de chaque
    // scénario — et son voile avalerait tous les clics : les vingt-deux
    // échoueraient d'un coup, pour une fenêtre qui fonctionne parfaitement.
    // Le scénario `premier-lancement` est le seul à l'effacer, exprès.
    "osm-local:first-run-seen": "on",
  });
  await recharger();
}

const SCENARIOS = [
  {
    id: "demarrage",
    titre: "L'application démarre et affiche une carte",
    async executer() {
      await scene();
      verifier("la carte est dessinée", await js("!!document.querySelector('.map-container canvas')"));
      verifier("aucune panne de carte signalée", !(await js("!!document.querySelector('.map-status.is-error')")));
      const version = await js("(()=>{const m=[...document.querySelectorAll('*')].find(e=>/Version 0\\./.test(e.textContent||''));return m?m.textContent.trim():null})()");
      verifier("la barre de recherche est là", await js("!!document.querySelector('input')"));
      capture("01-demarrage");
      return { version };
    },
  },
  {
    id: "recherche",
    titre: "Chercher un lieu et ouvrir sa fiche",
    async executer() {
      await scene();
      await carteVers(2.3478, 48.865, 16);
      await saisir("Bastille");
      verifier("des résultats apparaissent", await attendre(".search-result"));
      await cliquerPremierLieu();
      verifier("la fiche s'ouvre", await attendre(".sheet"));
      const contenu = (await texte(".sheet")) ?? "";
      verifier("la fiche porte un nom", contenu.length > 3, contenu.slice(0, 60));
      verifier("la fiche propose un itinéraire", await js("!!document.querySelector('.sheet-action-primary')"));
      capture("02-fiche");
    },
  },
  {
    id: "itineraire",
    titre: "Le panneau d'itinéraire : trois modes, deux chiffres",
    async executer() {
      await scene();
      await positionSimulee(48.86, 2.3376);
      await carteVers(2.3376, 48.86, 15);
      await saisir("Bastille");
      await attendre(".search-result");
      await cliquerPremierLieu();
      await attendre(".sheet");
      await cliquer(".sheet-action-primary");
      verifier("le panneau s'ouvre", await attendre(".itinerary-panel"));
      verifier("les trois modes sont offerts", (await js("document.querySelectorAll('.itinerary-mode').length")) === 3);
      verifier("un résultat est calculé", await attendre(".itinerary-result", 25_000));
      const enfants = await js("(()=>{const r=document.querySelector('.itinerary-result');return r?[...r.children].map(c=>c.className||c.tagName).join('|'):''})()");
      // Demande explicite : la durée, la distance, le départ. Rien d'autre.
      verifier(
        "le résultat se limite à durée + distance + départ",
        enfants === "itinerary-duration|itinerary-distance|nav-start",
        enfants
      );
      capture("03-itineraire");
    },
  },
  {
    id: "coherence",
    titre: "La durée du panneau et celle de la bulle s'accordent",
    async executer() {
      // Le défaut qui a motivé tout ce parcours : deux écrans, deux moteurs,
      // deux chiffres pour le même trajet à la même seconde.
      await scene();
      await positionSimulee(48.86, 2.3376);
      await carteVers(2.3376, 48.86, 15);
      await saisir("Bastille");
      await attendre(".search-result");
      await cliquerPremierLieu();
      await attendre(".sheet");
      await cliquer(".sheet-action-primary");
      if (!(await attendre(".itinerary-result", 25_000))) return verifier("un itinéraire est calculé", false);
      await dodo(12_000); // le temps que le moteur du trafic réponde
      const panneau = await texte(".itinerary-result");
      const minutesPanneau = Number(/(\d+)\s*min/.exec(panneau ?? "")?.[1] ?? NaN);
      verifier("le panneau annonce une durée", Number.isFinite(minutesPanneau), panneau ?? "");

      await cliquer(".nav-start");
      const bulle = (await attendre(".route-choice-bubble", 40_000)) ? await texte(".route-choice-bubble") : null;
      if (bulle === null) {
        // Sans clé TomTom il n'y a qu'une proposition, et l'écran de choix le dit.
        return verifier("un écran de choix apparaît", await js("!!document.querySelector('.car-choice-bar')"), "sans clé ?");
      }
      const minutesBulle = Number(/(\d+)\s*min/.exec(bulle)?.[1] ?? NaN);
      verifier(
        "les deux écrans annoncent la même durée",
        Math.abs(minutesPanneau - minutesBulle) <= 1,
        `panneau ${minutesPanneau} min · bulle ${minutesBulle} min`
      );
      capture("04-coherence");
      await js("(()=>{const b=document.querySelector('.car-choice-cancel');if(b)b.click();return true})()");
    },
  },
  {
    id: "hors-ligne",
    titre: "Hors ligne, l'application le dit",
    async executer() {
      await scene();
      adb("shell", "cmd", "connectivity", "airplane-mode", "enable");
      await dodo(6000);
      verifier("le bandeau hors ligne apparaît", await attendre(".map-status", 15_000), (await texte(".map-status")) ?? "");
      capture("05-hors-ligne");
      adb("shell", "cmd", "connectivity", "airplane-mode", "disable");
      await dodo(8000);
    },
  },
  {
    id: "reglages",
    titre: "Les réglages survivent à un redémarrage",
    async executer() {
      await scene({ theme: "light", langue: "en" });
      await reglages({ "osm-local:theme": "dark", "osm-local:lang": "fr" });
      await recharger();
      verifier("le thème sombre est repris", (await js("document.documentElement.getAttribute('data-theme')")) === "dark");
      verifier("la langue française est reprise", (await js("document.documentElement.lang")) === "fr");
      const place = await js("(()=>{const i=document.querySelector('input');return i?i.placeholder:''})()");
      verifier("l'interface est traduite", /lieu|adresse/i.test(place ?? ""), place ?? "");
      capture("06-reglages");
    },
  },
  {
    id: "zones-tactiles",
    titre: "Les boutons se touchent au doigt",
    async executer() {
      await scene();
      await cliquer(".bookmarks-menu > button");
      if (!(await attendre(".bookmarks-panel"))) return verifier("le panneau des signets s'ouvre", false);
      const sonde = await js(`(()=>{
        const out=[];
        for (const el of document.querySelectorAll('.bookmarks-panel .bookmark-icon-button')) {
          const r=el.getBoundingClientRect(), cx=r.left+r.width/2, cy=r.top+r.height/2;
          const t=(dx,dy)=>{const h=document.elementFromPoint(cx+dx,cy+dy);return h===el||el.contains(h)};
          out.push({nom:el.getAttribute('aria-label')||'?',ok:t(-15,0)&&t(15,0)&&t(0,-21)&&t(0,21)});
        }
        return out})()`);
      verifier("des boutons ont été sondés", sonde.length > 0, `${sonde.length} bouton(s)`);
      for (const b of sonde) verifier(`zone atteignable : ${b.nom}`, b.ok);
      capture("07-zones-tactiles");
      await js("(()=>{const b=document.querySelector('.bookmarks-menu > button');if(b)b.click();return true})()");
    },
  },
  {
    id: "navigation",
    titre: "La navigation à pied démarre et guide",
    async executer() {
      await scene();
      await positionSimulee(48.86, 2.3376, 95, 1.4);
      await carteVers(2.3376, 48.86, 16);
      await saisir("Bastille");
      await attendre(".search-result");
      await cliquerPremierLieu();
      await attendre(".sheet");
      await cliquer(".sheet-action-primary");
      await attendre(".itinerary-panel");
      // Deuxième mode : la marche.
      await js("(()=>{const m=document.querySelectorAll('.itinerary-mode');if(m[1])m[1].click();return true})()");
      if (!(await attendre(".itinerary-result", 25_000))) return verifier("un itinéraire à pied est calculé", false);
      await cliquer(".nav-start");
      verifier("le bandeau de manœuvre apparaît", await attendre(".nav-banner, .nav-maneuver, [class*=nav-step]", 30_000));

      // La géométrie du bandeau, et pas seulement sa présence.
      //
      // La pastille de manœuvre doit épouser le bord gauche du bandeau et en
      // toucher le haut — c'est ce qui lui donne sa surface — **sans** que le
      // bandeau grandisse : le placement de la manœuvre à l'écran est réglé
      // contre une hauteur d'environ 148 px, et tout ce qui la dépasse fait
      // glisser la manœuvre sous le bandeau. Une hauteur minimale sur la
      // pastille avait failli le faire, à deux pixels près, et rien ne l'aurait
      // dit.
      // Le bandeau paraît **d'abord dans son état d'attente** (« calcul en
      // cours »), sans manœuvre ni pastille : le mesurer aussitôt ne trouve
      // rien, et la vérification ci-dessus l'accepte puisqu'elle se contente
      // de `.nav-banner`. On attend donc la pastille elle-même.
      verifier("la pastille de manœuvre paraît", await attendre(".nav-maneuver-icon", 30_000));

      const geometrie = await js(`(()=>{
        const b=document.querySelector('.nav-banner');
        const p=document.querySelector('.nav-maneuver-icon');
        if(!b||!p)return null;
        const rb=b.getBoundingClientRect(), rp=p.getBoundingClientRect();
        return {hauteur:Math.round(rb.height),
                ecartGauche:Math.round(rp.left-rb.left),
                ecartHaut:Math.round(rp.top-rb.top),
                largeur:Math.round(rp.width)}})()`);
      if (geometrie === null) {
        verifier("la pastille de manœuvre est mesurable", false);
      } else {
        verifier("la pastille épouse le bord gauche", Math.abs(geometrie.ecartGauche) <= 1, `${geometrie.ecartGauche} px`);
        verifier("elle touche le haut du bandeau", Math.abs(geometrie.ecartHaut) <= 1, `${geometrie.ecartHaut} px`);
        verifier("elle est large", geometrie.largeur >= 70, `${geometrie.largeur} px`);
        verifier("le bandeau n'a pas grandi", geometrie.hauteur <= 170, `${geometrie.hauteur} px, réglage prévu pour ~148`);
      }
      capture("08-navigation");
      await js("(()=>{const b=[...document.querySelectorAll('button')].find(x=>/Terminer|End/i.test(x.innerText||''));if(b)b.click();return true})()");
      await dodo(2000);
    },
  },
  {
    id: "sans-cles",
    titre: "Sans clé d'API, l'application dit ce qui lui manque",
    /**
     * À faire tourner sur `npm run apk:nokeys` — la configuration que
     * recevront les utilisateurs de F-Droid.
     *
     * Montrer que l'application **marche** sans clés ne suffit pas : ce qui
     * compte est qu'une fonction indisponible se **dise**, au lieu de
     * ressembler à une panne. Une option morte et muette est un défaut ; une
     * option morte qui explique ce qui lui manque est un choix.
     */
    async executer() {
      await scene();
      await cliquer(".map-options-button");
      if (!(await attendre(".map-options-panel"))) return verifier("le menu des calques s'ouvre", false);

      const photos = await js(`(()=>{const b=[...document.querySelectorAll('.map-options-panel button')]
        .find(x=>/Street photos|Photos de rue/i.test(x.innerText||''));
        return b?{desactive:!!b.disabled,titre:b.title||''}:null})()`);
      if (photos === null) {
        verifier("l'option des photos de rue est présente", false);
      } else {
        // Sans jeton Mapillary, l'option reste visible mais inerte, et son
        // infobulle dit ce qu'il lui faut.
        verifier("les photos de rue sont désactivées", photos.desactive, photos.titre);
        verifier(
          "l'infobulle renvoie là où saisir la clé",
          /Menu|API/i.test(photos.titre),
          photos.titre
        );
      }
      verifier(
        "une explication accompagne l'option",
        await js("!!document.querySelector('.map-options-note')"),
        (await texte(".map-options-note")) ?? ""
      );
      capture("09-sans-cles");
      adb("shell", "input", "keyevent", "4");
      await dodo(1500);
    },
  },

  // --- Deuxième vague : les surfaces que le premier parcours ne touchait pas.
  //
  // Le premier parcours suivait le chemin principal — chercher, tracer, partir.
  // Tout ce qui se règle, se télécharge ou s'affiche à côté restait hors de sa
  // vue, et c'est précisément là qu'un défaut vit longtemps : personne ne
  // regarde deux fois un écran de réglages.

  {
    id: "meteo",
    titre: "L'encart météo dit le temps qu'il fait",
    async executer() {
      await scene();
      await positionSimulee(48.8566, 2.3522);
      await carteVers(2.3522, 48.8566, 13);
      if (!verifier("l'encart météo est là", await attendre(".weather", 25_000))) return;
      const contenu = (await texte(".weather")) ?? "";
      verifier("une température est affichée", /-?\d+\s*°/.test(contenu), contenu.slice(0, 60));
      // Un encart resté sur « Taking readings… » ressemble à un encart qui
      // marche : c'est le cas qu'il faut distinguer.
      verifier("le relevé a abouti", !/readings|relev[ée]/i.test(contenu), contenu.slice(0, 40));
      await cliquer(".weather");
      if (await attendre(".weather-panel", 8000)) {
        const panneau = (await texte(".weather-panel")) ?? "";
        verifier("le panneau déplié donne l'air ou les pollens", /air|pollen/i.test(panneau), panneau.slice(0, 80));
        await cliquer(".weather");
        await dodo(600);
      }
      capture("10-meteo");
    },
  },

  {
    id: "transports",
    titre: "Un arrêt annonce ses prochains passages",
    /**
     * Le cœur de la promesse « les transports partout » : sans clé
     * Île-de-France, les horaires viennent de Transitous. Ce scénario compte
     * donc double sur l'APK sans clés.
     *
     * Il essaie plusieurs arrêts : le géocodeur ne rend pas toujours un arrêt
     * en premier, et échouer parce qu'on est tombé sur un café ne dirait rien
     * de l'application.
     */
    async executer() {
      await scene();
      await carteVers(2.3522, 48.8566, 15);
      let ouvert = null;
      for (const requete of ["Châtelet", "Gare de Lyon", "République"]) {
        await saisir(requete);
        if (!(await attendreQue(`document.querySelectorAll('${LIEU}').length > 0`, 12_000))) continue;
        const nom = await js(`(()=>{const e=document.querySelector('${LIEU}');
          if(!e)return null;const t=e.innerText.replace(/\\n+/g,' · ');e.click();return t})()`);
        if (!(await attendre(".sheet", 8000))) continue;
        if (await attendre(".departures", 20_000)) {
          ouvert = nom;
          break;
        }
        await js("(()=>{const b=document.querySelector('.sheet-close');if(b)b.click();return true})()");
        await dodo(900);
      }
      if (!verifier("un arrêt de transport a été ouvert", ouvert !== null, (ouvert ?? "").slice(0, 50))) return;

      // Le bloc s'affiche **avec son état de chargement** : l'interroger tout de
      // suite ne lit que « Looking up the next departures… », et le parcours
      // conclut à un arrêt sans ligne. C'est la quatrième fois que cet outil
      // accuse l'application d'un défaut qui n'est que sa propre hâte — on
      // attend donc que la recherche aboutisse, ou échoue, avant de conclure.
      const abouti = await attendreQue(
        `(()=>{const n=[...document.querySelectorAll('.departures-note')].map(e=>e.innerText||'').join(' ');
          return !/Looking up|Recherche des/i.test(n)})()`,
        40_000
      );
      if (!verifier("la recherche des horaires aboutit", abouti, (await texte(".departures")) ?? "")) return;

      const contenu = (await texte(".departures")) ?? "";
      const lignes = await js("document.querySelectorAll('.line-card').length");
      if (lignes > 0) {
        verifier("des lignes desservent l'arrêt", true, `${lignes} ligne(s)`);
        verifier(
          "la source des horaires est nommée",
          await js("!!document.querySelector('.departures-source')"),
          (await texte(".departures-source")) ?? ""
        );
        // `.departure-next` est la seule classe toujours présente : elle porte
        // le prochain passage sur la ligne repliée, ou « Service ended ».
        // `.departure-time` et `.departure-wait` n'existent qu'une fois le
        // groupe **déplié**. La version d'avant les cherchait quand même, et
        // ne passait que grâce à `.departures-note` — c'est-à-dire seulement
        // quand quelque chose n'allait pas. Tout fonctionnait, donc elle
        // échouait.
        verifier(
          "il y a un horaire, ou la raison de son absence",
          await js("!!document.querySelector('.departure-next, .departure-none, .departures-note')"),
          contenu.slice(0, 90)
        );
      } else {
        // Aucune ligne : légitime si l'application dit pourquoi — clé absente,
        // service terminé, fournisseur muet. Un blanc, lui, ne l'est jamais.
        verifier(
          "l'absence d'horaires est expliquée",
          await js("!!document.querySelector('.departures-note')"),
          contenu.slice(0, 90)
        );
      }
      capture("11-transports");
    },
  },

  {
    id: "telechargement",
    titre: "Le panneau des cartes hors ligne s'ouvre et se lit",
    async executer() {
      await scene();
      if (!verifier("le menu principal s'ouvre", await ouvrirMenu())) return;
      const entrees = await js("[...document.querySelectorAll('.app-menu-item')].map(e=>e.innerText.trim()).join(' · ')");
      verifier("le menu offre ses six entrées", (await js("document.querySelectorAll('.app-menu-item').length")) === 6, entrees);
      verifier("la version est affichée au bas du menu", await js("!!document.querySelector('.app-menu-version')"),
        (await texte(".app-menu-version")) ?? "");
      await entreeMenu("/Downloads|Téléchargement/i");
      // Le panneau arrive en différé (`lazy`) : lui laisser le temps d'arriver.
      if (!verifier("le panneau de téléchargement s'ouvre", await attendre(".download-dialog", 25_000))) return;
      verifier("l'emprise se choisit sur une carte", await attendre(".download-map", 12_000));
      // Le quota vient de `storageEstimate()`, donc en différé : il faut
      // l'attendre. Sans cela, la condition était évaluée avant que l'élément
      // n'existe et le détail juste après, une fois qu'il était là — un échec
      // dont le libellé affichait « 66 Mo used of 108,6 Go », c'est-à-dire la
      // preuve que tout allait bien.
      verifier("la place disponible est annoncée", await attendre(".download-quota", 12_000),
        (await texte(".download-quota")) ?? "");
      verifier("le niveau de détail se choisit", await js("!!document.querySelector('.download-tiers')"));
      verifier("le bouton de lancement est présent", await js("!!document.querySelector('.download-launch')"));
      capture("12-telechargement");
      await fermerModale();
    },
  },

  {
    id: "reprise",
    titre: "Un téléchargement coupé revient en pause, pas en marche",
    /**
     * Le correctif `interruptedRegions()` vu par l'écran. Une zone laissée à
     * « downloading » par une application tuée n'a plus personne pour la
     * télécharger : elle doit repasser en pause et offrir d'être reprise, au
     * lieu d'afficher une progression qui n'avance jamais.
     *
     * La zone est **posée dans la base** plutôt que téléchargée : prendre une
     * vraie région coûterait des gigaoctets et des dizaines de minutes pour
     * éprouver un état qui n'a rien à voir avec le réseau.
     *
     * L'ordre des gestes n'est pas indifférent. `useOfflineRegions` n'est monté
     * que par `DownloadPanel`, lui-même chargé en différé : la réconciliation
     * n'a pas lieu au démarrage de l'application mais **à la première ouverture
     * du panneau**. Vérifier la base avant de l'ouvrir accuserait à tort.
     */
    async executer() {
      await scene();
      const ID = "parcours-zone-fantome";
      const NOM = "Zone du parcours";
      const pose = await surLesZones(`async(db)=>{
        const region={id:${JSON.stringify(ID)},name:${JSON.stringify(NOM)},bbox:[2.30,48.85,2.36,48.87],
          detail:'map',vectorMaxZoom:12,satelliteMaxZoom:null,reliefMaxZoom:null,addresses:false,
          addressDepts:[],createdAt:Date.now(),updatedAt:Date.now(),tileVersion:'parcours',
          checkedAt:Date.now(),bytes:1024,tilesDone:5,tilesTotal:100,placesCount:0,addressCount:0,
          status:'downloading'};
        await new Promise((ok,ko)=>{const t=db.transaction(['regions'],'readwrite');
          t.objectStore('regions').put(region);t.oncomplete=ok;t.onerror=()=>ko(t.error)});
        return true}`);
      if (!verifier("une zone « en cours » est posée dans la base", pose)) return;

      // Le redémarrage : c'est lui qui fait de cette zone l'héritage d'une
      // session précédente, et qui garantit que le panneau n'a pas encore été
      // monté.
      await recharger();
      if (!verifier("le menu principal s'ouvre", await ouvrirMenu())) return;
      await entreeMenu("/Downloads|Téléchargement/i");
      if (!verifier("le panneau de téléchargement s'ouvre", await attendre(".download-dialog", 25_000))) return;
      await attendreQue("document.querySelectorAll('.download-item').length > 0", 15_000);

      const vue = await js(`(()=>{const el=[...document.querySelectorAll('.download-item')]
        .find(e=>/Zone du parcours/.test(e.innerText||''));
        if(!el)return null;
        return {reprise:!!el.querySelector('.download-resume'),
                enCours:!!el.querySelector('.download-item-progress'),
                texte:el.innerText.replace(/\\n+/g,' · ')}})()`);
      if (!verifier("la zone apparaît dans la liste", vue !== null)) return;
      verifier("elle propose d'être reprise", vue.reprise, vue.texte.slice(0, 60));
      verifier("elle ne se dit plus en train de télécharger", !vue.enCours, vue.texte.slice(0, 60));

      const etat = await surLesZones(`async(db)=>{
        const z=await new Promise((ok)=>{const t=db.transaction(['regions'],'readonly');
          const q=t.objectStore('regions').get(${JSON.stringify(ID)});q.onsuccess=()=>ok(q.result)});
        return z?z.status+'/'+(z.pausedBy||'-'):'disparue'}`);
      verifier("la base la note en pause, à la demande de l'utilisateur", etat === "paused/user", etat);
      capture("13-reprise");
      await fermerModale();

      // On ne laisse pas une zone inventée derrière soi.
      const efface = await surLesZones(`async(db)=>{
        await new Promise((ok)=>{const t=db.transaction(['regions'],'readwrite');
          t.objectStore('regions').delete(${JSON.stringify(ID)});t.oncomplete=ok});
        return true}`);
      verifier("la zone d'essai est retirée de la base", efface);
    },
  },

  {
    id: "cles-api",
    titre: "L'écran des clés dit l'état de chacune",
    async executer() {
      await scene();
      if (!verifier("le menu principal s'ouvre", await ouvrirMenu())) return;
      await entreeMenu("/\\bAPI\\b/");
      if (!verifier("l'écran des clés s'ouvre", await attendre(".apikeys", 15_000))) return;
      const rangs = await js("document.querySelectorAll('.apikey-row').length");
      verifier("des clés sont listées", rangs > 0, `${rangs} clé(s)`);
      const etats = await js("[...document.querySelectorAll('.apikey-pill')].map(e=>e.className.replace('apikey-pill ','')).join(', ')");
      verifier("chaque clé porte un état", (await js("document.querySelectorAll('.apikey-pill').length")) === rangs, etats);
      verifier("chaque champ est étiqueté", (await js("document.querySelectorAll('.apikey-label').length")) === rangs);
      // Une clé saisie ne doit pas s'étaler à l'écran par-dessus l'épaule.
      // `.apikey-input` est l'**enveloppe** : le champ est dedans, à côté du
      // bouton œil. Interroger le `type` de l'enveloppe rendait une chaîne vide,
      // et l'assertion passait au vert sans avoir rien vérifié — un faux
      // positif est pire qu'une vérification absente, il donne l'assurance.
      const types = await js("[...document.querySelectorAll('.apikey-input input')].map(e=>e.type).join(',')");
      verifier(
        "les clés sont masquées par défaut",
        types.length > 0 && types.split(",").every((t) => t === "password"),
        types
      );
      verifier("d'où vient chaque clé est dit", await js("!!document.querySelector('.apikey-origin')"),
        (await texte(".apikey-origin")) ?? "");
      capture("14-cles-api");
      await fermerModale();
    },
  },

  {
    id: "parametres",
    titre: "L'écran des paramètres offre thème, langue, maison et travail",
    async executer() {
      await scene();
      if (!verifier("le menu principal s'ouvre", await ouvrirMenu())) return;
      await entreeMenu("/Settings|Paramètres/i");
      if (!verifier("les paramètres s'ouvrent", await attendre(".settings-dialog", 15_000))) return;
      const segments = await js("document.querySelectorAll('.segmented').length");
      verifier("le thème et la langue se choisissent", segments >= 2, `${segments} groupe(s)`);
      verifier(
        "le thème offre automatique, clair et sombre",
        (await js("(()=>{const g=document.querySelectorAll('.segmented')[0];return g?g.querySelectorAll('button').length:0})()")) >= 3
      );
      const rangs = await js("document.querySelectorAll('.homework-row').length");
      verifier("maison et travail sont proposés", rangs === 2, `${rangs} raccourci(s)`);
      // Un raccourci vide doit le dire, pas rester muet.
      const texteHW = await js("[...document.querySelectorAll('.homework-row')].map(e=>e.innerText.replace(/\\n+/g,' ')).join(' | ')");
      verifier("chaque raccourci annonce son état", texteHW.length > 0, texteHW.slice(0, 90));
      capture("15-parametres");
      await fermerModale();
    },
  },

  {
    id: "signets",
    titre: "Un lieu mis en signet survit à un redémarrage",
    async executer() {
      await scene();
      const avant = await lire("osm-local:bookmarks");
      await carteVers(2.3478, 48.865, 16);
      await saisir("Bastille");
      await attendre(".search-result");
      if ((await cliquerPremierLieu()) === null) return;
      if (!verifier("la fiche s'ouvre", await attendre(".sheet"))) return;

      // Le bouton d'enregistrement se reconnaît à son libellé : les autres
      // actions secondaires sont des liens (téléphone, site) ou le partage.
      const mis = await js(`(()=>{const b=[...document.querySelectorAll('button.sheet-action-secondary')]
        .find(x=>/^(Save|Enregistrer)$/i.test((x.innerText||'').trim()));
        if(!b)return false;b.click();return true})()`);
      if (!verifier("la fiche propose d'enregistrer le lieu", mis)) return;

      // Selon qu'un dossier existe déjà, l'enregistrement passe ou non par une
      // boîte de dialogue. Les deux chemins mènent au même endroit.
      if (await attendre(".save-submit", 6000)) {
        await cliquer(".save-submit");
        await dodo(1200);
      }
      verifier(
        "le bouton bascule sur « enregistré »",
        await attendreQue("!!document.querySelector('.sheet-action-secondary.is-saved')", 8000)
      );

      const apres = await lire("osm-local:bookmarks");
      verifier("le signet est écrit dans les réglages", apres !== avant && (apres ?? "").length > (avant ?? "").length);

      await recharger();
      const survecu = await lire("osm-local:bookmarks");
      verifier("le signet survit au redémarrage", survecu === apres);
      if (await ouvrirMenu()) await js("(()=>{const b=document.querySelector('.app-menu-button');if(b)b.click();return true})()");
      await cliquer(".bookmarks-menu > button");
      if (await attendre(".bookmarks-panel", 8000)) {
        const liste = (await texte(".bookmarks-panel")) ?? "";
        verifier("il apparaît dans le panneau des signets", /\w/.test(liste) && !/^\s*$/.test(liste), liste.slice(0, 70));
        capture("16-signets");
        await js("(()=>{const b=document.querySelector('.bookmarks-menu > button');if(b)b.click();return true})()");
      }

      // Les signets appartiennent à l'utilisateur : on rend la liste d'avant.
      await reglages({ "osm-local:bookmarks": avant });
      await recharger();
      verifier("la liste d'origine est rendue", (await lire("osm-local:bookmarks")) === avant);
    },
  },

  {
    id: "filtres",
    titre: "Les catégories affichées se choisissent et se retiennent",
    async executer() {
      await scene();
      const avant = await lire("osm-local:filters");
      await cliquer(".filter-burger");
      if (!verifier("le menu des catégories s'ouvre", await attendre(".filter-panel", 10_000))) return;
      const nombre = await js("document.querySelectorAll('.filter-list button, .filter-list [role=switch]').length");
      verifier("des catégories sont proposées", nombre > 0, `${nombre} catégorie(s)`);

      // Tout afficher, puis vérifier que le choix a bien été enregistré.
      await cliquer(".filter-all");
      await dodo(1200);
      const apres = await lire("osm-local:filters");
      verifier("changer de catégories modifie les réglages", apres !== avant, `${(avant ?? "").slice(0, 30)} → ${(apres ?? "").slice(0, 30)}`);
      capture("17-filtres");

      await recharger();
      verifier("le choix survit au redémarrage", (await lire("osm-local:filters")) === apres);
      verifier("la carte est toujours dessinée", await js("!!document.querySelector('.map-container canvas')"));
    },
  },

  {
    id: "fond-de-carte",
    titre: "Le fond de carte change et se retient",
    async executer() {
      await scene();
      await cliquer(".map-options-button");
      if (!verifier("le menu des calques s'ouvre", await attendre(".map-options-panel", 10_000))) return;
      const choix = await js("[...document.querySelectorAll('.map-options-choice-label')].map(e=>e.innerText.trim()).join(' · ')");
      verifier("plusieurs fonds sont proposés", (await js("document.querySelectorAll('.map-options-choice-label').length")) >= 2, choix);

      const bascule = await js(`(()=>{const b=[...document.querySelectorAll('.map-options-choices button, .map-options-choices label')]
        .find(x=>/Satellite/i.test(x.innerText||''));if(!b)return false;b.click();return true})()`);
      if (!verifier("le fond satellite se choisit", bascule)) return;
      await dodo(2500);
      verifier("le réglage est enregistré", (await lire("osm-local:basemap")) === "satellite", (await lire("osm-local:basemap")) ?? "");
      verifier("la carte tient le changement", await js("!!document.querySelector('.map-container canvas')"));
      verifier("aucune panne de carte n'est signalée", !(await js("!!document.querySelector('.map-status.is-error')")));
      capture("18-fond-satellite");

      await recharger();
      verifier("le fond survit au redémarrage", (await lire("osm-local:basemap")) === "satellite");
      // `scene()` rendra le fond standard au scénario suivant ; on le fait
      // quand même ici pour ne pas dépendre de l'ordre d'exécution.
      await reglages({ "osm-local:basemap": "standard" });
    },
  },

  {
    id: "permissions",
    titre: "Position refusée, l'application continue de marcher",
    /**
     * Le cas qu'on n'essaie jamais soi-même, parce qu'on a toujours accordé la
     * permission. Refuser la position ne doit ni bloquer l'application ni la
     * faire tourner dans le vide : la carte reste, la recherche reste, et le
     * bouton de position ne promet pas ce qu'il ne peut pas tenir.
     *
     * Android tue le processus quand une permission change : il faut se
     * rattacher après coup, d'où les `connecter()`.
     */
    async executer() {
      await scene();
      adb("shell", "pm", "revoke", PAQUET, "android.permission.ACCESS_FINE_LOCATION");
      adb("shell", "pm", "revoke", PAQUET, "android.permission.ACCESS_COARSE_LOCATION");
      await dodo(2500);
      reveiller();
      await dodo(3000);
      try {
        await connecter(30_000);
      } catch (erreur) {
        verifier("l'application repart sans la permission", false, String(erreur.message ?? erreur));
        adb("shell", "pm", "grant", PAQUET, "android.permission.ACCESS_FINE_LOCATION");
        adb("shell", "pm", "grant", PAQUET, "android.permission.ACCESS_COARSE_LOCATION");
        return;
      }
      verifier("la carte est dessinée malgré le refus", await js("!!document.querySelector('.map-container canvas')"));
      verifier("la barre de recherche reste utilisable", await js("!!document.querySelector('input')"));

      await cliquer(".locate-button");
      const debut = Date.now();
      // Le bouton peut échouer — c'est légitime. Ce qui ne le serait pas, c'est
      // qu'il tourne indéfiniment en laissant croire qu'il cherche.
      //
      // On **mesure** au lieu de trancher après un délai choisi au hasard :
      // `useGeolocation` laisse dix secondes à l'API avant d'abandonner, et une
      // première version de ce scénario concluait au bout de six — elle
      // accusait l'application d'un blocage qui n'était que sa propre hâte.
      const rendu = await attendreQue("!document.querySelector('.locate-button.is-loading')", 25_000);
      const delai = ((Date.now() - debut) / 1000).toFixed(1);
      verifier("le bouton de position finit par rendre la main", rendu, `${delai} s`);
      // Rendre la main ne suffit pas : sans un mot, dix secondes d'attente puis
      // rien ressemblent trait pour trait à une panne. Le bandeau doit dire ce
      // qui s'est passé, et renvoyer là où cela se règle.
      const explique = await attendreQue(
        `(()=>{const b=document.querySelector('.map-status');
          return !!b && /denied|refus|unavailable|indisponible|seconds|secondes/i.test(b.innerText||'')})()`,
        8000
      );
      verifier("le refus est expliqué à l'écran", explique, (await texte(".map-status")) ?? "");
      verifier("l'application n'a pas planté", await js("!!document.querySelector('.map-container canvas')"));
      capture("19-permissions");

      adb("shell", "pm", "grant", PAQUET, "android.permission.ACCESS_FINE_LOCATION");
      adb("shell", "pm", "grant", PAQUET, "android.permission.ACCESS_COARSE_LOCATION");
      await dodo(2500);
      reveiller();
      await dodo(3000);
      await connecter(30_000);
      verifier("la permission est rendue et l'application repart", await js("!!document.querySelector('.map-container canvas')"));
    },
  },

  {
    id: "rotation",
    titre: "En paysage, rien ne déborde",
    async executer() {
      await scene();
      const portrait = await js("window.innerWidth + 'x' + window.innerHeight");
      adb("shell", "settings", "put", "system", "accelerometer_rotation", "0");
      adb("shell", "settings", "put", "system", "user_rotation", "1");
      await dodo(4000);
      await connecter(30_000);
      const paysage = await js("window.innerWidth + 'x' + window.innerHeight");
      verifier("l'écran a bien tourné", portrait !== paysage, `${portrait} → ${paysage}`);
      verifier("la carte est redessinée", await js("!!document.querySelector('.map-container canvas')"));
      verifier("la barre de recherche est toujours là", await js("!!document.querySelector('input')"));
      const deborde = await js("document.documentElement.scrollWidth > window.innerWidth + 1");
      verifier(
        "aucun débordement horizontal",
        !deborde,
        await js("'contenu ' + document.documentElement.scrollWidth + ' px, écran ' + window.innerWidth + ' px'")
      );
      capture("20-rotation");

      adb("shell", "settings", "put", "system", "user_rotation", "0");
      adb("shell", "settings", "put", "system", "accelerometer_rotation", "1");
      await dodo(4000);
      await connecter(30_000);
      verifier("le portrait est rendu", (await js("window.innerWidth + 'x' + window.innerHeight")) === portrait);
    },
  },

  {
    id: "veille",
    titre: "Mise en veille puis reprise : rien n'est perdu",
    async executer() {
      await scene({ theme: "dark" });
      await carteVers(2.3478, 48.865, 16);
      const avant = await js("(()=>{const c=window.__myosm?.map?.getCenter?.();return c?c.lng.toFixed(3)+','+c.lat.toFixed(3):null})()");

      // Un marqueur, pour savoir si la page a survécu au passage en
      // arrière-plan ou si le système l'a rechargée. Les deux sont légitimes —
      // Android reprend la mémoire quand il en manque — et le parcours le
      // **rapporte** au lieu d'en juger.
      await js("(()=>{window.__marqueurVeille=1;return true})()");

      adb("shell", "input", "keyevent", "3"); // retour à l'écran d'accueil
      await dodo(5000);
      reveiller();
      await dodo(3500);
      await connecter(30_000);

      const conservee = await js("!!window.__marqueurVeille");
      verifier("le retour se fait proprement", true, conservee ? "page conservée" : "page rechargée par le système");
      verifier("la carte est toujours dessinée au retour", await js("!!document.querySelector('.map-container canvas')"));
      verifier("le thème choisi est toujours là", (await js("document.documentElement.getAttribute('data-theme')")) === "dark");
      const apres = await js("(()=>{const c=window.__myosm?.map?.getCenter?.();return c?c.lng.toFixed(3)+','+c.lat.toFixed(3):null})()");
      // La carte a le droit d'avoir bougé : si la page a été rechargée, le
      // recentrage d'ouverture la repose sur la position — c'est précisément ce
      // qu'on a réparé. Cette vérification exigeait l'immobilité, et s'est donc
      // mise à échouer le jour où le correctif a commencé à marcher. Ce qui
      // compte n'est pas qu'elle n'ait pas bougé, mais qu'elle ne soit pas
      // revenue au centre par défaut, seule et sans position.
      const DEFAUT = "2.352,48.857"; // CONFIG.DEFAULT_CENTER, au millième
      if (avant === null) verifier("position de la carte non mesurable (APK sans diagnostic)", true);
      else
        verifier(
          "la carte est restée en place, ou s'est reposée sur la position",
          apres === avant || apres !== DEFAUT,
          `${avant} → ${apres}`
        );
      verifier("aucune panne de carte n'est signalée", !(await js("!!document.querySelector('.map-status.is-error')")));
      capture("21-veille");
    },
  },

  {
    id: "recentrage",
    titre: "À l'ouverture, la carte se pose sur la position",
    /**
     * Ce scénario existe parce que ce recentrage **ne marchait pas**, et que
     * rien ne le disait. Le garde qui le protège — ne pas faire surgir la boîte
     * d'autorisation au lancement — attendait de l'API des permissions un état
     * « granted » que la WebView d'Android ne rend jamais : mesurée sur
     * appareil, elle répond « prompt » permission accordée comme retirée. Le
     * recentrage était donc court-circuité à chaque ouverture, en silence.
     *
     * On le vérifie par **où la carte se pose**, jamais par le code : c'est la
     * seule façon de voir un défaut dont chaque morceau, pris à part, a l'air
     * juste.
     */
    async executer() {
      await scene();
      const DEFAUT = "2.3522,48.8566"; // CONFIG.DEFAULT_CENTER
      const CENTRE = "(()=>{const c=window.__myosm?.map?.getCenter?.();return c?c.lng.toFixed(4)+','+c.lat.toFixed(4):'carte absente'})()";
      const AILLEURS = `(()=>{const c=window.__myosm?.map?.getCenter?.();
        if(!c)return false;return (c.lng.toFixed(4)+','+c.lat.toFixed(4))!=='${DEFAUT}'})()`;

      // Pas de position simulée ici : c'est le vrai trajet — permission du
      // système, GPS, recentrage — que l'on veut voir fonctionner.
      await cliquer(".locate-button");
      if (!verifier("le bouton de position recentre la carte", await attendreQue(AILLEURS, 30_000), await js(CENTRE))) return;

      // Puis rouvrir l'application, sans rien toucher : elle doit s'y reposer
      // seule. C'est exactement ce qui manquait.
      await recharger();
      verifier("à la réouverture, la carte s'y repose seule", await attendreQue(AILLEURS, 25_000), await js(CENTRE));
      capture("22-recentrage");
    },
  },

  {
    id: "premier-lancement",
    titre: "La fenêtre d'accueil paraît une fois, et une seule",
    /**
     * Ce qu'il faut vraiment vérifier d'une fenêtre d'accueil n'est pas qu'elle
     * s'ouvre — c'est qu'elle **se taise ensuite**. Une fenêtre qui revient est
     * une fenêtre qu'on apprend à fermer sans lire, et elle aurait alors pour
     * seul effet de retarder l'application de deux secondes à chaque
     * lancement.
     */
    async executer() {
      await scene();
      // On se remet dans l'état d'une installation neuve. `scene()` vient de
      // marquer la fenêtre comme vue : il faut donc l'effacer après lui.
      await reglages({ "osm-local:first-run-seen": null });
      await recharger();

      if (!verifier("la fenêtre s'ouvre au premier lancement", await attendre(".first-run", 12_000))) return;
      const contenu = (await texte(".first-run")) ?? "";
      verifier("elle recommande la clé TomTom", /TomTom/i.test(contenu), contenu.slice(0, 70));
      verifier("elle mentionne le dépôt public", /GitHub/i.test(contenu));
      verifier(
        "elle dit que la clé est gratuite et sans carte bancaire",
        /free|gratuit/i.test(contenu) && /bank card|carte bancaire/i.test(contenu)
      );
      const lien = await js(`(()=>{const a=document.querySelector('.first-run a.first-run-action');
        return a?a.getAttribute('href'):null})()`);
      verifier("le lien pointe sur le dépôt", lien === "https://github.com/Gris-S/my-osm", lien ?? "aucun");
      capture("23-premier-lancement");

      // Le bouton principal doit **mener** à l'écran des clés, pas seulement en
      // parler : c'est toute la différence entre un conseil et un chemin.
      await cliquer(".first-run-action.is-primary");
      verifier("« Ajouter la clé » ouvre l'écran des clés", await attendre(".apikeys", 12_000));
      verifier("la fenêtre d'accueil s'est effacée", !(await js("!!document.querySelector('.first-run')")));
      capture("24-premier-lancement-cles");
      await fermerModale();

      // Et surtout : elle ne revient pas.
      await recharger();
      verifier(
        "elle ne reparaît pas au lancement suivant",
        !(await attendre(".first-run", 6000)),
        (await lire("osm-local:first-run-seen")) ?? "aucune trace enregistrée"
      );
    },
  },

  {
    id: "musique",
    titre: "La pochette ouvre le lecteur",
    /**
     * Ce scénario **demande qu'une musique soit en cours** sur le téléphone :
     * l'encart n'existe pas autrement, et c'est voulu. Sans lecteur, il ne
     * conclut rien plutôt que d'accuser à tort — mais il le dit, pour qu'on
     * sache que cette vérification n'a pas eu lieu.
     *
     * Il quitte l'application pour de bon : c'est justement ce qu'on vérifie.
     * D'où la remise au premier plan à la fin, sans quoi les scénarios suivants
     * s'attacheraient à la WebView d'un lecteur.
     */
    async executer() {
      await scene();
      await positionSimulee(48.86, 2.3376, 95, 1.4);
      await carteVers(2.3376, 48.86, 16);
      await saisir("Bastille");
      await attendre(".search-result");
      if ((await cliquerPremierLieu()) === null) return;
      await attendre(".sheet");
      await cliquer(".sheet-action-primary");
      await attendre(".itinerary-panel");
      await js("(()=>{const m=document.querySelectorAll('.itinerary-mode');if(m[1])m[1].click();return true})()");
      if (!(await attendre(".itinerary-result", 25_000))) return verifier("un itinéraire à pied est calculé", false);
      await cliquer(".nav-start");

      if (!(await attendre(".music-card", 20_000))) {
        return verifier("pas de musique en cours : rien à vérifier ici", true, "lancer un lecteur pour éprouver ce scénario");
      }

      const pochette = await js(`(()=>{const b=document.querySelector('.music-art');
        if(!b)return null;
        return {balise:b.tagName,libelle:b.getAttribute('aria-label')||'',titre:b.getAttribute('title')||''}})()`);
      if (!verifier("la pochette est présente", pochette !== null)) return;
      verifier("c'est un bouton, pas une image inerte", pochette.balise === "BUTTON", pochette.balise);
      verifier(
        "elle s'annonce comme ouvrant le lecteur",
        /Open the player|Ouvrir le lecteur/i.test(pochette.libelle),
        pochette.libelle
      );
      capture("24-musique");

      const auPremierPlan = () => {
        const sortie = adb("shell", "dumpsys", "activity", "activities");
        const ligne = /topResumedActivity[^\n]*\{[^}]*\s(\S+)\/(\S+)\}/.exec(sortie);
        return ligne ? ligne[1] : "?";
      };
      const avant = auPremierPlan();
      await cliquer(".music-art");
      await dodo(4000);
      const apres = auPremierPlan();
      verifier(
        "toucher la pochette ouvre une autre application",
        apres !== avant && apres !== PAQUET,
        `${avant} → ${apres}`
      );

      // On revient, sinon tout ce qui suit se croirait dans MY OSM.
      reveiller();
      await dodo(3000);
      await connecter(30_000);
    },
  },
];

// --- L'exécution ------------------------------------------------------------

async function main() {
  mkdirSync(SORTIE, { recursive: true });
  if (DEMANDES.includes("--liste")) {
    for (const s of SCENARIOS) console.log(`${s.id.padEnd(16)} ${s.titre}`);
    return;
  }
  const choisis = DEMANDES.length ? SCENARIOS.filter((s) => DEMANDES.includes(s.id)) : SCENARIOS;
  if (!choisis.length) throw new Error(`Aucun scénario ne correspond à : ${DEMANDES.join(", ")}`);

  await connecter();
  const sansCles = !(await js("!!window.__myosm"));
  if (sansCles) console.log("⚠  window.__myosm absent : APK non débogable, le pilotage sera partiel.\n");

  for (const s of choisis) {
    scenarioCourant = s.id;
    console.log(`\n▸ ${s.titre}  [${s.id}]`);
    try {
      // On repart d'une connexion vivante. Le scénario précédent a pu faire
      // redémarrer l'application : hériter de sa connexion morte ferait échouer
      // celui-ci dès son premier geste, pour une raison qui ne le regarde pas.
      await connecter();
      await s.executer();
    } catch (erreur) {
      verifier("le scénario s'est déroulé sans erreur", false, String(erreur.message ?? erreur));
    }
  }

  // On ne laisse jamais l'appareil dans l'état d'un essai.
  console.log("\n▸ Remise en état");
  try {
    adb("shell", "cmd", "connectivity", "airplane-mode", "disable");
    // Un scénario a pu ouvrir le navigateur intégré : il tient sa propre
    // WebView, qui survivrait au parcours et gênerait le suivant. Le geste
    // retour le referme, et ne fait rien sur la carte.
    adb("shell", "input", "keyevent", "4");
    await connecter();
    await reglages({
      "osm-local:theme": null,
      "osm-local:lang": null,
      "osm-local:basemap": "standard",
      "osm-local:filters": '["transport"]',
    });
    js("location.reload()").catch(() => {});
    console.log("   ✓ réglages rendus, position simulée effacée par le rechargement");
  } catch {
    console.log("   ✗ remise en état incomplète — vérifier l'appareil");
  }

  const echecs = resultats.filter((r) => !r.ok);
  const rapport = {
    quand: new Date().toISOString(),
    paquet: PAQUET,
    verifications: resultats.length,
    echecs: echecs.length,
    resultats,
  };
  writeFileSync(join(SORTIE, "rapport.json"), JSON.stringify(rapport, null, 2));

  console.log(`\n${"─".repeat(60)}`);
  console.log(`${resultats.length - echecs.length}/${resultats.length} vérifications passées`);
  if (echecs.length) {
    console.log("\nÉchecs :");
    for (const e of echecs) console.log(`  ✗ [${e.scenario}] ${e.libelle}${e.detail ? ` — ${e.detail}` : ""}`);
  }
  console.log(`\nCaptures et rapport : ${SORTIE}`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((erreur) => {
  console.error(`\nParcours interrompu : ${erreur.message ?? erreur}`);
  process.exit(2);
});
