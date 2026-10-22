import { useEffect, useRef } from "react";
import { Navigation, X } from "lucide-react";
import { useI18n } from "../i18n";
import { fuelLabel } from "./labels";
import { useBackClose } from "../hooks/useBackClose";
import { BIKE_ICON, type IconNode } from "../filters";
import type { BikeStation } from "./bikes";
import type { Charger, FuelStation, LiquidFuel } from "./fuel";
import { LIQUID_FUELS } from "./fuel";
import { ageOf, fullPrice, isStale } from "./format";
import { CHARGER_ICON, FAST_KW, FUEL_ICON, LIVE_COLORS, bikeColor } from "./layers";
import { useFuelType } from "./settings";
import type { LiveItem } from "./useLiveLayer";

// ---------------------------------------------------------------------------
// La fiche d'une station en direct : vélos, carburants ou borne.
//
// Même place et mêmes gestes que la fiche d'un lieu (`PlaceSheet`) : en bas
// de l'écran, une croix, le geste retour, et sa hauteur annoncée pour que les
// boutons flottants la dégagent. En titre ce qu'est l'endroit et son enseigne,
// l'adresse en dessous (demande explicite).
// ---------------------------------------------------------------------------

interface LiveSheetProps {
  item: LiveItem;
  /** Les autres stations de la zone : « le moins cher du coin » se compare à elles. */
  nearbyFuel: FuelStation[];
  onClose: () => void;
  onRoute: () => void;
  onHeightChange: (height: number) => void;
}

/** Un pictogramme au format Lucide, tracé en SVG (le même qui est dessiné sur la carte). */
function Glyph({ icon }: { icon: IconNode }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {icon.map(([tag, attrs], i) => {
        const Tag = tag as "path";
        return <Tag key={i} {...attrs} />;
      })}
    </svg>
  );
}

function useAge() {
  const { t, tp } = useI18n();
  return (at: number) => {
    const { unit, value } = ageOf(at);
    if (unit === "days") return tp("live.age.days", value);
    if (unit === "now") return t("live.age.now");
    return t(unit === "minutes" ? "live.age.minutes" : "live.age.hours", { value });
  };
}

export function LiveSheet({ item, nearbyFuel, onClose, onRoute, onHeightChange }: LiveSheetProps) {
  const { t } = useI18n();
  const sheetRef = useRef<HTMLDivElement>(null);
  useBackClose(true, onClose);

  useEffect(() => {
    const element = sheetRef.current;
    if (!element) return;
    onHeightChange(element.offsetHeight);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => onHeightChange(element.offsetHeight));
    observer.observe(element);
    return () => {
      observer.disconnect();
      onHeightChange(0);
    };
  }, [onHeightChange]);

  return (
    <div className="sheet live-sheet" ref={sheetRef}>
      <button className="sheet-close" onClick={onClose} aria-label={t("sheet.close")}>
        <X size={18} />
      </button>
      {item.kind === "bike" && <BikeBody station={item.station} />}
      {item.kind === "fuel" && <FuelBody station={item.station} nearby={nearbyFuel} />}
      {item.kind === "charger" && <ChargerBody charger={item.charger} />}
      <div className="sheet-actions">
        <button className="sheet-action-primary" onClick={onRoute}>
          <Navigation size={16} />
          {t("sheet.itinerary")}
        </button>
      </div>
    </div>
  );
}

function Header({ icon, color, title, subtitle }: { icon: IconNode; color: string; title: string; subtitle: string }) {
  return (
    <div className="sheet-header live-header">
      <span className="live-header-icon" style={{ background: color }}>
        <Glyph icon={icon} />
      </span>
      <div>
        <h2 className="sheet-title">{title}</h2>
        {subtitle && <div className="sheet-subtitle">{subtitle}</div>}
      </div>
    </div>
  );
}

function BikeBody({ station: s }: { station: BikeStation }) {
  const { t, tp } = useI18n();
  const age = useAge();
  const total = s.mechanical + s.electric;
  const slots = s.slots ?? total + s.free;
  const share = (n: number) => `${(100 * n) / Math.max(1, slots)}%`;
  const network = s.network === "velib" ? "Vélib'" : "";
  return (
    <>
      <Header
        icon={BIKE_ICON}
        color={bikeColor(s)}
        title={t("live.bikeStation", { network, name: s.name }).replace(/\s+/g, " ").trim()}
        subtitle={t("live.bikes.slots", { count: slots })}
      />
      {!s.open && <p className="live-warning">{t("live.bikes.closed")}</p>}
      <div className="live-stats">
        <div className="live-stat">
          <b>{total}</b>
          <span>{tp("live.bikes.available", total)}</span>
        </div>
        <div className="live-stat">
          <b>{s.free}</b>
          <span>{tp("live.bikes.free", s.free)}</span>
        </div>
      </div>
      <div className="live-bar" aria-hidden="true">
        <i style={{ width: share(s.mechanical), background: LIVE_COLORS.bike }} />
        <i style={{ width: share(s.electric), background: LIVE_COLORS.ebike }} />
      </div>
      <div className="live-legend">
        <span style={{ "--c": LIVE_COLORS.bike } as React.CSSProperties}>{tp("live.bikes.mechanical", s.mechanical)}</span>
        <span style={{ "--c": LIVE_COLORS.ebike } as React.CSSProperties}>{tp("live.bikes.electric", s.electric)}</span>
      </div>
      <p className="live-source">{t("live.bikes.source", { age: age(s.at) })}</p>
    </>
  );
}

