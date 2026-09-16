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
