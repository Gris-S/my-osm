import { t } from "../i18n";
import type { DepartureGroup as CanonicalGroup, TransitMode } from "./model";

// ---------------------------------------------------------------------------
// Du modèle canonique à ce qu'affiche la fiche d'un arrêt.
//
// Les formes rendues sont exactement celles que `TransitDepartures` affichait
// avant la refonte (une entrée par ligne, ses destinations dedans) : l'écran ne
// change pas, seule l'origine des données passe par l'orchestrateur. `realtime`
// s'y ajoute, pour le badge « Temps réel » / « Horaire théorique » à venir.
// ---------------------------------------------------------------------------

export interface Departure {
  at: Date;
  /** Minutes restantes, négatives si le passage vient d'avoir lieu. */
  minutes: number;
  destination: string;
  platform?: string;
  cancelled: boolean;
  realtime: boolean;
}

export interface DepartureGroup {
  key: string;
  label: string;
  departures: Departure[];
}

export interface LineDepartures {
  /** Identifiant canonique de la ligne : c'est lui que la carte reçoit pour le tracé. */
  lineId: string;
  label: string;
  mode: TransitMode;
  color: string;
  textColor: string;
  groups: DepartureGroup[];
}

/** Couleur d'une ligne dont la source n'en donne pas : celle de son mode. */
export const MODE_COLORS: Record<TransitMode, { color: string; textColor: string }> = {
  metro: { color: "#0A84FF", textColor: "#FFFFFF" },
  tram: { color: "#30B0C7", textColor: "#FFFFFF" },
  bus: { color: "#5856D6", textColor: "#FFFFFF" },
  rail: { color: "#636366", textColor: "#FFFFFF" },
  "regional-rail": { color: "#D70015", textColor: "#FFFFFF" },
  ferry: { color: "#0071A4", textColor: "#FFFFFF" },
  funicular: { color: "#8E6E53", textColor: "#FFFFFF" },
  cable: { color: "#8E6E53", textColor: "#FFFFFF" },
  coach: { color: "#48484A", textColor: "#FFFFFF" },
  other: { color: "#5856D6", textColor: "#FFFFFF" },
};

/**
 * Regroupe par ligne des groupes canoniques (ligne × destination), dans l'ordre
 * où la source les a rendus : l'adaptateur a déjà classé les lignes et les
 * destinations, il n'y a rien à retrier.
 */
export function toLineDepartures(groups: CanonicalGroup[], now: number): LineDepartures[] {
  const lines = new Map<string, LineDepartures>();
  for (const group of groups) {
    let line = lines.get(group.line.id);
    if (!line) {
      const fallback = MODE_COLORS[group.line.mode];
      line = {
        lineId: group.line.id,
        label: group.line.shortName,
        mode: group.line.mode,
        color: group.line.color ?? fallback.color,
        textColor: group.line.textColor ?? fallback.textColor,
        groups: [],
      };
      lines.set(group.line.id, line);
    }
    line.groups.push({
      key: group.destination,
      label: t("departures.towards", { destination: group.destination }),
      departures: group.departures.map((departure) => {
        const time = departure.expectedAt ?? departure.scheduledAt;
        return {
          at: new Date(time),
          minutes: Math.round((time - now) / 60000),
          destination: departure.destination,
          platform: departure.platform,
          cancelled: departure.cancelled,
          realtime: departure.dataQuality === "realtime",
        };
      }),
    });
  }
  return [...lines.values()];
}
