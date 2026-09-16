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

async function connecter() {
  const cibles = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const page = cibles.find((c) => c.type === "page");
  if (!page) throw new Error("Aucune page MY OSM : l'application est-elle ouverte ?");
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

async function recharger(attente = 13_000) {
  js("location.reload()").catch(() => {});
  await dodo(attente);
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
      await js("(()=>{const e=[...document.querySelectorAll('.search-result')].filter(x=>!x.className.includes('is-brand'));if(e[0])e[0].click();return true})()");
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
      await js("(()=>{const e=[...document.querySelectorAll('.search-result')].filter(x=>!x.className.includes('is-brand'));if(e[0])e[0].click();return true})()");
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
      await js("(()=>{const e=[...document.querySelectorAll('.search-result')].filter(x=>!x.className.includes('is-brand'));if(e[0])e[0].click();return true})()");
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
      await js("(()=>{const e=[...document.querySelectorAll('.search-result')].filter(x=>!x.className.includes('is-brand'));if(e[0])e[0].click();return true})()");
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
