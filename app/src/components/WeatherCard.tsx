import { useEffect, useRef, useState, memo } from "react";
import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudMoon,
  CloudRain,
  CloudRainWind,
  CloudSnow,
  CloudSun,
  Droplets,
  Leaf,
  Moon,
  Sun,
  TriangleAlert,
  Wind,
} from "lucide-react";
import {
  getAirQuality,
  getArea,
  getVigilance,
  getWeather,
  type AirReport,
  type Area,
  type VigilanceAlert,
  type WeatherNow,
} from "../services/weather";
import type { LonLat } from "../types";
import { useI18n, type TranslationKey } from "../i18n";
import { useBackClose } from "../hooks/useBackClose";

// ---------------------------------------------------------------------------
// Encart météo (en haut à droite).
//
// Replié, il tient en deux signes : le pictogramme du temps qu'il fait, en
// couleur, et la température. Déplié, il ajoute ce qu'on ne lit pas par la
// fenêtre — vigilances en cours, qualité de l'air, pollens.
//
// Le lieu observé est décidé par `App` : la position de l'utilisateur, ou
// celle du lieu qu'il vient de chercher. Ce qui coûte un appel de plus
// (qualité de l'air, pollens, vigilance) n'est demandé qu'au dépli.
// ---------------------------------------------------------------------------

/** Pictogramme, couleur et libellé d'un code temps de l'OMM. */
function weatherLook(code: number, isDay: boolean): { Icon: typeof Sun; color: string; label: TranslationKey } {
  const clear = isDay
    ? { Icon: Sun, color: "#ffb300", label: "sky.clear" as TranslationKey }
    : { Icon: Moon, color: "#b0b0c3", label: "sky.clearNight" as TranslationKey };
  const few = isDay
    ? { Icon: CloudSun, color: "#ffb300", label: "sky.few" as TranslationKey }
    : { Icon: CloudMoon, color: "#b0b0c3", label: "sky.few" as TranslationKey };

  if (code === 0) return clear;
  if (code === 1 || code === 2) return few;
  if (code === 3) return { Icon: Cloud, color: "#98989f", label: "sky.overcast" };
  if (code === 45 || code === 48) return { Icon: CloudFog, color: "#aeaeb2", label: "sky.fog" };
  if (code >= 51 && code <= 57) return { Icon: CloudDrizzle, color: "#5ac8fa", label: "sky.drizzle" };
  if (code >= 61 && code <= 67) return { Icon: CloudRain, color: "#0a84ff", label: "sky.rain" };
  if (code >= 71 && code <= 77) return { Icon: CloudSnow, color: "#64d2ff", label: "sky.snow" };
  if (code >= 80 && code <= 82) return { Icon: CloudRainWind, color: "#0a84ff", label: "sky.showers" };
  if (code === 85 || code === 86) return { Icon: CloudSnow, color: "#64d2ff", label: "sky.snowShowers" };
  if (code >= 95) return { Icon: CloudLightning, color: "#ff9f0a", label: "sky.thunder" };
  return { Icon: Cloud, color: "#98989f", label: "sky.cloudy" };
}

interface WeatherPanelProps {
  coords: LonLat;
  placeName: string | null;
  area: Area;
  weather: WeatherNow;
  look: ReturnType<typeof weatherLook>;
  /**
   * Vigilances en cours. Vide aussi bien quand il n'y en a pas que lorsqu'on
   * ne peut pas savoir — hors de France, sans identifiants Météo-France, ou si
   * la source ne répond pas : dans tous ces cas la section disparaît, plutôt
   * que d'occuper l'encart d'une phrase qui ne dit rien du temps qu'il fait.
   */
  alerts: VigilanceAlert[];
}

/**
 * Le dépli : ce qu'on ne lit pas par la fenêtre.
 *
 * Il est monté à l'ouverture et démonté à la fermeture — et remonté quand le
 * lieu change, grâce à la clé posée par l'encart. Son état part donc de
 * « chargement » sans avoir à le réinitialiser, et les relevés d'un lieu ne
 * s'affichent jamais sous le nom d'un autre.
 *
 * Les vigilances, elles, sont cherchées par l'encart lui-même : elles doivent
 * se voir **avant** qu'on ouvre quoi que ce soit.
 */
