import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import { Check, Download, HardDrive, Loader2, RefreshCw, Trash2, X } from "lucide-react";
import { CONFIG } from "../config";
import { useOfflineRegions } from "../hooks/useOfflineRegions";
import { freeBytes, estimateRasterBytes, estimateVectorBytes, formatBytes, type OfflineRegion } from "../services/offline";
import { estimateContourBytes, estimateReliefBytes, intersectsIgn } from "../services/offline/tiles";
import { calibrate, type Bbox } from "../services/offline/tiles";
import { levelForZoom, lookupBoundary, type Boundary, type BoundaryLevel } from "../services/offline/boundaries";
import { areaDeg2, type AreaGeometry } from "../services/offline/area";
import { addressBytes, countAddresses } from "../services/offline/addresses";
import { canDetectConnection, describeConnection } from "../services/offline/network";
import { useOfflinePrefs } from "../hooks/useOfflinePrefs";
import { resolveVectorTemplate } from "../services/offline/download";
import type { LonLat } from "../types";
import { useI18n, type TranslationKey } from "../i18n";
import { useBackClose } from "../hooks/useBackClose";

// ---------------------------------------------------------------------------
// Fenêtre « Téléchargement » du menu principal.
//
// Deux temps, dans cet ordre : choisir une zone sur une carte réduite, puis
// la liste de ce qui est déjà là. **On choisit d'un toucher, comme dans
// Organic Maps** (demande explicite, en remplacement du carré à tracer) : le
// zoom dit ce qu'on vise — un pays, une région, un département — et la zone
// touchée se surligne avec son contour exact, qui est aussi ce qu'on
// télécharge. Ce qui est déjà sur l'appareil apparaît en vert. Le poids
// estimé s'affiche dès le toucher : c'est le seul moyen de ne pas lancer un
// gigaoctet sans l'avoir vu.
// ---------------------------------------------------------------------------

const DETAILS: { id: OfflineRegion["detail"]; label: TranslationKey; hint: TranslationKey }[] = [
  { id: "map", label: "download.tierMap", hint: "download.tierMapHint" },
  { id: "places", label: "download.tierPlaces", hint: "download.tierPlacesHint" },
];

/**
 * La carte réduite s'ouvre au zoom d'une région : on voit où l'on est, et un
 * premier toucher prend une zone de taille raisonnable.
 */
const PICK_START_ZOOM = 6;

const EMPTY = { type: "FeatureCollection" as const, features: [] };

function feature(geometry: AreaGeometry) {
  return { type: "Feature" as const, properties: {}, geometry };
}

/** Le contour d'une zone tracée au carré, d'avant les contours. */
function bboxPolygon([w, s, e, n]: Bbox): AreaGeometry {
  return { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] };
}

interface Props {
  center: LonLat;
  onClose: () => void;
}

/** Ce qu'on dit d'une zone arrêtée, selon la raison rangée avec elle. */
const FAILURE_TEXT = {
  "storage-full": "download.failureStorageFull",
  write: "download.failureWrite",
  moved: "download.failureMoved",
} as const;

