import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

// ---------------------------------------------------------------------------
// Jusqu'où monte la colonne du bas pendant une navigation.
//
// Pendant la navigation à pied, les boutons du bord droit de l'application
// (position, signets, catégories) se rangent au-dessus de la barre du bas. Leur
// décalage était un nombre écrit à la main (96 px), pensé pour la barre seule et
// un bas d'écran sans barre de gestes : sur Pixel 8, le bouton de position
// empiétait déjà de 12 px sur la barre, et l'encart de musique l'a recouvert.
//
// La colonne (`.nav-dock`) publie donc ici la hauteur réellement occupée depuis
// le bas de l'écran — jusqu'au haut de l'encart de musique s'il est là, sinon de
// la barre — et `App` la lit (`useNavDockClearance`). Le bouton « Recentrer »,
// centré, n'est pas compté : il ne croise pas la colonne de droite. Zéro hors
// navigation.
// ---------------------------------------------------------------------------

let clearance = 0;
const listeners = new Set<() => void>();

function setClearance(next: number) {
  const rounded = Math.max(0, Math.round(next));
  if (rounded === clearance) return;
  clearance = rounded;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Hauteur occupée par la colonne du bas, en pixels depuis le bas de l'écran ; 0 hors navigation. */
export function useNavDockClearance(): number {
  return useSyncExternalStore(subscribe, () => clearance, () => 0);
}

/** Le plus haut des blocs empilés qui comptent : l'encart de musique, sinon la barre. */
function measure(dock: HTMLElement) {
  const top = dock.querySelector(".music-card") ?? dock.querySelector(".nav-bar");
  setClearance(top ? window.innerHeight - top.getBoundingClientRect().top : 0);
}

/**
 * À poser sur la `.nav-dock` d'un panneau de navigation (`ref={dockRef}`).
 * La colonne change de taille quand l'encart apparaît, disparaît ou quand le
 * détail se déplie : un `ResizeObserver` suffit à tout suivre.
 */
export function useNavDockRef() {
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      cleanupRef.current?.();
      setClearance(0);
    },
    []
  );

  return useCallback((dock: HTMLDivElement | null) => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    if (!dock) {
      setClearance(0);
      return;
    }
    const update = () => measure(dock);
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(dock);
    window.addEventListener("resize", update);
    cleanupRef.current = () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);
}
