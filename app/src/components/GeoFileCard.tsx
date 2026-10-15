import { Bike, Check, Footprints, FolderPlus, Route, X } from "lucide-react";
import type { NavMode } from "../navigation/route";
import { useI18n } from "../i18n";
import { useBackClose } from "../hooks/useBackClose";
import { formatDistance } from "../utils/format";
import { tracksLength, type GeoFile } from "../services/geoFile";

// ---------------------------------------------------------------------------
// Le fichier ouvert (GPX, KML, GeoJSON) : son nom, ce qu'il contient, et ce
// qu'on peut en faire. Sa trace est sur la carte, ses points aussi — un point
// touché ouvre sa fiche, comme un signet. « Enregistrer les points » en fait un
// dossier de signets, qui survit à la fermeture du fichier.
// ---------------------------------------------------------------------------

export function GeoFileCard({
  file,
  error,
  savedIn,
  onSave,
  onFollow,
  onClose,
}: {
  file: GeoFile | null;
  /** Le nom d'un fichier qui ne s'est pas lu. */
  error: string | null;
  /** Le dossier où les points ont été rangés, une fois enregistrés. */
  savedIn: string | null;
  onSave: () => void;
  /** « Suivre la trace », à pied ou à vélo : absent quand le fichier n'a pas de trace. */
  onFollow?: (mode: NavMode) => void;
  onClose: () => void;
}) {
  const { t, tp } = useI18n();
  useBackClose(true, onClose);
  const length = file ? tracksLength(file.tracks) : 0;
  return (
    <div className="geofile-card" role="status">
      <Route size={20} className="geofile-icon" />
      <div className="geofile-text">
        {file ? (
          <>
            <strong>{file.name}</strong>
            <span>
              {[length > 0 ? formatDistance(length) : "", file.points.length ? tp("geofile.points", file.points.length) : ""]
                .filter(Boolean)
                .join(" · ")}
            </span>
            {savedIn && (
              <span className="geofile-saved">
                <Check size={13} /> {t("geofile.saved", { name: savedIn })}
              </span>
            )}
          </>
        ) : (
          <span>{t("geofile.unreadable", { name: error ?? "" })}</span>
        )}
      </div>
      {onFollow && (
        <>
          <button className="geofile-follow" onClick={() => onFollow("walking")} aria-label={t("geofile.followWalking")} title={t("geofile.followWalking")}>
            <Footprints size={18} />
          </button>
          <button className="geofile-follow" onClick={() => onFollow("cycling")} aria-label={t("geofile.followCycling")} title={t("geofile.followCycling")}>
            <Bike size={18} />
          </button>
        </>
      )}
      {file && (file.points.length > 0 || file.tracks.length > 0) && !savedIn && (
        <button className="geofile-save" onClick={onSave} aria-label={t("geofile.save")} title={t("geofile.save")}>
          <FolderPlus size={18} />
        </button>
      )}
      <button className="geofile-close" onClick={onClose} aria-label={t("geofile.close")}>
        <X size={18} />
      </button>
    </div>
  );
}
