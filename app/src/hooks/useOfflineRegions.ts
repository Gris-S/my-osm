import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OfflinePrefs } from "./useOfflinePrefs";
import { runFreshnessCheck, useFreshness } from "./useFreshness";
import { isMetered, watchConnection } from "../services/offline/network";
import { putRegion } from "../services/offline/store";
import {
  downloadRegion,
  listRegions,
  refreshRegion,
  newRegion,
  removeRegion,
  storageEstimate,
  storeName,
  type Freshness,
  type OfflineRegion,
  type Progress,
} from "../services/offline";

// ---------------------------------------------------------------------------
// L'état des zones hors ligne.
//
// Même patron que `useBookmarks` : lecture tolérante aux pannes, et l'état
// vrai vit dans le stockage plutôt que dans React — un téléchargement survit à
// la fermeture de la fenêtre du menu, et doit donc être relu, pas reconstruit.
// ---------------------------------------------------------------------------

interface Options {
  /** Zone dont le téléchargement démarre, une fois créée. */
  onStarted?: (region: OfflineRegion) => void;
  prefs?: OfflinePrefs;
}

/**
 * Vrai si les conditions réseau permettent de télécharger, au vu des réglages.
 *
 * `isMetered()` ne rend vrai que sur une certitude : un navigateur qui ne sait
 * pas répondre laisse passer. Voir `services/offline/network.ts`.
 */
function canDownload(prefs: OfflinePrefs | undefined): boolean {
  if (!navigator.onLine) return !prefs?.pauseOffline;
  if (prefs?.wifiOnly && isMetered()) return false;
  return true;
}

