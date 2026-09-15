// ---------------------------------------------------------------------------
// La navigation guidée, en un seul point d'entrée.
//
// L'application n'importe **que** ce fichier : c'est ce qui permet de retirer
// la fonctionnalité en supprimant le dossier et en défaisant les cinq fichiers
// énumérés dans `README.md`.
// ---------------------------------------------------------------------------

import { lazy } from "react";

export { useNavigation } from "./useNavigation";
export type { NavSession, NavMapState, NavCamera, NavChoice } from "./useNavigation";
export { NavigationPanel } from "./NavigationPanel";
export { useCarNavigation } from "./car/useCarNavigation";
export type { CarNavSession } from "./car/useCarNavigation";
export type { CarTraffic, TrafficIncident } from "./car/carTraffic";
export { CarNavigationPanel } from "./car/CarNavigationPanel";
export { useTransitNavigation } from "./useTransitNavigation";
export type { TransitNavSession } from "./useTransitNavigation";
export { TransitNavigationPanel } from "./TransitNavigationPanel";
export { StartNavigationButton } from "./StartNavigationButton";
export { NavigationSettings } from "./NavigationSettings";
export { ModesSettings } from "./ModesSettings";
export { useRunModeEnabled } from "./settings";
// L'historique ne sert qu'à l'ouverture de sa fenêtre : chargé à la demande,
// il sort du démarrage avec sa carte, sa fiche et son partage en image.
export const HistoryPanel = lazy(() => import("./HistoryPanel").then((m) => ({ default: m.HistoryPanel })));
export { requestMotionAccess } from "./useStepCounter";
export { navText } from "./strings";
export { useNavDockClearance } from "./dockClearance";
export { useRunSession } from "./running/useRunSession";
export type { RunSession } from "./running/useRunSession";
export { RunPanel } from "./running/RunPanel";
export { RunButton } from "./running/RunButton";
