import { useSyncExternalStore } from "react";

// ---------------------------------------------------------------------------
// L'alerte de descente, en transports (demande explicite, 15 octobre 2026,
// « comme dans Citymapper ») : le téléphone vibre fort quand le train quitte
// l'avant-dernière station.
//
// Dans la poche, la page est en pause : l'alerte est donc **une alarme
// d'Android programmée à l'avance** (greffon `GetOffAlert`), sur l'horaire du
// train réellement pris. Le GPS ne fait que l'avancer, quand il capte et que
// l'application est ouverte (`useTransitNavigation`). Une seule alerte à la
// fois : en programmer une remplace la précédente.
//
// Hors de l'APK (version Docker), une minuterie et `navigator.vibrate`, qui ne
// valent que page ouverte.
// ---------------------------------------------------------------------------

interface GetOffAlertPlugin {
  schedule(options: { at: number; title: string; body: string }): Promise<{ exact: boolean }>;
  cancel(): Promise<void>;
  status(): Promise<GetOffStatus>;
  requestNotifications(): Promise<GetOffStatus>;
  openExactAlarmSettings(): Promise<void>;
}

export interface GetOffStatus {
  /** Les notifications sont permises : l'alerte dit où descendre. */
  notifications: boolean;
  /** « Alarmes et rappels » est accordé : l'alerte tombe à l'heure, même téléphone endormi. */
  exact: boolean;
}

/** La même secousse que le greffon : court-court-long, trois fois. */
const PATTERN = [200, 150, 200, 150, 1000, 600, 200, 150, 200, 150, 1000, 600, 200, 150, 200, 150, 1000];

function plugin(): GetOffAlertPlugin | null {
  const capacitor = (
    window as unknown as { Capacitor?: { isPluginAvailable?: (name: string) => boolean; Plugins?: Record<string, unknown> } }
  ).Capacitor;
  if (!capacitor?.isPluginAvailable?.("GetOffAlert")) return null;
  return (capacitor.Plugins?.GetOffAlert as GetOffAlertPlugin | undefined) ?? null;
}

let webTimer = 0;

/** Programme l'alerte (remplace la précédente). Ne lève jamais : sans alerte, la navigation continue. */
export function scheduleGetOff(at: number, title: string, body: string): void {
  const native = plugin();
  if (native) {
    void native.schedule({ at, title, body }).catch(() => {});
    return;
  }
  window.clearTimeout(webTimer);
  webTimer = window.setTimeout(() => navigator.vibrate?.(PATTERN), Math.max(0, at - Date.now()));
}

export function cancelGetOff(): void {
  void plugin()?.cancel().catch(() => {});
  window.clearTimeout(webTimer);
}

// L'état des deux autorisations, relu au retour dans l'application : elles se
// donnent dans les réglages d'Android, sans que la page en soit prévenue.
let status: GetOffStatus | null = null;
const listeners = new Set<() => void>();

function publish(next: GetOffStatus | null) {
  if (next && status && next.notifications === status.notifications && next.exact === status.exact) return;
  status = next;
  for (const listener of listeners) listener();
}

function refresh() {
  void plugin()?.status().then(publish).catch(() => {});
}

function subscribe(listener: () => void) {
  if (!listeners.size) {
    refresh();
    document.addEventListener("visibilitychange", refresh);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) document.removeEventListener("visibilitychange", refresh);
  };
}

/** `null` hors de l'APK, ou tant que le greffon n'a pas répondu. */
export function useGetOffStatus(): GetOffStatus | null {
  return useSyncExternalStore(subscribe, () => status, () => status);
}

/** Demande la permission des notifications (Android 13+), une fois, au départ d'une navigation. */
export function askGetOffPermission(): void {
  void plugin()?.requestNotifications().then(publish).catch(() => {});
}

export function openExactAlarmSettings(): void {
  void plugin()?.openExactAlarmSettings().catch(() => {});
}
