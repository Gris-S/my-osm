import { useSyncExternalStore } from "react";

// ---------------------------------------------------------------------------
// Le panneau du bas de la navigation en transports, **réduit ou non** (demande
// explicite du 3 novembre 2026 : voir la carte en plus grand, et que les menus
// de droite ne se cognent plus dessus).
//
// Un magasin de module, comme le cadrage ou la musique : le panneau le lit,
// et `App` le réduit quand un menu de droite s'ouvre (`collapseTransitPanel`)
// — deux endroits éloignés de l'arbre, sans contexte. Le panneau **reste
// réduit** quand le menu se referme (demande explicite) ; il se rouvre à la
// poignée, et chaque nouvelle navigation repart ouverte.
// ---------------------------------------------------------------------------

let collapsed = false;
const listeners = new Set<() => void>();

function set(value: boolean): void {
  if (collapsed === value) return;
  collapsed = value;
  for (const listener of listeners) listener();
}

export function collapseTransitPanel(): void {
  set(true);
}

export function setTransitPanelCollapsed(value: boolean): void {
  set(value);
}

export function useTransitPanelCollapsed(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => collapsed
  );
}
