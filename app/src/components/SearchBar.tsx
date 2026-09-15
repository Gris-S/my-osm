import { useEffect, useMemo, useState } from "react";
import { Search, X, MapPin, Store, Clock, Home, Briefcase, Globe, Crosshair } from "lucide-react";
import type { Place } from "../types";
import { usePlaceSearch } from "../hooks/usePlaceSearch";
import { matchHistory, useSearchHistory, type SearchHistoryEntry } from "../hooks/useSearchHistory";
import { HOME_WORK_ROLES, type HomeWork, type HomeWorkRole } from "../hooks/useHomeWork";
import { suggestBrands } from "../services/tilePois";
import { matchesBrand, normalizeBrand } from "../services/geocode";
import { useI18n } from "../i18n";
import { useBackClose } from "../hooks/useBackClose";
import { openWebSearch } from "../services/webSearch";
import { pointFromText } from "../services/webPlace";

/**
 * Les mots qui désignent chaque rôle, en plus de son libellé affiché. On tape
 * « maison » autant que « domicile », « boulot » autant que « travail » ; les
 * mots anglais valent quelle que soit la langue de l'interface.
 */
const ROLE_WORDS: Record<HomeWorkRole, string[]> = {
  home: ["domicile", "maison", "chez moi", "home"],
  work: ["travail", "boulot", "bureau", "work", "office"],
};

interface SearchBarProps {
  onSelectPlace: (place: Place) => void;
  /**
   * Domicile et travail (demande explicite) : en tête de la liste dès qu'on
   * l'ouvre, et reconnus dès les premières lettres — « t », « tr », « tra ».
   */
  homeWork: HomeWork;
  /** Lance l'itinéraire depuis la position actuelle jusqu'à ce lieu. */
  onRouteTo: (place: Place) => void;
  /** Demande d'afficher tous les lieux d'une enseigne sur la carte. */
  onSearchBrand: (brand: string) => void;
  /**
   * Rendu sous la barre, après les résultats : le bandeau d'enseigne s'y range
   * plutôt que de flotter par-dessus la liste des suggestions.
   */
  children?: React.ReactNode;
  /**
   * Signale que la barre est ouverte : champ au premier plan, suggestions
   * affichées, clavier déployé.
   *
   * `App` s'en sert pour **effacer la colonne de boutons flottants** le temps
   * de la recherche. Le clavier ampute l'écran de moitié, et ces boutons, qui
   * se rangent au-dessus de la fiche d'un lieu, se retrouvaient empilés sur la
   * barre d'état (constaté sur appareil). Pendant qu'on tape une adresse, on
   * ne règle de toute façon ni les calques ni les catégories.
   */
  onOpenChange?: (open: boolean) => void;
  /**
   * La barre vient d'être vidée — par sa croix, ou en effaçant le texte au
   * clavier. `App` y quitte la recherche d'enseigne : c'est la seule façon de
   * la fermer (le bandeau n'a plus de croix), et une barre vide sous laquelle
   * resterait « Rechercher dans cette zone » ne dirait plus ce qu'on cherche.
   */
  onClear?: () => void;
}

