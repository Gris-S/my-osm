import { useState } from "react";

/**
 * Un numéro qui change chaque fois que `active` repasse à vrai.
 *
 * Ce qu'un suivi produit — position, silence d'un capteur — est rangé avec son
 * numéro, et ce qui porte un ancien numéro n'est plus rendu : la position d'un
 * trajet précédent ne réapparaît pas à l'ouverture du suivant, sans effet qui
 * remette l'état à zéro. Mis à jour pendant le rendu, en comparant à la valeur
 * déjà vue (patron « valeur du rendu précédent » de React).
 */
export function useActivation(active: boolean): number {
  const [seen, setSeen] = useState({ active, session: active ? 1 : 0 });
  if (seen.active !== active) {
    const next = { active, session: active ? seen.session + 1 : seen.session };
    setSeen(next);
    return next.session;
  }
  return seen.session;
}
