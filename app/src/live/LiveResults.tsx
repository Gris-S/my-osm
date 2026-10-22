import { Bike, Fuel, PlugZap, Settings } from "lucide-react";
import { useI18n } from "../i18n";
import type { LonLat } from "../types";
import { useBikeNetworks } from "./bikes";
import { fullPrice } from "./format";
import { fuelLabel } from "./labels";
import { liveSearch, type LiveSearchRow } from "./search";
import { useBikesModeEnabled, useFuelModeEnabled, useFuelType, type FuelType } from "./settings";
import { useLiveItems } from "./useLiveLayer";

// ---------------------------------------------------------------------------
// Les lignes des modes en direct dans la liste de la barre de recherche
// (`liveSearch`), sur le patron des résultats ordinaires. Un composant à part
// plutôt que dans `SearchBar` : ses abonnements (réglages, repères, réseaux)
// ne redessinent ainsi que lui.
// ---------------------------------------------------------------------------

export function LiveResults({ query, near, onAction }: { query: string; near: LonLat; onAction: (row: LiveSearchRow) => void }) {
  const bikes = useBikesModeEnabled();
  const fuel = useFuelModeEnabled();
  const fuelType = useFuelType();
  const networks = useBikeNetworks(bikes && query.length >= 3);
  const items = useLiveItems();
  const rows = liveSearch(query, { bikes, fuel, electric: fuelType === "ev", networks, items, near });
  return (
    <>
      {rows.map((row) => (
        <LiveRow key={liveRowKey(row)} row={row} fuelType={fuelType} onPick={() => row.kind !== "off" && onAction(row)} />
      ))}
    </>
  );
}

function liveRowKey(row: LiveSearchRow): string {
  if (row.kind === "all") return `live-all-${row.target}`;
  if (row.kind === "off") return `live-off-${row.mode}`;
  if (row.kind === "network") return `live-net-${row.network.id}`;
  return `live-item-${row.item.kind === "charger" ? row.item.charger.id : row.item.station.id}`;
}

/** Une ligne des modes en direct, sur le patron des résultats ordinaires. */
function LiveRow({ row, fuelType, onPick }: { row: LiveSearchRow; fuelType: FuelType; onPick: () => void }) {
  const { t, tp, locale } = useI18n();
  const meters = (m: number) =>
    m < 1000 ? `${Math.round(m / 10) * 10} m` : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(m / 1000)} km`;
  // L'électrique n'a pas de prix : « toutes les stations-service » montre alors le SP95-E10.
  const priced = fuelType === "ev" ? "e10" : fuelType;
  let icon = <Bike size={17} />;
  let name = "";
  let detail = "";
  let value = "";
  if (row.kind === "off") {
    icon = <Settings size={17} />;
    name = t("live.search.off", { mode: t(row.mode === "bikes" ? "live.bikes" : "live.fuel") });
    detail = t("live.search.offHint");
  } else if (row.kind === "all") {
    icon = row.target === "fuel" ? <Fuel size={17} /> : row.target === "chargers" ? <PlugZap size={17} /> : <Bike size={17} />;
    if (row.target === "fuel") {
      name = t("live.search.allFuel");
      detail = t("live.search.allFuelHint", { fuel: t(fuelLabel(priced)) });
    } else if (row.target === "chargers") {
      name = t("live.search.allChargers");
      detail = t("live.search.allChargersHint");
    } else {
      name = t("live.search.allBikes");
      detail = t("live.search.allBikesHint");
    }
  } else if (row.kind === "network") {
    name = row.network.name;
    detail = t("live.search.network", { city: row.network.city });
  } else if (row.item.kind === "bike") {
    const s = row.item.station;
    name = s.name;
    detail = `${tp("live.bikes.electric", s.electric)} · ${meters(row.meters)}`;
    value = String(s.mechanical + s.electric);
  } else if (row.item.kind === "fuel") {
    const s = row.item.station;
    icon = <Fuel size={17} />;
    name = s.brand ? t("live.stationBrand", { brand: s.brand }) : t("live.station");
    detail = `${s.address} · ${meters(row.meters)}`;
    const price = s.prices[priced];
    value = price ? fullPrice(price) : "";
  } else {
    const c = row.item.charger;
    icon = <PlugZap size={17} />;
    name = t("live.charger");
    detail = `${c.address || c.name} · ${meters(row.meters)}`;
    value = c.powerKw ? `${Math.round(c.powerKw)} kW` : "";
  }
  return (
    <button
      className={`search-result is-live ${row.kind === "all" ? "is-brand" : ""} ${row.kind === "off" ? "is-unset" : ""}`}
      onClick={onPick}
      aria-disabled={row.kind === "off"}
    >
      <span className="search-result-icon">{icon}</span>
      <div className="search-result-text">
        <div className="search-result-name">{name}</div>
        <div className="search-result-address">{detail}</div>
      </div>
      {value && <span className="search-result-live-value">{value}</span>}
    </button>
  );
}
