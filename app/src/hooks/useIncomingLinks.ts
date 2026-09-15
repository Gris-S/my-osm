import { useEffect } from "react";
import type { Place } from "../types";
import { resolveIncoming } from "../services/incoming";
import { launchUrl, listenAppUrls } from "../services/native";
import { useLatest } from "./useLatest";

interface IncomingHandlers {
  /** Montrer le lieu : sa fiche s'ouvre et la carte s'y rend. */
  onPlace: (place: Place) => void;
  /** Le lien demandait un itinéraire (« Itinéraire », `google.navigation:`). */
  onRoute: (place: Place) => void;
  /** Un texte partagé qu'on ne sait pas placer : il part en recherche sur le web. */
  onUnresolved: (text: string) => void;
}

/**
 * L'adresse de lancement ne se traite qu'une fois : `getLaunchUrl` la rend à
 * chaque appel, et `StrictMode` rejoue l'effet.
 */
let launchHandled = false;

/**
 * Au lancement, la même adresse arrive deux fois : par `getLaunchUrl`, et par
 * `appUrlOpen`, que Capacitor émet aussi pour l'intention de départ
 * (`BridgeActivity` la repasse à `onNewIntent`). La seconde est ignorée.
 */
let lastUrl = "";
let lastAt = 0;

/**
 * Les liens qu'une autre application envoie à MY OSM (voir
 * `services/incoming.ts`) : au lancement, et pendant que l'application tourne.
 * Hors APK, rien à écouter.
 */
export function useIncomingLinks(handlers: IncomingHandlers) {
  const latest = useLatest(handlers);
  useEffect(() => {
    // Les rappels passent par `latest` : l'action arrive après un géocodage,
    // et doit toucher l'application telle qu'elle est alors.
    const handle = (url: string) => {
      const now = Date.now();
      if (url === lastUrl && now - lastAt < 5000) return;
      lastUrl = url;
      lastAt = now;
      void resolveIncoming(url).then((action) => {
        if (!action) return;
        if (action.kind === "search") latest.current.onUnresolved(action.text);
        else if (action.kind === "route") latest.current.onRoute(action.place);
        else latest.current.onPlace(action.place);
      });
    };
    if (!launchHandled) {
      launchHandled = true;
      void launchUrl().then((url) => url && handle(url));
    }
    return listenAppUrls(handle);
  }, [latest]);
}
