import { useCallback, useEffect, useRef, useState } from "react";
import { useActivation } from "../hooks/useActivation";
import { useLatest } from "../hooks/useLatest";

// ---------------------------------------------------------------------------
// Le compteur de pas.
//
// **Aucun navigateur ne donne accès au podomètre du système** : le compteur de
// pas d'Android (`TYPE_STEP_COUNTER`) et celui d'iOS (CoreMotion) sont
// réservés aux applications natives. Ce qu'un navigateur offre, c'est
// l'accéléromètre brut — d'où le comptage fait ici, par détection de pics.
//
// Ce module est écrit pour être **remplacé tel quel au packaging APK**, comme
// `useGeolocation` : l'interface `{ steps, source, error }` ne change pas, seul
// le corps de l'effet est à réécrire. Côté Capacitor il faudra :
//
//   - un greffon exposant le capteur de pas du système (le compteur matériel,
//     bien plus juste que ce qui suit, et qui continue de compter écran
//     éteint) ;
//   - la permission Android `ACTIVITY_RECOGNITION`, obligatoire depuis
//     Android 10 pour ce capteur, demandée à l'exécution — c'est la « demande
//     d'accès » que le web ne sait pas faire ici, puisqu'il n'a pas le capteur ;
//   - `source` passant alors à `"device"`, ce que la fiche de fin de trajet
//     affiche déjà différemment de `"sensor"` et d'`"estimate"`.
//
// Deux limites du comptage web, à ne pas cacher à l'utilisateur :
// il s'arrête quand l'écran s'éteint ou que l'onglet passe à l'arrière-plan, et
// sa justesse dépend de la façon dont le téléphone est porté. C'est pourquoi la
// fiche de fin dit **d'où vient le chiffre**, et retombe sur l'estimation par
// la distance dès que le capteur n'a rien rendu.
// ---------------------------------------------------------------------------

/** D'où vient le nombre de pas affiché. */
export type StepSource = "sensor" | "estimate" | "device";

export interface StepCount {
  /**
   * Pas comptés depuis le démarrage ; `null` si aucun capteur ne répond. Lu à
   * la demande — à la fin du trajet — et **jamais publié en cours de route** :
   * rien ne l'affiche pendant la marche, et le publier deux fois par seconde
   * redessinait toute l'application pour rien.
   */
  read: () => number | null;
  error: string | null;
}

// --- Réglages de la détection de pics ---------------------------------------
//
// Un pas se lit comme une bosse d'accélération verticale. La ligne de base
// suit la pesanteur — elle change avec l'inclinaison du téléphone — et c'est
// l'écart à cette ligne qu'on regarde.

/** Inertie de la ligne de base : lente, pour ne pas absorber les pas eux-mêmes. */
const BASELINE_INERTIA = 0.05;

/** Écart, en m/s², au-delà duquel une bosse compte comme un pas. */
const PEAK = 1.1;

/** Écart en deçà duquel le détecteur se réarme : c'est le creux entre deux pas. */
const VALLEY = -0.25;

/** Intervalle minimal entre deux pas : au-delà de quatre pas par seconde, on court. */
const MIN_INTERVAL_MS = 250;

/** Sans le moindre relevé après ce délai, il n'y a pas de capteur à attendre. */
const SENSOR_TIMEOUT_MS = 4000;

/**
 * Demande l'accès aux capteurs de mouvement. À appeler **depuis un geste de
 * l'utilisateur** — le bouton « Démarrer » : iOS refuse la demande autrement,
 * et le contexte du geste est perdu dès qu'on passe par un effet.
 *
 * Sur Android et sur ordinateur, l'API de demande n'existe pas et les relevés
 * arrivent sans rien réclamer : l'absence de la fonction vaut accord.
 */
export async function requestMotionAccess(): Promise<boolean> {
  const api = (
    DeviceMotionEvent as unknown as { requestPermission?: () => Promise<PermissionState | string> }
  ).requestPermission;
  if (typeof api !== "function") return true;
  try {
    return (await api.call(DeviceMotionEvent)) === "granted";
  } catch {
    return false;
  }
}

/**
 * Compte les pas tant que `active` est vrai. Le compte repart de zéro à chaque
 * activation : c'est un trajet qu'on mesure, pas une journée.
 */
export function useStepCounter(active: boolean): StepCount {
  // Le numéro du suivi en cours, et celui dont le capteur est resté muet.
  const session = useActivation(active);
  const [silentSession, setSilentSession] = useState(0);
  // Le compte vit dans une ref, lue à la fin du trajet : aucun rendu par pas.
  const countRef = useRef(0);
  const supported = typeof DeviceMotionEvent !== "undefined";
  const error = active && (!supported || silentSession === session) ? "nomotion" : null;
  const errorRef = useLatest(error);

  useEffect(() => {
    if (!active || !supported) return;

    countRef.current = 0;
    let baseline = 9.81;
    let armed = true;
    let lastStep = 0;
    let heard = false;

    function onMotion(event: DeviceMotionEvent) {
      // `accelerationIncludingGravity` est le champ le plus largement servi ;
      // `acceleration` seul est absent de nombreux appareils.
      const a = event.accelerationIncludingGravity;
      if (!a || a.x === null || a.y === null || a.z === null) return;
      heard = true;

      const magnitude = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
      baseline += BASELINE_INERTIA * (magnitude - baseline);
      const swing = magnitude - baseline;

      const now = event.timeStamp || Date.now();
      if (armed && swing > PEAK && now - lastStep > MIN_INTERVAL_MS) {
        countRef.current += 1;
        lastStep = now;
        armed = false;
      } else if (swing < VALLEY) {
        // Le creux réarme : sans lui, une seule bosse large compterait
        // plusieurs pas au gré du bruit.
        armed = true;
      }
    }

    window.addEventListener("devicemotion", onMotion);
    const check = window.setTimeout(() => {
      if (!heard) setSilentSession(session);
    }, SENSOR_TIMEOUT_MS);

    return () => {
      window.removeEventListener("devicemotion", onMotion);
      window.clearTimeout(check);
    };
  }, [active, supported, session]);

  // Un capteur muet ne rend pas zéro pas : il ne rend rien, et c'est
  // l'estimation par la distance qui prend le relais.
  const read = useCallback(() => (errorRef.current ? null : countRef.current), [errorRef]);
  return { read, error };
}

/**
 * Longueur d'un pas de marche, en mètres. C'est la valeur usuelle des
 * podomètres pour un adulte de taille moyenne — la foulée fait le double, deux
 * pas. Elle vaut ce que vaut une moyenne : le chiffre qui en sort est annoncé
 * comme une estimation, et arrondi pour qu'on ne le lise pas comme un comptage.
 */
export const METERS_PER_STEP = 0.75;

/** Le nombre de pas d'une distance, arrondi à la cinquantaine. */
export function estimateSteps(meters: number): number {
  return Math.round(meters / METERS_PER_STEP / 50) * 50;
}