export function useOfflineRegions({ onStarted, prefs }: Options = {}) {
  const [regions, setRegions] = useState<OfflineRegion[]>([]);
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  // Le résultat de la vérification, qu'elle vienne du fond (`useFreshnessWatch`)
  // ou du bouton.
  const freshnessResult = useFreshness();
  const [checking, setChecking] = useState(false);
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);
  const [store, setStore] = useState<"opfs" | "cache" | "device" | null>(null);
  const running = useRef(new Map<string, () => void>());

  /** Ce que le stockage dit des zones, lu d'un bloc. */
  const readStored = useCallback(async () => {
    try {
      return { regions: await listRegions(), storage: await storageEstimate(), store: await storeName() };
    } catch {
      // IndexedDB indisponible (navigation privée sur certains navigateurs) :
      // l'application marche, simplement sans zones.
      return { regions: [] as OfflineRegion[], storage: null, store: null };
    }
  }, []);

  const apply = useCallback((stored: Awaited<ReturnType<typeof readStored>>) => {
    setRegions(stored.regions);
    setStorage(stored.storage);
    setStore(stored.store);
  }, []);

  const reload = useCallback(async () => apply(await readStored()), [apply, readStored]);

  // La première lecture, puis à chaque réponse d'une vérification de fond,
  // fenêtre ouverte : les dates de vérification des zones viennent de changer.
  useEffect(() => {
    let cancelled = false;
    void readStored().then((stored) => {
      if (!cancelled) apply(stored);
    });
    return () => {
      cancelled = true;
    };
  }, [readStored, apply, freshnessResult]);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const result = await runFreshnessCheck();
      await reload();
      return result;
    } finally {
      setChecking(false);
    }
  }, [reload]);

  const start = useCallback(
    (params: Parameters<typeof newRegion>[0]) => {
      const region = newRegion(params);
      setRegions((prev) => [region, ...prev]);
      onStarted?.(region);

      const handle = downloadRegion(region, (p) =>
        setProgress((prev) => ({ ...prev, [region.id]: p })),
      );
      running.current.set(region.id, handle.cancel);
      void handle.promise
        .catch(() => {
          /* l'échec est déjà écrit dans la zone */
        })
        .finally(() => {
          running.current.delete(region.id);
          setProgress((prev) => {
            const next = { ...prev };
            delete next[region.id];
            return next;
          });
          void reload();
        });
      return region;
    },
    [onStarted, reload],
  );

  /** Reprend une zone interrompue : le même travail, les tuiles déjà là en moins. */
  const resume = useCallback(
    (region: OfflineRegion) => {
      const handle = downloadRegion(region, (p) =>
        setProgress((prev) => ({ ...prev, [region.id]: p })),
      );
      running.current.set(region.id, handle.cancel);
      void handle.promise.catch(() => {}).finally(() => {
        running.current.delete(region.id);
        void reload();
      });
    },
    [reload],
  );

  /** Mise à jour d'une zone périmée : mêmes réglages, tuiles reprises. */
  const update = useCallback(
    (region: OfflineRegion) => {
      const handle = refreshRegion(region, (p) =>
        setProgress((prev) => ({ ...prev, [region.id]: p })),
      );
      running.current.set(region.id, handle.cancel);
      void handle.promise.catch(() => {}).finally(() => {
        running.current.delete(region.id);
        setProgress((prev) => {
          const next = { ...prev };
          delete next[region.id];
          return next;
        });
        void reload();
      });
    },
    [reload],
  );

  /**
   * Ce que la vérification a trouvé périmé, **moins ce qui a été remis à jour
   * depuis** : une zone rafraîchie après coup porte un `updatedAt` plus récent
   * que la vérification. Sans ce tri, elle resterait « à mettre à jour »
   * jusqu'à la vérification suivante — une semaine plus tard.
   */
  const freshness = useMemo<Freshness | null>(() => {
    if (!freshnessResult) return null;
    const stale = freshnessResult.stale.filter((s) => {
      const region = regions.find((r) => r.id === s.id);
      return !!region && region.updatedAt <= freshnessResult.checkedAt;
    });
    return { ...freshnessResult, stale };
  }, [freshnessResult, regions]);

  /** La dernière vérification réussie, `0` si aucune zone n'a jamais été vérifiée. */
  const lastChecked = regions.reduce((latest, r) => Math.max(latest, r.checkedAt), 0);

  /**
   * Mise à jour automatique, **toujours, sans case à cocher** (demande
   * explicite) — mais seulement si les conditions réseau s'y prêtent — retélécharger une zone de 250 Mo sur un
   * forfait mobile serait une trahison. Elle part d'ici et non du fond, parce
   * que les téléchargements ne vivent que fenêtre ouverte.
   */
  useEffect(() => {
    if (!freshness || !canDownload(prefs)) return;
    for (const stale of freshness.stale) {
      const region = regions.find((r) => r.id === stale.id);
      if (region?.status === "ready" && !running.current.has(region.id)) update(region);
    }
  }, [freshness, prefs, regions, update]);

  const cancel = useCallback((id: string) => running.current.get(id)?.(), []);

  /**
   * Suspend et reprend selon l'état du réseau.
   *
   * Ne reprend que ce que **l'application** a suspendu : une zone interrompue
   * à la main doit le rester, sinon le bouton « interrompre » ne servirait à
   * rien dès que le wifi revient.
   */
  useEffect(() => {
    const react = () => {
      const ok = canDownload(prefs);
      if (!ok) {
        for (const [id, stop] of running.current) {
          stop();
          void (async () => {
            const region = regions.find((r) => r.id === id);
            if (region) await putRegion({ ...region, status: "paused", pausedBy: "system" });
          })();
        }
        return;
      }
      for (const region of regions) {
        if (region.status === "paused" && region.pausedBy === "system" && !running.current.has(region.id)) {
          resume({ ...region, pausedBy: undefined });
        }
      }
    };
    return watchConnection(react);
  }, [regions, prefs, resume]);

  const remove = useCallback(
    async (id: string) => {
      running.current.get(id)?.();
      await removeRegion(id);
      await reload();
    },
    [reload],
  );

  // Les téléchargements en cours sont abandonnés proprement si la page part.
  useEffect(() => () => running.current.forEach((stop) => stop()), []);

  return {
    regions,
    progress,
    freshness,
    lastChecked,
    checking,
    storage,
    store,
    start,
    resume,
    update,
    cancel,
    remove,
    check,
    reload,
  };
}
