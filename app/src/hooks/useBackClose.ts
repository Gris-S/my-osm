import { useEffect } from "react";
import { useLatest } from "./useLatest";

// ---------------------------------------------------------------------------
// Le geste « retour » d'Android.
//
// Il ferme **ce qui a été ouvert en dernier** — une confirmation avant la
// fenêtre qui la porte, un trajet déplié avant l'historique — et, quand rien
// n'est ouvert, **il ne fait rien** (demande explicite) : ni quitter
// l'application, ni la mettre en arrière-plan, y compris pendant une
// navigation, où un glissement involontaire au volant ne doit rien arrêter.
//
// Chaque élément qui se ferme s'inscrit ici tant qu'il est ouvert, avec la
// **même fonction que son bouton de fermeture** : le geste ne fait jamais plus
// que le bouton. L'écoute du geste est posée une fois (`installBackGesture`,
// `services/native.ts`) ; dans un navigateur, il n'y a rien à écouter.
// ---------------------------------------------------------------------------

interface Entry {
  close: () => void;
}

/** Ce qui est ouvert, du plus ancien au plus récent. */
const stack: Entry[] = [];

/**
 * Inscrit un élément tant que `open` est vrai. `close` est relu au moment du
 * geste. Dans un même composant, les appels s'empilent dans leur ordre : la
 * fenêtre d'abord, sa confirmation ensuite.
 */
export function useBackClose(open: boolean, close: () => void): void {
  const closeRef = useLatest(close);
  useEffect(() => {
    if (!open) return;
    const entry: Entry = { close: () => closeRef.current() };
    stack.push(entry);
    return () => {
      const index = stack.lastIndexOf(entry);
      if (index !== -1) stack.splice(index, 1);
    };
  }, [open, closeRef]);
}

/** Le geste retour : ferme le dernier élément ouvert. Rend faux s'il n'y avait rien. */
export function goBack(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top.close();
  return true;
}
