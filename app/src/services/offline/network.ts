import { t } from "../../i18n";

// ---------------------------------------------------------------------------
// Ce que le navigateur veut bien dire de la connexion.
//
// Très peu, et de façon très inégale : l'API `NetworkInformation` n'existe que
// sur Chrome et ses dérivés, et son champ `type` — le seul qui distingue
// vraiment le wifi de la 4G — n'est renseigné que sur Android. Firefox et
// Safari ne l'exposent pas du tout.
//
// D'où la règle qui gouverne ce module : **on ne bloque que sur une certitude.**
// Un « je ne sais pas » vaut « laisse passer ». Bloquer par précaution
// rendrait l'option « wifi uniquement » synonyme de « ne jamais télécharger »
// sur la moitié des navigateurs, sans que rien ne l'explique à l'utilisateur.
// ---------------------------------------------------------------------------

interface NetworkInformation extends EventTarget {
  type?: string;
  effectiveType?: string;
  saveData?: boolean;
}

function connection(): NetworkInformation | undefined {
  return (navigator as Navigator & { connection?: NetworkInformation }).connection;
}

/** Vrai seulement si l'on est **sûr** d'être sur une connexion facturée. */
export function isMetered(): boolean {
  const c = connection();
  if (!c) return false;
  if (c.saveData) return true;
  return c.type === "cellular";
}

/** Vrai si le navigateur sait répondre à la question. */
export function canDetectConnection(): boolean {
  const c = connection();
  return !!c && (c.type !== undefined || c.saveData !== undefined);
}

/** Libellé court de la connexion, pour l'expliquer dans le panneau. */
export function describeConnection(): string {
  if (!navigator.onLine) return t("network.offline");
  const c = connection();
  if (!c) return t("network.unknown");
  if (c.saveData) return t("network.saveData");
  switch (c.type) {
    case "wifi":
      return t("network.wifi");
    case "ethernet":
      return t("network.ethernet");
    case "cellular":
      return c.effectiveType ? t("network.cellularType", { type: c.effectiveType }) : t("network.cellular");
    default:
      return t("network.unknown");
  }
}

/** S'abonne aux changements d'état du réseau. Rend la fonction de désabonnement. */
export function watchConnection(onChange: () => void): () => void {
  const c = connection();
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  c?.addEventListener("change", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
    c?.removeEventListener("change", onChange);
  };
}
