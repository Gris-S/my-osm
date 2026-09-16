import { useEffect, useState } from "react";
import { watchConnection } from "../services/offline/network";
import { subscribeEmptyTiles } from "../services/offline/nativeTiles";

// ---------------------------------------------------------------------------
// Ce que l'interface doit dire de l'état hors ligne.
//
// Deux choses, et il faut les deux : **la connexion manque**, et — le cas qui
// compte vraiment — **la carte a dû laisser des cases vides**, c'est-à-dire
// qu'on est sorti des zones téléchargées. Sans le second, une carte grise ne
// disait pas si elle était en panne, si le style n'était pas arrivé, ou si
// l'endroit n'avait simplement jamais été téléchargé. Le compte existait déjà
// (`offlineTileStats.empty`) mais n'était lisible que par le câble, donc absent
// de la version à partager — c'est-à-dire absent là où il sert.
//
// **Aucun `setState` au début d'un effet** (règle du projet) : les deux états
// ne changent que sur un événement — un changement de connexion, une tuile
// laissée vide, l'expiration du délai — et le manque de zone est **déduit** au
// rendu en le croisant avec l'état de la connexion. C'est aussi ce qui le fait
// disparaître dès que le réseau revient, sans rien avoir à remettre à zéro.
//
// L'abonnement aux cases vides ne dépend pas de la connexion, et c'est
// volontaire : il ne se défait donc jamais, et son délai continue de courir
// pendant un passage en ligne — au retour hors ligne, on ne réaffiche pas un
// manque constaté un quart d'heure plus tôt. Une case vide ne se produit de
// toute façon que hors ligne (voir `nativeTiles.ts`).
// ---------------------------------------------------------------------------

/** Combien de temps le manque continue d'être annoncé après la dernière case vide. */
const GAP_NOTICE_MS = 10_000;

export interface OfflineState {
  offline: boolean;
  /** Hors ligne **et** hors des zones téléchargées : la carte laisse des blancs. */
  missingZone: boolean;
}

export function useOfflineState(): OfflineState {
  const [offline, setOffline] = useState(() => typeof navigator !== "undefined" && !navigator.onLine);
  const [recentGap, setRecentGap] = useState(false);

  useEffect(() => watchConnection(() => setOffline(!navigator.onLine)), []);

  useEffect(() => {
    let timer: number | null = null;
    const stop = subscribeEmptyTiles(() => {
      setRecentGap(true);
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => setRecentGap(false), GAP_NOTICE_MS);
    });
    return () => {
      stop();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  return { offline, missingZone: offline && recentGap };
}
