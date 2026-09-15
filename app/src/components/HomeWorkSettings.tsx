import { Fragment, useState } from "react";
import { Briefcase, Home } from "lucide-react";
import { HOME_WORK_ROLES, useHomeWork, type HomeWorkRole } from "../hooks/useHomeWork";
import { usePlaceSearch } from "../hooks/usePlaceSearch";
import { useI18n } from "../i18n";
import type { Place } from "../types";
import { useBackClose } from "../hooks/useBackClose";

// ---------------------------------------------------------------------------
// « Maison et travail », dans la fenêtre des paramètres.
//
// La barre de recherche ne montre plus que les deux noms (demande explicite) :
// c'est donc ici qu'on voit l'adresse retenue, et qu'on la change ou la retire.
// « Modifier » déplie la recherche sur place — choisir une adresse ne doit pas
// obliger à quitter la fenêtre. Les deux adresses vivent dans un magasin partagé
// (`hooks/useHomeWork.ts`) : la recherche et l'itinéraire voient le changement
// aussitôt.
// ---------------------------------------------------------------------------

export function HomeWorkSettings() {
  const { t } = useI18n();
  const homeWork = useHomeWork();
  const [editing, setEditing] = useState<HomeWorkRole | null>(null);

  return (
    <div className="settings-field">
      <span className="settings-field-label">{t("settings.homeWork")}</span>
      {HOME_WORK_ROLES.map((role) => {
        const place = homeWork[role];
        const Icon = role === "home" ? Home : Briefcase;
        return (
          <Fragment key={role}>
            <div className="homework-row">
              <Icon size={17} className="homework-icon" />
              <div className="homework-text">
                <span className="homework-name">{t(role === "home" ? "itinerary.home" : "itinerary.work")}</span>
                <span className="homework-address">
                  {place ? (place.address ?? place.name) : t("settings.homeWork.unset")}
                </span>
              </div>
              {editing !== role && (
                <div className="homework-actions">
                  <button onClick={() => setEditing(role)}>
                    {t(place ? "settings.homeWork.change" : "settings.homeWork.set")}
                  </button>
                  {place && <button onClick={() => homeWork.clear(role)}>{t("settings.homeWork.clear")}</button>}
                </div>
              )}
            </div>
            {editing === role && (
              <AddressPicker
                onPick={(picked) => {
                  homeWork.set(role, picked);
                  setEditing(null);
                }}
                onCancel={() => setEditing(null)}
              />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

/** Le champ de recherche d'une adresse, et ses résultats à toucher. */
function AddressPicker({ onPick, onCancel }: { onPick: (place: Place) => void; onCancel: () => void }) {
  const { t } = useI18n();
  // Le geste retour annule la saisie, sans refermer les paramètres.
  useBackClose(true, onCancel);
  const [query, setQuery] = useState("");
  const { results, loading } = usePlaceSearch(query);
  const typed = query.trim().length >= 3;

  return (
    <div className="homework-editor">
      <input
        autoFocus
        className="homework-input"
        value={query}
        placeholder={t("settings.homeWork.search")}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          // Échap annule la saisie, sans refermer toute la fenêtre des paramètres.
          event.stopPropagation();
          onCancel();
        }}
      />
      <div className="homework-results">
        {loading && <span className="settings-hint">{t("search.loading")}</span>}
        {!loading && typed && results.length === 0 && (
          <span className="settings-hint">{t("settings.homeWork.empty")}</span>
        )}
        {!loading &&
          results.map((result) => (
            <button key={result.id} className="homework-result" onClick={() => onPick(result)}>
              <span className="homework-name">{result.name}</span>
              {result.address && <span className="homework-address">{result.address}</span>}
            </button>
          ))}
      </div>
      <div className="homework-actions">
        <button onClick={onCancel}>{t("settings.homeWork.cancel")}</button>
      </div>
    </div>
  );
}
