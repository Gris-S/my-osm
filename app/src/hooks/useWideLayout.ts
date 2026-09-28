import { useSyncExternalStore } from "react";

// ---------------------------------------------------------------------------
// La mise en page « grand écran » : une colonne à gauche porte la recherche,
// la fiche du lieu et l'itinéraire, et la carte occupe le reste — comme les
// cartes sur ordinateur (demande explicite, 28 septembre 2026, pour la version
// Docker).
//
// **Jamais dans l'APK** : sur une tablette tenue en paysage, la largeur y
// suffirait, mais l'application du téléphone doit rester celle qu'on connaît.
//
// Une seule source : ce hook pose la classe `is-wide` sur `<html>`, et la
// feuille de style (`styles/ui/wide.css`) ne lit que cette classe. La même
// règle ne s'écrit donc pas deux fois, une fois en CSS et une fois en JS.
// ---------------------------------------------------------------------------

/** Assez large pour une colonne de 400 px et une carte qui reste une carte. */
const QUERY = "(min-width: 1024px) and (min-height: 560px)";

const media = __TARGET__ !== "apk" && typeof window !== "undefined" ? window.matchMedia(QUERY) : null;

function apply(wide: boolean) {
  document.documentElement.classList.toggle("is-wide", wide);
}
if (media) apply(media.matches);

function subscribe(onChange: () => void): () => void {
  if (!media) return () => {};
  const handler = () => {
    apply(media.matches);
    onChange();
  };
  media.addEventListener("change", handler);
  return () => media.removeEventListener("change", handler);
}

/** Vrai en mise en page grand écran (jamais dans l'APK). */
export function useWideLayout(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => media?.matches ?? false,
    () => false
  );
}

/** Largeur de la colonne de gauche, marges comprises : la carte se décale d'autant. */
export const WIDE_COLUMN_PX = 432;
