import { useEffect } from "react";

// ---------------------------------------------------------------------------
// Garder l'écran allumé pendant un guidage.
//
// Sans cela, le téléphone s'éteint au bout d'une minute et le guidage avec lui :
// l'écran noir, les minuteurs bridés, et le relevé de position qui s'espace.
// C'est le défaut le plus certain d'une navigation embarquée, et il ne se voit
// qu'en conduisant.
//
// L'API `navigator.wakeLock` est celle du navigateur, pas un greffon : elle
// fonctionne aussi bien dans un onglet que dans la WebView Android d'un APK, et
// n'ajoute donc aucune dépendance au dossier. C'est ce qui permet de la mettre
// ici plutôt que dans la coquille native.
//
// **Le verrou est perdu dès que la page passe en arrière-plan**, et n'est pas
// rendu au retour : c'est la spécification, pas un défaut. D'où la reprise sur
// `visibilitychange` — sans elle, répondre à un message au feu rouge suffirait
// à éteindre l'écran pour le reste du trajet.
// ---------------------------------------------------------------------------

/**
 * Ce que la page expose, tel qu'on s'en sert. La définition officielle n'est
 * pas encore dans les types du projet, et l'API peut manquer : le `?` sur
 * `wakeLock` n'est pas décoratif.
 */
interface WakeLockSentinel {
  released: boolean;
  release(): Promise<void>;
}

interface WakeLockNavigator {
  wakeLock?: { request(type: "screen"): Promise<WakeLockSentinel> };
}

/**
 * Maintient l'écran allumé tant que `active` est vrai.
 *
 * Un échec est **silencieux**, et c'est voulu : l'API manque sur certains
 * navigateurs, et le système refuse le verrou quand la batterie est au plus
 * bas. Dans les deux cas le guidage continue — l'écran s'éteindra, ce qui est
 * gênant, mais l'annoncer par une erreur au milieu d'une manœuvre le serait
 * davantage.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const api = (navigator as Navigator & WakeLockNavigator).wakeLock;
    if (!api) return;

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    async function acquire() {
      try {
        const next = await api!.request("screen");
        // L'effet a pu être nettoyé pendant l'attente : on rend aussitôt un
        // verrou dont plus personne ne veut.
        if (cancelled) void next.release().catch(() => {});
        else sentinel = next;
      } catch {
        // Refusé (batterie faible) ou indisponible : tant pis pour l'écran.
      }
    }

    // Le système reprend le verrou quand la page passe en arrière-plan. Au
    // retour, il faut le redemander — il n'est jamais rendu tout seul.
    function onVisible() {
      if (document.visibilityState === "visible" && (!sentinel || sentinel.released)) {
        void acquire();
      }
    }

    void acquire();
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel?.release().catch(() => {});
      sentinel = null;
    };
  }, [active]);
}
