import { useEffect, useRef } from "react";
import { Box, Camera, Layers, Map as MapIcon, Mountain, Satellite, TrafficCone } from "lucide-react";
import { hasMapillaryToken } from "../hooks/useMapillary";
import type { Basemap } from "../hooks/useBasemap";
import { useI18n, type TranslationKey } from "../i18n";
import { useBackClose } from "../hooks/useBackClose";

interface MapOptionsMenuProps {
  /**
   * L'ouverture est tenue par `App` : le panneau se déploie sur le bouton des
   * catégories, qui a besoin de savoir qu'il est recouvert.
   */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  basemap: Basemap;
  onBasemapChange: (basemap: Basemap) => void;
  is3D: boolean;
  onToggle3D: () => void;
  /** Ombrage du terrain. */
  relief: boolean;
  onToggleRelief: () => void;
  /** Calque « Trafic » : bouchons, accidents et chantiers du réseau national. */
  traffic: boolean;
  onToggleTraffic: () => void;
  /** Couverture des photos de rue Mapillary. */
  mapillary: boolean;
  onToggleMapillary: () => void;
  offsetBottom: number;
}

const BASEMAPS: { id: Basemap; label: TranslationKey; icon: typeof MapIcon }[] = [
  { id: "standard", label: "layers.plan", icon: MapIcon },
  { id: "satellite", label: "layers.satellite", icon: Satellite },
];

/**
 * Menu d'affichage de la carte (bouton « calques », en bas à droite) :
 * choix du fond de carte — plan ou satellite — et bascule de la vue 3D.
 *
 * Les deux réglages vivent dans le même panneau parce qu'ils décrivent la même
 * chose : la façon dont la carte est rendue. Ils restent en revanche
 * indépendants (la 3D s'applique aussi bien au plan qu'à l'imagerie).
 */
export function MapOptionsMenu({
  open,
  onOpenChange,
  basemap,
  onBasemapChange,
  is3D,
  onToggle3D,
  relief,
  onToggleRelief,
  traffic,
  onToggleTraffic,
  mapillary,
  onToggleMapillary,
  offsetBottom,
}: MapOptionsMenuProps) {
  const { t } = useI18n();
  const wrapRef = useRef<HTMLDivElement>(null);

  // La phrase entoure un `<code>` : plutôt que de la couper en deux clés — ce
  // qui interdirait au traducteur de déplacer le nom de fichier dans sa
  // phrase — on lit le modèle sans variable et on coupe sur `{file}`.
  const noteAround = t("layers.streetPhotosNote").split("{file}");

  useBackClose(open, () => onOpenChange(false));

  // Fermeture au clic à l'extérieur et à la touche Échap (même comportement
  // que le menu de filtres).
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) onOpenChange(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onOpenChange]);

  return (
    <div className="map-options" ref={wrapRef} style={{ bottom: offsetBottom }}>
      {open && (
        <div className="map-options-panel" role="group" aria-label={t("layers.aria")}>
          <div className="map-options-title">{t("layers.type")}</div>

          <div className="map-options-choices">
            {BASEMAPS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                className={`map-options-choice ${basemap === id ? "is-active" : ""}`}
                onClick={() => onBasemapChange(id)}
                aria-pressed={basemap === id}
              >
                <span className={`map-options-thumb is-${id}`}>
                  <Icon size={20} />
                </span>
                <span className="map-options-choice-label">{t(label)}</span>
              </button>
            ))}
          </div>

          {/* Le relief est un calque et non un fond de carte : il s'ajoute
              aussi bien au plan qu'à l'imagerie, et se combine à la 3D — à
              plat il ombre le sol, incliné il le met en volume. */}
          <button
            className="map-options-row"
            onClick={onToggleRelief}
            role="switch"
            aria-checked={relief}
            title={t("layers.reliefTitle")}
          >
            <span className="map-options-row-label">
              <Mountain size={17} />
              {t("layers.relief")}
            </span>
            <span className={`toggle-switch ${relief ? "is-on" : ""}`} aria-hidden="true">
              <span className="toggle-switch-knob" />
            </span>
          </button>

          {/* Le trafic est un calque au même titre : il se pose sur le plan
              comme sur l'imagerie. Il montre les événements du réseau routier
              national — gratuits et sans clé — et, si une clé TomTom est
              renseignée, la couleur du débit sur les routes. */}
          <button
            className="map-options-row"
            onClick={onToggleTraffic}
            role="switch"
            aria-checked={traffic}
            title={t("layers.trafficTitle")}
          >
            <span className="map-options-row-label">
              <TrafficCone size={17} />
              {t("layers.traffic")}
            </span>
            <span className={`toggle-switch ${traffic ? "is-on" : ""}`} aria-hidden="true">
              <span className="toggle-switch-knob" />
            </span>
          </button>

          <button
            className="map-options-row"
            onClick={onToggle3D}
            role="switch"
            aria-checked={is3D}
            title={t("layers.3dTitle")}
          >
            <span className="map-options-row-label">
              <Box size={17} />
              {t("layers.3d")}
            </span>
            <span className={`toggle-switch ${is3D ? "is-on" : ""}`} aria-hidden="true">
              <span className="toggle-switch-knob" />
            </span>
          </button>

          {/* Photos de rue : la carte n'affiche que la couverture — les rues
              parcourues et les points de prise de vue — et la photo se demande
              au clic. Sans jeton, l'option reste visible et dit ce qui lui
              manque, plutôt que de disparaître sans explication. */}
          <button
            className="map-options-row"
            onClick={onToggleMapillary}
            role="switch"
            aria-checked={mapillary}
            disabled={!hasMapillaryToken()}
            title={hasMapillaryToken() ? t("layers.streetPhotosTitle") : t("layers.streetPhotosNoToken")}
          >
            <span className="map-options-row-label">
              <Camera size={17} />
              {t("layers.streetPhotos")}
            </span>
            <span className={`toggle-switch ${mapillary ? "is-on" : ""}`} aria-hidden="true">
              <span className="toggle-switch-knob" />
            </span>
          </button>

          {!hasMapillaryToken() && (
            <p className="map-options-note">{noteAround[0]}<code>.env.local</code>{noteAround[1]}</p>
          )}
        </div>
      )}

      <button
        className={`map-options-button ${open || basemap === "satellite" || is3D ? "is-active" : ""}`}
        onClick={() => onOpenChange(!open)}
        aria-label={t("layers.aria")}
        aria-expanded={open}
        title={t("layers.aria")}
      >
        <Layers size={20} />
        {/* Les photos de rue posent une couche verte sur la carte : la pastille
            le rappelle sans ouvrir le menu, à la couleur de cette couche. */}
        {mapillary && <span className="map-options-badge" aria-hidden="true" />}
      </button>
    </div>
  );
}
