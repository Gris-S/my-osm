import type { TranslationKey } from "../i18n";
import type { FuelType } from "./settings";

const FUEL_LABELS: Record<FuelType, TranslationKey> = {
  gazole: "live.fuel.gazole",
  e10: "live.fuel.e10",
  sp95: "live.fuel.sp95",
  sp98: "live.fuel.sp98",
  e85: "live.fuel.e85",
  gplc: "live.fuel.gplc",
  ev: "live.fuel.ev",
};

/** Le nom d'un carburant, à traduire : « SP95-E10 », « Unleaded E10 ». */
export const fuelLabel = (fuel: FuelType): TranslationKey => FUEL_LABELS[fuel];
