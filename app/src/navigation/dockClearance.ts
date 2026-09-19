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

// ---------------------------------------------------------------------------
// Jusqu'où descend le bandeau du haut.
//
// Le burger et la colonne météo/boussole descendent sous le bandeau pendant un
// guidage. Leur décalage était constant (132 px), taillé pour le bandeau à
// pied ; celui des transports est plus haut — nom de station sur deux lignes,
// direction, puis la ligne « une étape d'avance » — et le burger et la météo
// venaient s'y poser dessus (captures du 18 septembre 2026). Le bandeau publie
// donc son bas dans `--nav-banner-bottom`, et la feuille de style prend le plus
// grand des deux : le décalage d'origine reste un plancher, les boutons ne
// sautent pas pour une ligne de moins.
// ---------------------------------------------------------------------------

function setBannerBottom(px: number) {
  document.documentElement.style.setProperty("--nav-banner-bottom", `${Math.max(0, Math.round(px))}px`);
}

/** À poser sur le `.nav-banner` d'un panneau de navigation (`ref={bannerRef}`). */
export function useNavBannerRef() {
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      cleanupRef.current?.();
      setBannerBottom(0);
    },
    []
  );

  return useCallback((banner: HTMLDivElement | null) => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    if (!banner) {
      setBannerBottom(0);
      return;
    }
    const update = () => setBannerBottom(banner.getBoundingClientRect().bottom);
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(banner);
    window.addEventListener("resize", update);
    cleanupRef.current = () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);
}