export function DownloadPanel({ center, onClose }: Props) {
  const { t, tp, locale } = useI18n();
  const mapNode = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  // La zone touchée, avec son contour ; `null` tant que rien n'est choisi.
  const [selection, setSelection] = useState<Boundary | null>(null);
  const bbox = selection?.bbox ?? null;
  // Ce qu'un toucher viserait au zoom courant de la carte réduite.
  const [pickLevel, setPickLevel] = useState<BoundaryLevel>(() => levelForZoom(PICK_START_ZOOM));
  const [lookup, setLookup] = useState<"idle" | "searching" | "none" | "failed">("idle");
  const [mapReady, setMapReady] = useState(false);
  const [detail, setDetail] = useState<OfflineRegion["detail"]>("places");
  const [satellite, setSatellite] = useState(false);
  const [satZoom, setSatZoom] = useState(CONFIG.OFFLINE.SATELLITE_ZOOM_DEFAULT);
  const [relief, setRelief] = useState(false);
  const [reliefZoom, setReliefZoom] = useState(CONFIG.OFFLINE.RELIEF_ZOOM_DEFAULT);
  const [name, setName] = useState("");
  // Le détail suit ce qu'on a touché, sans curseur : un pays ne descend pas au
  // zoom d'une rue.
  const vectorZoom = selection ? CONFIG.OFFLINE.LEVEL_VECTOR_ZOOM[selection.level] : CONFIG.OFFLINE.VECTOR_MAX_ZOOM;
  // Facteur de densité mesuré sur de vraies tuiles de la zone. Tant qu'il vaut
  // `null`, le chiffre affiché n'est qu'un ordre de grandeur — et il le dit.
  const [density, setDensity] = useState<number | null>(null);
  const [addresses, setAddresses] = useState(true);
  // Nombre **exact** d'adresses sous la sélection. Le comptage WFS est
  // gratuit — une requête, une demi-seconde — donc contrairement aux tuiles,
  // il n'y a rien à estimer ici.
  const [addrCount, setAddrCount] = useState<number | null>(null);
  // Confirmations **dans l'application** et non par le navigateur : une
  // fenêtre système sortirait du cadre de l'interface, et sur mobile elle est
  // parfois purement escamotée par le navigateur.
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmHeavy, setConfirmHeavy] = useState(false);
  // La place libre, quand la zone risque de ne pas tenir : un avertissement et
  // non un refus, l'estimation péchant volontairement par excès.
  const [spaceShort, setSpaceShort] = useState<{ free: number } | null>(null);
  // Le geste retour replie d'abord une confirmation ouverte, puis ferme la fenêtre.
  useBackClose(true, onClose);
  useBackClose(confirmDelete !== null, () => setConfirmDelete(null));
  useBackClose(confirmHeavy, () => setConfirmHeavy(false));
  useBackClose(spaceShort !== null, () => setSpaceShort(null));

  const { prefs, update: setPrefs } = useOfflinePrefs();
  const {
    regions,
    progress,
    freshness,
    lastChecked,
    checking,
    storage,
    start,
    resume,
    update,
    cancel,
    remove,
    check,
  } = useOfflineRegions({ prefs });

  // --- La carte réduite ----------------------------------------------------
  useEffect(() => {
    if (!mapNode.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapNode.current,
      style: CONFIG.MAP_STYLE_URL,
      center: [center.lon, center.lat],
      zoom: PICK_START_ZOOM,
      attributionControl: false,
    });
    mapRef.current = map;
    map.on("zoom", () => setPickLevel(levelForZoom(map.getZoom())));
    map.on("load", () => {
      // Les couleurs du thème, lues une fois : MapLibre ne connaît pas les
      // variables CSS.
      const css = getComputedStyle(document.documentElement);
      const accent = css.getPropertyValue("--accent").trim() || "#007aff";
      const green = css.getPropertyValue("--open").trim() || "#34c759";
      map.addSource("dl-downloaded", { type: "geojson", data: EMPTY });
      map.addSource("dl-selection", { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "dl-downloaded-fill",
        type: "fill",
        source: "dl-downloaded",
        paint: { "fill-color": green, "fill-opacity": 0.22 },
      });
      map.addLayer({
        id: "dl-downloaded-line",
        type: "line",
        source: "dl-downloaded",
        paint: { "line-color": green, "line-width": 1.5 },
      });
      map.addLayer({
        id: "dl-selection-fill",
        type: "fill",
        source: "dl-selection",
        paint: { "fill-color": accent, "fill-opacity": 0.25 },
      });
      map.addLayer({
        id: "dl-selection-line",
        type: "line",
        source: "dl-selection",
        paint: { "line-color": accent, "line-width": 2.5 },
      });
      setMapReady(true);
    });
    return () => {
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, [center.lon, center.lat]);

  // --- Choisir une zone d'un toucher ---------------------------------------
  //
  // Le zoom dit ce qu'on vise, et Nominatim rend le contour de ce qui est sous
  // le doigt (`services/offline/boundaries.ts`). Un nouveau toucher abandonne
  // la recherche précédente ; « rien ici » garde la zone déjà choisie.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    let controller: AbortController | null = null;
    const onClick = (e: maplibregl.MapMouseEvent) => {
      controller?.abort();
      const current = new AbortController();
      controller = current;
      setLookup("searching");
      lookupBoundary(e.lngLat.lng, e.lngLat.lat, levelForZoom(map.getZoom()), locale, current.signal)
        .then((found) => {
          if (current.signal.aborted) return;
          setLookup(found ? "idle" : "none");
          if (!found) return;
          setSelection(found);
          setName(found.name);
        })
        .catch(() => {
          if (!current.signal.aborted) setLookup("failed");
        });
    };
    map.on("click", onClick);
    return () => {
      map.off("click", onClick);
      controller?.abort();
    };
  }, [mapReady, locale]);

  // La zone choisie, surlignée.
  useEffect(() => {
    const source = mapRef.current?.getSource("dl-selection") as maplibregl.GeoJSONSource | undefined;
    if (!mapReady || !source) return;
    source.setData(selection ? feature(selection.area.geometry) : EMPTY);
  }, [mapReady, selection]);

  // Ce qui est déjà sur l'appareil, en vert : le contour quand la zone en a
  // un, son rectangle pour celles tracées au carré.
  useEffect(() => {
    const source = mapRef.current?.getSource("dl-downloaded") as maplibregl.GeoJSONSource | undefined;
    if (!mapReady || !source) return;
    source.setData({
      type: "FeatureCollection",
      features: regions.map((r) => feature(r.area?.geometry ?? bboxPolygon(r.bbox))),
    });
  }, [mapReady, regions]);

  // --- Calibrage -----------------------------------------------------------
  //
  // Une fois par zone choisie : il télécharge quatre tuiles, et un toucher est
  // un geste net — plus de glissement à laisser s'immobiliser. Un résultat qui
  // arrive après qu'on a touché une autre zone est jeté.
  const lastCalibrated = useRef<string>("");
  useEffect(() => {
    if (!selection || selection.id === lastCalibrated.current) return;
    const id = selection.id;
    lastCalibrated.current = id;
    setDensity(null);
    setAddrCount(null);
    void (async () => {
      try {
        const factor = await calibrate(selection, await resolveVectorTemplate());
        if (lastCalibrated.current === id) setDensity(factor);
      } catch {
        if (lastCalibrated.current === id) setDensity(null);
      }
    })();
    void (async () => {
      try {
        const count = await countAddresses(selection.bbox);
        if (lastCalibrated.current === id) setAddrCount(count);
      } catch {
        if (lastCalibrated.current === id) setAddrCount(null);
      }
    })();
  }, [selection]);

  // --- Estimation ----------------------------------------------------------
  const estimate = useMemo(() => {
    if (!selection) return { bytes: 0, vector: 0, raster: 0, dem: 0, addr: 0 };
    const vector = estimateVectorBytes(selection, vectorZoom) * (density ?? 1);
    const raster = satellite ? estimateRasterBytes(selection, satZoom) : 0;
    const dem = relief
      ? estimateReliefBytes(selection, reliefZoom) + estimateContourBytes(selection, reliefZoom)
      : 0;
    // Les détails de lieux pèsent environ 25 Mo pour Paris intra-muros, soit
    // ~1,2 Mo par centième de degré carré — mesuré sur une maille réelle.
    // Mesuré sur la surface du contour, pas sur son rectangle.
    const places = detail === "map" ? 0 : areaDeg2(selection.area.geometry) * 1.2e9;
    // Les fichiers d'adresses se téléchargent **en entier** — un département
    // à la fois — même si l'on n'en garde qu'un quartier. C'est du transfert
    // réel, il n'a rien à faire dans une estimation muette.
    const addr = addresses && detail !== "map" && addrCount ? addressBytes(addrCount) : 0;
    return { bytes: vector + raster + dem + places + addr, vector, raster, dem, addr };
  }, [selection, satellite, satZoom, relief, reliefZoom, detail, density, addresses, addrCount, vectorZoom]);

  const heavy = estimate.bytes > CONFIG.OFFLINE.CONFIRM_ABOVE_BYTES;

  const reallyLaunch = () => {
    if (!bbox) return;
    setConfirmHeavy(false);
    setSpaceShort(null);
    start({
      name: name.trim() || t("download.unnamed"),
      bbox,
      area: selection?.area,
      detail,
      vectorMaxZoom: vectorZoom,
      satelliteMaxZoom: satellite ? satZoom : null,
      reliefMaxZoom: relief ? reliefZoom : null,
      addresses: addresses && detail !== "map" && !!addrCount,
      addressDepts: [],
    });
    setName("");
    setSelection(null);
  };

  const launch = async () => {
    if (!bbox) return;
    // La place d'abord : prévenir avant vaut mieux qu'une zone arrêtée à
    // mi-chemin faute de place.
    const free = await freeBytes();
    if (free !== null && estimate.bytes > free) return setSpaceShort({ free });
    if (heavy) return setConfirmHeavy(true);
    reallyLaunch();
  };

  /** « Télécharger quand même » malgré la place : reste la confirmation du poids. */
  const launchDespiteSpace = () => {
    setSpaceShort(null);
    if (heavy) return setConfirmHeavy(true);
    reallyLaunch();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="settings-dialog download-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="download-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-head">
          <h2 className="settings-title" id="download-title">
            {t("download.title")}
          </h2>
          <button className="settings-close" onClick={onClose} aria-label={t("sheet.close")}>
            <X size={18} />
          </button>
        </div>

        <div className="download-body">
          <section className="download-section">
            <span className="settings-field-label">{t("download.pickArea")}</span>
            <div className="download-map-surface">
              <div className="download-map" ref={mapNode} />
            </div>
            {(selection || lookup !== "idle") && (
              <p className="download-pick-status">
                {lookup === "searching"
                  ? t("download.searching")
                  : lookup === "none"
                    ? t("download.nothingHere")
                    : lookup === "failed"
                      ? t("download.lookupFailed")
                      : selection &&
                        t("download.selected", {
                          kind: t(`download.kind.${selection.level}` as TranslationKey),
                          name: selection.name,
                        })}
              </p>
            )}
            <p className="settings-hint">{t(`download.tap.${pickLevel}` as TranslationKey)}</p>
            {regions.length > 0 && <p className="settings-hint">{t("download.legendDownloaded")}</p>}
          </section>

          <section className="download-section">
            <span className="settings-field-label">{t("download.level")}</span>
            <div className="download-tiers" role="radiogroup" aria-label={t("download.level")}>
              {DETAILS.map((tier) => (
                <button
                  key={tier.id}
                  className={`download-tier ${detail === tier.id ? "is-active" : ""}`}
                  role="radio"
                  aria-checked={detail === tier.id}
                  onClick={() => setDetail(tier.id)}
                >
                  <strong>{t(tier.label)}</strong>
                  <span>{t(tier.hint)}</span>
                </button>
              ))}
            </div>

            {detail !== "map" && (
              <>
                <label className="download-check">
                  <input
                    type="checkbox"
                    checked={addresses}
                    onChange={(e) => setAddresses(e.target.checked)}
                  />
                  {t("download.addresses")}
                </label>
                {addresses && (
                  <span className="settings-hint">
                    {addrCount === null
                      ? t("download.addressCounting")
                      : addrCount === 0
                        ? t("download.addressNone")
                        : t("download.addressCount", {
                            count: addrCount.toLocaleString(locale),
                            size: formatBytes(estimate.addr),
                          })}
                  </span>
                )}
              </>
            )}

            <label className="download-check">
              <input type="checkbox" checked={satellite} onChange={(e) => setSatellite(e.target.checked)} />
              {t("download.satellite")}
            </label>
            {satellite && (
              <div className="download-zoom">
                <label htmlFor="sat-zoom">{t("download.maxZoom", { zoom: satZoom })}</label>
                <input
                  id="sat-zoom"
                  type="range"
                  min={CONFIG.OFFLINE.SATELLITE_ZOOM_MIN}
                  max={CONFIG.OFFLINE.SATELLITE_ZOOM_MAX}
                  value={satZoom}
                  onChange={(e) => setSatZoom(Number(e.target.value))}
                />
                <span className="settings-hint">{t("download.satelliteOnly", { size: formatBytes(estimate.raster) })}</span>
              </div>
            )}

            <label className="download-check">
              <input type="checkbox" checked={relief} onChange={(e) => setRelief(e.target.checked)} />
              {t("download.relief")}
            </label>
            {relief && (
              <div className="download-zoom">
                <label htmlFor="relief-zoom">{t("download.maxZoom", { zoom: reliefZoom })}</label>
                <input
                  id="relief-zoom"
                  type="range"
                  min={CONFIG.OFFLINE.RELIEF_ZOOM_MIN}
                  max={CONFIG.OFFLINE.RELIEF_ZOOM_MAX}
                  value={reliefZoom}
                  onChange={(e) => setReliefZoom(Number(e.target.value))}
                />
                <span className="settings-hint">
                  {t("download.reliefOnly", { size: formatBytes(estimate.dem) })}
                  {intersectsIgn(bbox ?? [0, 0, 0, 0])
                    ? t("download.reliefContours")
                    : t("download.reliefNoContours")}
                </span>
              </div>
            )}
          </section>

          <section className="download-section">
            <input
              className="download-name"
              placeholder={t("download.namePlaceholder")}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <div className={`download-estimate ${heavy ? "is-heavy" : ""}`}>
              <HardDrive size={16} />
              <span>
                {density === null ? t("download.roughly") : t("download.about")}
                {formatBytes(estimate.bytes)}
              </span>
              {storage && (
                <span className="download-quota">
                  {t("download.quota", { used: formatBytes(storage.usage), total: formatBytes(storage.quota) })}
                </span>
              )}
            </div>
            {spaceShort ? (
              <div className="download-confirm" role="alertdialog" aria-label={t("download.confirmHeavyAria")}>
                <p className="download-confirm-text">
                  {t("download.spaceShort", { free: formatBytes(spaceShort.free), size: formatBytes(estimate.bytes) })}
                </p>
                <div className="download-confirm-actions">
                  <button className="download-confirm-cancel" onClick={() => setSpaceShort(null)}>
                    {t("download.cancel")}
                  </button>
                  <button className="download-confirm-go" onClick={launchDespiteSpace}>
                    {t("download.anyway")}
                  </button>
                </div>
              </div>
            ) : confirmHeavy ? (
              <div className="download-confirm" role="alertdialog" aria-label={t("download.confirmHeavyAria")}>
                <p className="download-confirm-text">
                  {t("download.confirmHeavy", { size: formatBytes(estimate.bytes) })}
                </p>
                <div className="download-confirm-actions">
                  <button className="download-confirm-cancel" onClick={() => setConfirmHeavy(false)}>
                    {t("download.cancel")}
                  </button>
                  <button className="download-confirm-go" onClick={reallyLaunch}>
                    {t("download.anyway")}
                  </button>
                </div>
              </div>
            ) : (
              <button className="download-launch" onClick={launch} disabled={!bbox}>
                <Download size={17} />
                {t("download.launch")}
              </button>
            )}
          </section>

          <section className="download-section">
            <span className="settings-field-label">{t("download.behaviour")}</span>

            <label className="download-check">
              <input
                type="checkbox"
                checked={prefs.wifiOnly}
                onChange={(e) => setPrefs({ wifiOnly: e.target.checked })}
              />
              {t("download.wifiOnly")}
            </label>
            {/* Dire ce que le navigateur sait réellement plutôt que de laisser
                croire à une garantie : seul Chrome sur Android distingue le
                wifi de la 4G. Ailleurs, l'option ne peut rien bloquer. */}
            <span className="settings-hint">
              {canDetectConnection()
                ? t("download.connection", { connection: describeConnection() })
                : t("download.connectionUnknown")}
            </span>

            <label className="download-check">
              <input
                type="checkbox"
                checked={prefs.pauseOffline}
                onChange={(e) => setPrefs({ pauseOffline: e.target.checked })}
              />
              {t("download.pauseOffline")}
            </label>

            <span className="settings-hint">{t("download.storedIn")}</span>
          </section>

          <section className="download-section">
            <div className="download-list-head">
              <span className="settings-field-label">{t("download.regions")}</span>
              <button className="download-check-button" onClick={() => void check()} disabled={checking}>
                {checking ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}
                {t("download.checkUpdates")}
              </button>
            </div>

            {/* La vérification est automatique chaque semaine (`useFreshness`) :
                plus de fréquence à choisir, seulement la date de la dernière. */}
            {regions.length > 0 && (
              <p className="settings-hint">
                {lastChecked > 0
                  ? t("download.lastChecked", {
                      date: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
                        lastChecked
                      ),
                    })
                  : t("download.neverChecked")}
              </p>
            )}

            {freshness && (
              <p className="settings-hint">
                {freshness.latest === null
                  ? t("download.checkOffline")
                  : freshness.stale.length === 0
                    ? t("download.upToDate")
                    : tp("download.stale", freshness.stale.length)}
              </p>
            )}

            {regions.length === 0 && <p className="settings-hint">{t("download.noRegions")}</p>}

            <ul className="download-list">
              {regions.map((region) => {
                const p = progress[region.id];
                const stale = freshness?.stale.some((s) => s.id === region.id);
                if (confirmDelete === region.id) {
                  return (
                    <li key={region.id} className="download-item">
                      <div
                        className="download-confirm"
                        role="alertdialog"
                        aria-label={t("download.confirmDeleteAria")}
                      >
                        <p className="download-confirm-text">
                          {t("download.confirmDelete", {
                            region: region.name,
                            size: formatBytes(region.bytes),
                          })}
                        </p>
                        <div className="download-confirm-actions">
                          <button
                            className="download-confirm-cancel"
                            onClick={() => setConfirmDelete(null)}
                          >
                            {t("download.cancel")}
                          </button>
                          <button
                            className="download-confirm-go"
                            onClick={() => {
                              setConfirmDelete(null);
                              void remove(region.id);
                            }}
                          >
                            {t("download.delete")}
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                }
                return (
                  <li key={region.id} className="download-item">
                    <div className="download-item-main">
                      <strong>{region.name}</strong>
                      <span className="download-item-meta">
                        {formatBytes(region.bytes)}
                        {region.placesCount > 0 && ` · ${tp("download.places", region.placesCount)}`}
                        {region.satelliteMaxZoom !== null && ` · ${t("download.metaSatellite")}`}
                        {region.reliefMaxZoom !== null && ` · ${t("download.metaRelief")}`}
                        {stale && ` · ${t("download.metaStale")}`}
                      </span>
                      {!p && region.failure && region.status !== "ready" && (
                        <span className="download-item-failure">{t(FAILURE_TEXT[region.failure])}</span>
                      )}
                      {p && (
                        <span className="download-item-progress">
                          <progress value={p.done} max={Math.max(1, p.total)} />
                          {p.label} — {p.done}/{p.total}
                        </span>
                      )}
                      {!p && region.status === "ready" && !stale && (
                        <span className="download-item-ready">
                          <Check size={14} /> {t("download.ready")}
                        </span>
                      )}
                      {!p && region.status === "ready" && stale && (
                        <button className="download-resume" onClick={() => update(region)}>
                          <RefreshCw size={13} /> {t("download.update")}
                        </button>
                      )}
                      {/* `downloading` sans avancement à l'écran : le
                          téléchargement a été tué en cours de route et rien ne
                          tourne. La réconciliation du démarrage
                          (`interruptedRegions`) repasse ces zones en pause ;
                          ce test est le filet pour un arrêt survenu pendant la
                          session, qu'elle n'a pas vu passer. */}
                      {!p && (region.status === "paused" || region.status === "error" || region.status === "downloading") && (
                        <button className="download-resume" onClick={() => resume(region)}>
                          {region.failure === "moved" ? t("download.redownload") : t("download.resume")}
                        </button>
                      )}
                    </div>
                    <button
                      className="download-delete"
                      onClick={() => (p ? cancel(region.id) : setConfirmDelete(region.id))}
                      aria-label={p ? t("download.stop") : t("download.delete")}
                    >
                      {p ? <X size={16} /> : <Trash2 size={16} />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
