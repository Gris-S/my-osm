import { useLayoutEffect, useRef, type RefObject } from "react";

/**
 * La dernière valeur rendue, pour les rappels, horloges et abonnements
 * installés une fois : ils la relisent au moment où ils s'exécutent.
 *
 * Écrite **après** le rendu (`useLayoutEffect`) et non pendant : un rendu que
 * React abandonne ou rejoue ne doit rien laisser derrière lui. Les effets du
 * même rendu la voient déjà à jour — ils passent après ceux de mise en page.
 */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