export function SearchBar({ onSelectPlace, homeWork, onRouteTo, onSearchBrand, children, onOpenChange, onClear }: SearchBarProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  // Un effet plutôt qu'un appel dans chaque `setOpen` : il y en a plusieurs, et
  // en oublier un laisserait les boutons cachés pour de bon. Le nettoyage
  // annonce la fermeture au démontage, pour la même raison : la barre s'efface
  // dès qu'un itinéraire s'ouvre, et elle partirait sinon en laissant
  // l'application croire qu'on cherche encore.
  useEffect(() => {
    onOpenChange?.(open);
    return () => onOpenChange?.(false);
  }, [open, onOpenChange]);
  const { results, loading } = usePlaceSearch(query);
  const { history, remember } = useSearchHistory();
  /**
   * Le rôle qu'on est en train de définir. Comme dans les champs d'itinéraire,
   * un rôle vide **arme la barre** : le lieu suivant qu'on choisit devient cette
   * adresse, au lieu d'ouvrir sa fiche.
   */
  const [assigning, setAssigning] = useState<HomeWorkRole | null>(null);
  // Le geste retour referme la liste et rend la main à la carte ; le champ
  // perd le focus, pour qu'un nouvel appui le rouvre. Une recherche d'enseigne
  // affichée sous la barre se quitte ensuite comme un champ vidé.
  useBackClose(open, () => {
    setOpen(false);
    setAssigning(null);
    (document.activeElement as HTMLElement | null)?.blur();
  });
  useBackClose(!open && Boolean(children), () => {
    setQuery("");
    onClear?.();
  });

  /**
   * Recherches récentes proposées : les deux dernières champ vide, une seule
   * dès qu'on tape (voir `matchHistory`). Elles sont en tête de la liste — au
   * premier clic, elles en sont même tout le contenu.
   */
  const recent = useMemo(() => matchHistory(history, query), [history, query]);

  // Une enseigne se cherche sur toute la carte, pas comme une adresse : les
  // propositions arrivent en tête, avant les résultats de géocodage.
  const trimmed = query.trim();

  /**
   * Domicile et travail à proposer : les deux, champ vide ; dès qu'on tape,
   * ceux dont le libellé ou un mot qui les désigne **commence** par la saisie,
   * accents et casse ignorés. Rien pendant qu'on en définit un.
   */
  const home = homeWork.home;
  const work = homeWork.work;
  const shortcuts = useMemo(() => {
    if (assigning) return [];
    const wanted = normalizeBrand(trimmed);
    return HOME_WORK_ROLES.map((role) => ({
      role,
      place: role === "home" ? home : work,
      label: t(role === "home" ? "itinerary.home" : "itinerary.work"),
    })).filter(
      ({ role, label }) =>
        !wanted || [label, ...ROLE_WORDS[role]].some((word) => normalizeBrand(word).startsWith(wanted))
    );
  }, [assigning, trimmed, home, work, t]);

  /**
   * Enseignes reconnues pour la saisie en cours.
   *
   * La proposition « afficher tous les… » ne vaut que pour une enseigne : sur
   * « rue du Bac », elle n'aurait aucun sens. Deux indices la déclenchent, tous
   * deux tirés des données plutôt que d'une liste tenue à la main : un nom qui
   * revient **plusieurs fois** parmi les lieux déjà croisés sur la carte, ou
   * plusieurs résultats de recherche portant le même nom et désignant des
   * commerces — une rue, elle, n'appartient à aucune catégorie et ne compte
   * donc pas. Les raccourcis d'usage (« macdo », « bk ») s'y ajoutent.
   */
  const suggestions = useMemo(() => {
    if (trimmed.length < 2) return [];
    const wanted = normalizeBrand(trimmed);

    const repeated = new Map<string, number>();
    for (const place of results) {
      if (!place.group) continue; // rue, adresse, lieu-dit : pas une enseigne
      if (!matchesBrand(place.name, wanted) && !normalizeBrand(place.name).startsWith(wanted)) continue;
      repeated.set(place.name, (repeated.get(place.name) ?? 0) + 1);
    }
    const fromResults = [...repeated].filter(([, count]) => count >= 2).map(([name]) => name);

    return [...new Set([...suggestBrands(trimmed), ...fromResults])].slice(0, 3);
  }, [trimmed, results]);

  /**
   * Des coordonnées ou un lien de carte collés (Google Maps, Plans, OSM, Waze…)
   * se lisent sur place : la position est dans le texte, et rien n'est demandé
   * à personne — surtout pas à Google (voir `services/webPlace.ts`).
   */
  const pasted = useMemo((): Place | null => {
    const at = pointFromText(trimmed);
    if (!at) return null;
    return {
      id: `web/${at.lat.toFixed(5)},${at.lon.toFixed(5)}`,
      name: at.label ?? t("search.pastedPoint"),
      group: null,
      lat: at.lat,
      lon: at.lon,
    };
  }, [trimmed, t]);

  function handleBrand(brand: string) {
    onSearchBrand(brand);
    remember({ kind: "brand", label: brand });
    setQuery(brand);
    setOpen(false);
  }

  /**
   * Un raccourci défini **part** : l'itinéraire s'ouvre depuis la position, comme
   * dans les applications de navigation. Un raccourci vide arme la barre.
   */
  function handleShortcut(role: HomeWorkRole, place: Place | null) {
    if (!place) {
      setAssigning(role);
      setQuery("");
      setOpen(true);
      return;
    }
    onRouteTo(place);
    setQuery("");
    setOpen(false);
  }

  function handleSelect(place: Place) {
    if (assigning) {
      homeWork.set(assigning, place);
      setAssigning(null);
      setQuery("");
      // La liste reste ouverte : l'adresse s'y lit aussitôt sous son rôle,
      // prête à servir.
      setOpen(true);
      return;
    }
    onSelectPlace(place);
    remember({ kind: "place", label: place.name, place });
    setQuery(place.name);
    setOpen(false);
  }

  /**
   * Ce que la carte ne connaît pas se cherche sur le web, dans l'application
   * (voir `services/webSearch.ts`). Le lieu retrouvé revient par `handleSelect`,
   * comme n'importe quel résultat : fiche, historique, ou réponse à « Maison ».
   */
  function handleWeb() {
    (document.activeElement as HTMLElement | null)?.blur();
    setOpen(false);
    openWebSearch(trimmed, handleSelect);
  }

  /**
   * Une recherche récente se **rouvre**, elle ne se retape pas : l'entrée porte
   * le lieu retenu, donc le clic ouvre directement sa fiche — aucun appel au
   * géocodage, aucune liste à reparcourir. Une enseigne, elle, n'a pas de lieu
   * unique : elle repose ses pastilles sur la zone visible.
   */
  function handleRecent(entry: SearchHistoryEntry) {
    if (entry.kind === "brand") {
      handleBrand(entry.label);
      return;
    }
    handleSelect(entry.place);
  }

  return (
    <div className="search-wrap">
      <div className="search-pill">
        <Search size={18} className="search-icon" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            if (e.target.value === "") onClear?.();
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => e.key === "Escape" && assigning && setAssigning(null)}
          placeholder={assigning ? t("itinerary.rolePlaceholder") : t("search.placeholder")}
          className="search-input"
        />
        {query && (
          <button
            className="search-clear"
            onClick={() => {
              setQuery("");
              setAssigning(null);
              onClear?.();
            }}
            aria-label={t("search.clear")}
          >
            <X size={16} />
          </button>
        )}
      </div>

      {open &&
        (loading ||
          trimmed.length >= 2 ||
          results.length > 0 ||
          suggestions.length > 0 ||
          recent.length > 0 ||
          shortcuts.length > 0 ||
          assigning !== null) && (
        <div className="search-results">
          {assigning && (
            <div className="search-result-loading search-assigning">
              {t(assigning === "home" ? "itinerary.home" : "itinerary.work")} · {t("itinerary.roleAssigning")}
            </div>
          )}
          {shortcuts.map(({ role, place, label }) => {
            const Icon = role === "home" ? Home : Briefcase;
            return (
              <button
                key={role}
                className={`search-result is-shortcut ${place ? "" : "is-unset"}`}
                onClick={() => handleShortcut(role, place)}
              >
                <Icon size={16} className="search-result-icon" />
                {/* Le nom seul (demande explicite) : l'adresse se règle dans les
                    paramètres, et n'apprend rien de plus à qui veut rentrer. */}
                <div className="search-result-text">
                  <div className="search-result-name">{label}</div>
                </div>
              </button>
            );
          })}
          {recent.map((entry) => (
            <button
              key={`${entry.kind}:${entry.label}`}
              className="search-result is-recent"
              onClick={() => handleRecent(entry)}
            >
              <Clock size={16} className="search-result-icon" />
              <div className="search-result-text">
                <div className="search-result-name">{entry.label}</div>
                {entry.kind === "brand" && <div className="search-result-address">{t("search.recentBrand")}</div>}
              </div>
            </button>
          ))}
          {!assigning && suggestions.map((brand) => (
            <button key={brand} className="search-result is-brand" onClick={() => handleBrand(brand)}>
              <Store size={16} className="search-result-icon" />
              <div className="search-result-text">
                <div className="search-result-name">{t("search.brandAll", { brand })}</div>
                <div className="search-result-address">{t("search.brandHint")}</div>
              </div>
            </button>
          ))}
          {pasted && (
            <button className="search-result is-brand" onClick={() => handleSelect(pasted)}>
              <Crosshair size={16} className="search-result-icon" />
              <div className="search-result-text">
                <div className="search-result-name">{pasted.name}</div>
                <div className="search-result-address">{t("search.pastedPointHint")}</div>
              </div>
            </button>
          )}
          {loading && <div className="search-result-loading">{t("search.loading")}</div>}
          {!loading &&
            results.map((r) => (
              <button key={r.id} className="search-result" onClick={() => handleSelect(r)}>
                <MapPin size={16} className="search-result-icon" />
                <div className="search-result-text">
                  <div className="search-result-name">{r.name}</div>
                  {r.address && <div className="search-result-address">{r.address}</div>}
                </div>
              </button>
            ))}
          {/* En dernier, dès deux lettres : on y va quand la carte n'a pas
              trouvé, et sans avoir à attendre la fin de sa recherche. */}
          {trimmed.length >= 2 && (
            <button className="search-result is-web" onClick={handleWeb}>
              <Globe size={16} className="search-result-icon" />
              <div className="search-result-text">
                <div className="search-result-name">{t("search.web", { query: trimmed })}</div>
                <div className="search-result-address">{t("search.webHint")}</div>
              </div>
            </button>
          )}
        </div>
      )}

      {children}
    </div>
  );
}