function FuelBody({ station: s, nearby }: { station: FuelStation; nearby: FuelStation[] }) {
  const { t } = useI18n();
  const age = useAge();
  const mine = useFuelType();
  const sold = LIQUID_FUELS.filter((fuel) => s.prices[fuel]);
  // Rupture : vendu ici d'habitude, manquant aujourd'hui. Non vendu : jamais à cette pompe.
  const shortage = s.shortage.filter((fuel) => !s.prices[fuel]);
  const cheapest = (fuel: LiquidFuel, price: number) => nearby.every((o) => (o.prices[fuel]?.price ?? Infinity) >= price);
  return (
    <>
      <Header
        icon={FUEL_ICON}
        color={LIVE_COLORS.fuel}
        title={s.brand ? t("live.stationBrand", { brand: s.brand }) : t("live.station")}
        subtitle={[s.address, s.city].filter(Boolean).join(", ")}
      />
      <div className="live-prices">
        {sold.length === 0 && shortage.length === 0 && <p className="sheet-subtitle">{t("live.noPrice")}</p>}
        {sold.map((fuel) => {
          const p = s.prices[fuel]!;
          const old = isStale(p.at);
          return (
            <div key={fuel} className={`live-price ${fuel === mine ? "is-mine" : ""}`}>
              <span className="live-price-name">
                {t(fuelLabel(fuel))}
                {fuel === mine && <small> · {t("live.price.mine")}</small>}
              </span>
              <span className="live-price-value">{fullPrice(p)}</span>
              <span className={`live-price-age ${old ? "is-old" : ""}`}>
                {t(old ? "live.price.old" : "live.price.updated", { age: age(p.at) })}
              </span>
              <span className="live-price-best">{cheapest(fuel, p.price) ? t("live.price.cheapest") : ""}</span>
            </div>
          );
        })}
        {shortage.map((fuel) => (
          <div key={fuel} className="live-price is-out">
            <span className="live-price-name">{t(fuelLabel(fuel))}</span>
            <span className="live-price-value">{t("live.shortage")}</span>
          </div>
        ))}
      </div>
      {s.notSold.length > 0 && (
        <p className="live-missing">{t("live.notSold", { fuels: s.notSold.map((fuel) => t(fuelLabel(fuel))).join(", ") })}</p>
      )}
      {(s.open24h || s.services.length > 0) && (
        <div className="live-tags">
          {s.open24h && <span className="live-tag">{t("live.open24h")}</span>}
          {s.services.slice(0, 4).map((service) => (
            <span key={service} className="live-tag">{service}</span>
          ))}
        </div>
      )}
      <p className="live-source">{t("live.fuelSource")}</p>
    </>
  );
}

function ChargerBody({ charger: c }: { charger: Charger }) {
  const { t } = useI18n();
  // Le nom d'Open Charge Map ressemble souvent à « Ville | adresse » : on n'en
  // garde que l'opérateur quand il y en a un.
  const operator = c.name.includes("|") || /^\d/.test(c.name) ? "" : c.name.split(" - ")[0];
  const fast = (c.powerKw ?? 0) >= FAST_KW;
  return (
    <>
      <Header
        icon={CHARGER_ICON}
        color={LIVE_COLORS.charger}
        title={operator ? t("live.chargerBrand", { brand: operator }) : t("live.charger")}
        subtitle={c.address || c.name}
      />
      <div className="live-stats">
        <div className="live-stat">
          {c.powerKw ? (
            <>
              <b>
                {Math.round(c.powerKw)}
                <small> kW</small>
              </b>
              <span>{t(fast ? "live.powerFast" : "live.power")}</span>
            </>
          ) : (
            <span>{t("live.powerUnknown")}</span>
          )}
        </div>
      </div>
      <p className="live-source">{t("live.chargerSource")}</p>
    </>
  );
}
