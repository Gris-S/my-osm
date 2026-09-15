// ---------------------------------------------------------------------------
// Luminosité ambiante → clair ou sombre, pour le thème « Automatique ».
//
// Le capteur est lu par un greffon natif propre à l'application
// (`apk/android/.../AmbientLightPlugin.java`) : aucune API web ne le donne dans
// une WebView Android — `AmbientLightSensor` n'y existe pas, vérifié sur
// Pixel 8. Dans un navigateur, le greffon est absent et le thème automatique
// retombe sur le thème de l'appareil (voir `hooks/useTheme.ts`).
//
// Deux protections contre le clignotement, parce qu'un thème qui bascule sans
// arrêt est pire qu'un thème fixe :
//
// - **Deux seuils écartés** : on passe au sombre sous `DARK_BELOW_LUX`, au clair
//   au-dessus de `LIGHT_ABOVE_LUX`, et entre les deux rien ne change. Un seul
//   seuil ferait basculer à chaque frémissement autour de sa valeur.
// - **Un délai de confirmation** (`SWITCH_DELAY_MS`) : l'ombre d'un pont, une
//   main passée devant le téléphone ne doivent pas repeindre la carte. Un
//   tunnel, une nuit qui tombe ou un jour qui se lève, eux, durent.
//
// Les relevés de la première seconde et demie (`SETTLE_MS`) s'appliquent sans
// délai : à l'ouverture, on veut le bon thème tout de suite, pas deux secondes
// après. Pas seulement le tout premier : Android envoie parfois à l'inscription
// une valeur périmée ou nulle, qui mettait la pièce éclairée en sombre, et la
// zone neutre l'y laissait ensuite.
// ---------------------------------------------------------------------------

export type Brightness = "dark" | "light";

/**
 * Les seuils sont **très bas**, et c'est voulu : sur Pixel 8, le capteur de
 * façade lit 110 à 200 lux dans une pièce éclairée, parfois 60, mais bien
 * moins dès que le téléphone est incliné loin de la lampe. Les seuils 50/150,
 * puis 15/40, laissaient encore une pièce éclairée en sombre — signalé deux
 * fois. Le sombre est réservé au **noir** : pièce éteinte, habitacle de nuit.
 */
/** En dessous : sombre. Pièce éteinte, habitacle de nuit. */
export const DARK_BELOW_LUX = 5;
/** Au-dessus : clair. Jour, même couvert ; pièce éclairée, même faiblement. */
export const LIGHT_ABOVE_LUX = 15;
/** Durée pendant laquelle la nouvelle luminosité doit tenir avant de basculer. */
export const SWITCH_DELAY_MS = 2000;
/** Après le premier relevé, fenêtre pendant laquelle chaque relevé s'applique sans délai. */
export const SETTLE_MS = 1500;

interface PluginListenerHandle {
  remove: () => Promise<void>;
}

/**
 * Le proxy que le pont natif pose sur `window.Capacitor.Plugins` n'est pas
 * celui de `@capacitor/core` : son `addListener` ne rend **pas** une promesse
 * (mesuré sur Pixel 8 — `.then` sur son résultat a fait tomber toute
 * l'application). Tout ce qu'il rend est donc passé par `Promise.resolve`, et
 * rien n'est supposé sur la forme de la poignée.
 */
interface AmbientLightPlugin {
  start: () => unknown;
  stop: () => unknown;
  addListener: (event: "light", listener: (data: { lux: number }) => void) => unknown;
  removeAllListeners?: () => unknown;
}

interface CapacitorGlobal {
  Plugins?: Record<string, unknown>;
  isPluginAvailable?: (name: string) => boolean;
}

/** Le greffon natif, s'il existe (APK), sans dépendre de `@capacitor/core`. */
function ambientLightPlugin(): AmbientLightPlugin | null {
  const capacitor = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  if (!capacitor?.isPluginAvailable?.("AmbientLight")) return null;
  return (capacitor.Plugins?.AmbientLight as AmbientLightPlugin | undefined) ?? null;
}

/** Vrai si l'application peut espérer un capteur (APK). Le téléphone peut encore ne pas en avoir. */
export function hasAmbientLightPlugin(): boolean {
  return ambientLightPlugin() !== null;
}

/**
 * Suit la luminosité ambiante. `onChange` reçoit chaque bascule confirmée ;
 * `onUnavailable` est appelé si le greffon ou le capteur manque. Rend la
 * fonction qui arrête l'écoute.
 */
export function watchBrightness(onChange: (brightness: Brightness) => void, onUnavailable: () => void): () => void {
  const plugin = ambientLightPlugin();
  if (!plugin) {
    onUnavailable();
    return () => {};
  }

  let current: Brightness | null = null;
  /** Instant du premier relevé : jusqu'à `SETTLE_MS` après, pas de confirmation. */
  let firstAt = 0;
  let pending: Brightness | null = null;
  let timer: number | null = null;
  let stopped = false;
  let handle: PluginListenerHandle | null = null;

  const clearPending = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    pending = null;
  };

  const onReading = ({ lux }: { lux: number }) => {
    if (stopped || !Number.isFinite(lux)) return;
    const target: Brightness | null = lux < DARK_BELOW_LUX ? "dark" : lux > LIGHT_ABOVE_LUX ? "light" : null;

    if (current === null || Date.now() - firstAt < SETTLE_MS) {
      // Ouverture : appliqué tout de suite. Entre les deux seuils, on tranche
      // au milieu — il faut bien partir de quelque part.
      if (current === null) firstAt = Date.now();
      const next = target ?? (lux < (DARK_BELOW_LUX + LIGHT_ABOVE_LUX) / 2 ? "dark" : "light");
      clearPending();
      if (next !== current) {
        current = next;
        onChange(next);
      }
      return;
    }
    // Dans la zone neutre, ou revenu du bon côté : la bascule en attente tombe.
    if (target === null || target === current) {
      clearPending();
      return;
    }
    if (pending === target) return; // déjà en attente de confirmation
    clearPending();
    pending = target;
    timer = window.setTimeout(() => {
      timer = null;
      pending = null;
      current = target;
      onChange(target);
    }, SWITCH_DELAY_MS);
  };

  /** Retire l'écouteur, quelle que soit la forme de la poignée reçue. */
  const removeListener = (listener: unknown) => {
    try {
      const remove = (listener as Partial<PluginListenerHandle> | null)?.remove;
      if (typeof remove === "function") void Promise.resolve(remove.call(listener)).catch(() => {});
      else void Promise.resolve(plugin.removeAllListeners?.()).catch(() => {});
    } catch {
      /* rien à retirer */
    }
  };

  // L'écouteur d'abord, le capteur ensuite : Android envoie un relevé dès
  // l'inscription, et il serait perdu sinon. **Aucune erreur du greffon ne doit
  // remonter** : un capteur qui manque vaut un thème qui suit l'appareil, pas
  // un écran d'erreur.
  const fail = () => {
    if (!stopped) onUnavailable();
  };
  try {
    Promise.resolve(plugin.addListener("light", onReading))
      .then((listener) => {
        if (stopped) {
          removeListener(listener);
          return;
        }
        handle = listener as PluginListenerHandle;
        return Promise.resolve(plugin.start());
      })
      .catch(fail);
  } catch {
    fail();
  }

  return () => {
    stopped = true;
    clearPending();
    if (handle) removeListener(handle);
    try {
      void Promise.resolve(plugin.stop()).catch(() => {});
    } catch {
      /* l'application se ferme peut-être : rien à faire */
    }
  };
}
