import { useEffect, useSyncExternalStore } from "react";
import { checkFreshness, isCheckDue, listRegions, type Freshness } from "../services/offline";

// ---------------------------------------------------------------------------
// La vérification de fraîcheur des zones hors ligne, hors de la fenêtre.
//
// **Chaque semaine, toute seule, sans réglage** (demande explicite). Elle vit
// au niveau de l'application et non de la fenêtre « Téléchargement » : sinon
// elle n'aurait lieu que fenêtre ouverte. Trois déclencheurs, qui ne font
// qu'une chose — vérifier **si la semaine est écoulée** :
//
// - le lancement de l'application ;
// - le retour du réseau : une vérification tombée hors ligne n'a rien daté
//   (`checkFreshness` ne marque les zones qu'en cas de réponse), elle est donc
//   toujours due et repart dès que la connexion revient ;
// - une horloge d'une heure, pour une application laissée ouverte des jours.
//
// Rien ne tourne application fermée : il faudrait un service Android, écarté.
//
// Le résultat est un magasin de module : la fenêtre le lit à l'ouverture, et
// son bouton manuel y publie le sien.
// ---------------------------------------------------------------------------

const HOUR_MS = 60 * 60 * 1000;

let current: Freshness | null = null;
let inFlight: Promise<Freshness> | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const read = () => current;

/** Le dernier résultat, automatique ou manuel ; `null` avant la première réponse. */
export function useFreshness(): Freshness | null {
  return useSyncExternalStore(subscribe, read, read);
}

/** Vérifie maintenant. Un appel déjà en cours est partagé, pas doublé. */
export function runFreshnessCheck(): Promise<Freshness> {
  if (!inFlight) {
    inFlight = checkFreshness()
      .then((result) => {
        current = result;
        for (const listener of listeners) listener();
        return result;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

async function checkIfDue() {
  if (!navigator.onLine || inFlight) return;
  try {
    if (!isCheckDue(await listRegions())) return;
    await runFreshnessCheck();
  } catch {
    /* base indisponible (mode privé) : pas de zones, rien à vérifier */
  }
}

/** À monter une fois, dans `App`. */
export function useFreshnessWatch() {
  useEffect(() => {
    void checkIfDue();
    const retry = () => void checkIfDue();
    window.addEventListener("online", retry);
    const timer = window.setInterval(retry, HOUR_MS);
    return () => {
      window.removeEventListener("online", retry);
      window.clearInterval(timer);
    };
  }, []);
}
