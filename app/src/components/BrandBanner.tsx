import { LoaderCircle, RotateCw, Store } from "lucide-react";
import { useI18n } from "../i18n";

// ---------------------------------------------------------------------------
// Bandeau d'une recherche d'enseigne : ce qui est cherché, combien de lieux
// sont affichés, et la proposition de rechercher ailleurs quand la carte a
// bougé.
//
// Le déplacement ne relance rien de lui-même : sur une carte, refaire une
// recherche à chaque geste donne une liste qui saute sans qu'on l'ait demandé.
//
// **Pas de croix** : on quitte la recherche d'enseigne en effaçant la barre de
// recherche (`SearchBar`, `onClear`), comme n'importe quelle recherche. Et
// pendant le chargement comme après un échec, le nom de l'enseigne s'efface :
// « recherche… » ou « échec de la recherche » suffisent, et tiennent à l'écran.
// ---------------------------------------------------------------------------

interface BrandBannerProps {
  brand: string;
  count: number;
  /** Faux si la zone en cachait davantage que ce qui a pu être ramené. */
  complete: boolean;
  loading: boolean;
  /** Vrai si la recherche n'a pas abouti : à distinguer d'une absence de lieux. */
  failed: boolean;
  /** Vrai si la carte a bougé depuis la dernière recherche. */
  stale: boolean;
  onSearchHere: () => void;
}

export function BrandBanner({ brand, count, complete, loading, failed, stale, onSearchHere }: BrandBannerProps) {
  const { t, tp } = useI18n();

  return (
    <div className="brand-banner">
      <div className="brand-pill">
        {loading ? (
          <LoaderCircle size={16} className="brand-icon map-status-spinner" />
        ) : (
          <Store size={16} className="brand-icon" />
        )}
        {/* Pendant la recherche, le nom s'efface : « recherche… » et la toupie
            suffisent, et le tout tient sur un écran de téléphone. */}
        {!loading && !failed && <span className="brand-name">{brand}</span>}
        <span className="brand-count">
          {loading
            ? t("brand.loading")
            : failed
              ? t("brand.failed")
              : count === 0
                ? t("brand.none")
                : tp(complete ? "brand.count" : "brand.countAtLeast", count)}
        </span>
      </div>

      {stale && (
        <button className="brand-search-here" onClick={onSearchHere}>
          <RotateCw size={14} />
          {t("brand.searchHere")}
        </button>
      )}
    </div>
  );
}