function WeatherPanel({ coords, placeName, area, weather, look, alerts }: WeatherPanelProps) {
  const { t } = useI18n();
  const [air, setAir] = useState<AirReport | null>(null);
  const [airDone, setAirDone] = useState(false);
  const { Icon } = look;
  const { lon, lat } = coords;

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    getAirQuality({ lon, lat }, controller.signal)
      .catch(() => null)
      .then((report) => {
        if (cancelled) return;
        setAir(report);
        setAirDone(true);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [lon, lat]);

  const placeLabel = placeName ?? area.city ?? t("weather.here");

  return (
    <div className="weather-panel" role="group" aria-label={t("weather.aria")}>
      <div className="weather-head">
        <Icon size={34} color={look.color} />
        <div className="weather-head-text">
          <span className="weather-place">{placeLabel}</span>
          <span className="weather-desc">
            {t("weather.feels", { label: t(look.label), temp: Math.round(weather.apparent) })}
          </span>
        </div>
        <span className="weather-big">{Math.round(weather.temperature)}°</span>
      </div>

      <div className="weather-stats">
        <span>
          <Wind size={14} /> {Math.round(weather.wind)} km/h
        </span>
        <span>
          <Droplets size={14} /> {Math.round(weather.humidity)} %
        </span>
      </div>

      {alerts.length > 0 && (
        <section className="weather-section">
          <h3 className="weather-section-title">
            <TriangleAlert size={14} />
            {t("weather.alerts")}
          </h3>
          {alerts.map((alert) => (
            <div key={alert.phenomenon} className="weather-alert">
              <span className="weather-alert-dot" style={{ background: alert.color }} />
              <span className="weather-alert-name">{t(alert.phenomenon)}</span>
              <span className="weather-alert-level">{t(alert.level)}</span>
            </div>
          ))}
        </section>
      )}

      {!airDone && <p className="weather-note">{t("weather.loading")}</p>}

      {airDone && (
        <>
          <section className="weather-section">
            <h3 className="weather-section-title">{t("weather.air")}</h3>
            {air?.air ? (
              <div className="weather-aqi">
                <span className="weather-aqi-index" style={{ background: air.air.color }}>
                  {air.air.index}
                </span>
                <span className="weather-aqi-label">{t(air.air.label)}</span>
                <span className="weather-aqi-scale">{t("weather.airScale")}</span>
              </div>
            ) : (
              <p className="weather-note">{t("weather.airMissing")}</p>
            )}
          </section>

          <section className="weather-section">
            <h3 className="weather-section-title">
              <Leaf size={14} />
              {t("weather.pollens")}
            </h3>
            {air?.pollens.length ? (
              <div className="weather-pollens">
                {air.pollens.map((pollen) => (
                  <div key={pollen.label} className="weather-pollen">
                    <span className="weather-pollen-name">{t(pollen.label)}</span>
                    <span className="weather-pollen-level" style={{ color: pollen.color }}>
                      {t(pollen.level)}
                    </span>
                    <span className="weather-pollen-value">{t("weather.pollenUnit", { value: pollen.value })}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="weather-note">
                {air ? t("weather.pollensNone") : t("weather.pollensMissing")}
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

interface WeatherCardProps {
  coords: LonLat;
  /** Nom du lieu cherché, s'il y en a un ; sinon l'endroit sera nommé par la BAN. */
  placeName: string | null;
}

// Protégé contre les rendus inutiles (`memo`) : `App` se redessine à chaque
// relevé GPS d'une navigation, et ce composant n'a alors rien de neuf à montrer.
export const WeatherCard = memo(function WeatherCard({ coords, placeName }: WeatherCardProps) {
  const { t } = useI18n();
  const [weather, setWeather] = useState<WeatherNow | null>(null);
  const [area, setArea] = useState<Area>({});
  const [alerts, setAlerts] = useState<VigilanceAlert[]>([]);
  const [open, setOpen] = useState(false);
  useBackClose(open, () => setOpen(false));
  const wrapRef = useRef<HTMLDivElement>(null);

  const { lon, lat } = coords;

  // Le relevé suit le lieu observé. Un échec efface simplement l'encart : un
  // carré vide en haut de la carte vaut moins que rien du tout.
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    getWeather({ lon, lat }, controller.signal)
      .then((next) => {
        if (!cancelled) setWeather(next);
      })
      .catch(() => {
        if (!cancelled) setWeather(null);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [lon, lat]);

  // Vigilances : elles doivent se voir **sans ouvrir l'encart**, puisque
  // c'est tout leur objet — d'où cette recherche menée avec le relevé, et non
  // au dépli comme la qualité de l'air. Le nom du lieu vient de la même
  // requête et sert au panneau.
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    (async () => {
      const found = await getArea({ lon, lat }, controller.signal);
      if (cancelled) return;
      setArea(found);

      // La vigilance est française et se lit par département : hors de France,
      // la question ne se pose pas. Sans identifiants ou sans réponse non
      // plus — dans tous ces cas, rien à signaler.
      const current = found.department
        ? await getVigilance(found.department, controller.signal).catch(() => [])
        : [];
      if (!cancelled) setAlerts(current);
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [lon, lat]);

  // Fermeture au clic à l'extérieur et à Échap, comme les autres encarts.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!weather) return null;

  const look = weatherLook(weather.code, weather.isDay);
  const { Icon } = look;
  // Les vigilances arrivent triées, la plus grave en tête : c'est elle que la
  // pastille annonce, à sa couleur officielle.
  const worst = alerts[0];

  return (
    <div className="weather" ref={wrapRef}>
      <button
        className={`weather-card ${open ? "is-open" : ""}`}
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        title={
          worst
            ? t("weather.alertTitle", {
                level: t(worst.levelInline),
                phenomenon: t(worst.phenomenon),
                temp: Math.round(weather.temperature),
              })
            : t("weather.plainTitle", { label: t(look.label), temp: Math.round(weather.temperature) })
        }
      >
        {/* La pastille ouvre le bandeau, à gauche du pictogramme : posée à
            droite, elle mordait sur la température. */}
        {worst && (
          <span
            className="weather-badge"
            style={{ background: worst.color }}
            aria-label={t("weather.alertBadge", { level: t(worst.levelInline), phenomenon: t(worst.phenomenon) })}
          />
        )}
        <Icon size={20} color={look.color} />
        <span className="weather-temp">{Math.round(weather.temperature)}°</span>
      </button>

      {open && (
        <WeatherPanel
          key={`${lon},${lat}`}
          coords={coords}
          placeName={placeName}
          area={area}
          weather={weather}
          look={look}
          alerts={alerts}
        />
      )}
    </div>
  );
});
