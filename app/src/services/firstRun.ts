// ---------------------------------------------------------------------------
// La trace du premier lancement.
//
// Séparée de `FirstRunNotice` à dessein : un fichier qui exporte un composant
// **et** des fonctions casse le rafraîchissement à chaud de Vite, qui ne sait
// alors plus ce qu'il peut remplacer sans relancer la page. La règle vaut pour
// tout le projet — une constante ou une fonction partagée sort du fichier du
// composant.
// ---------------------------------------------------------------------------

const STORAGE_KEY = "osm-local:first-run-seen";

/**
 * A-t-on déjà montré la fenêtre d'accueil ?
 *
 * En cas de stockage indisponible, on répond **oui**. C'est délibéré : sans
 * mémoire, la fenêtre reviendrait à chaque ouverture, et une fenêtre qu'on ne
 * peut pas faire taire est pire que pas de fenêtre du tout.
 */
export function firstRunSeen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "on";
  } catch {
    return true;
  }
}

/** Retient que la fenêtre a été vue, par quelque sortie que ce soit. */
export function rememberFirstRunSeen(): void {
  try {
    localStorage.setItem(STORAGE_KEY, "on");
  } catch {
    /* ignore : au pire elle ne se rouvrira pas, `firstRunSeen` répondant oui */
  }
}
