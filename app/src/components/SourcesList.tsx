import { CONFIG } from "../config";
import { useI18n, type TranslationKey } from "../i18n";

// ---------------------------------------------------------------------------
// « Sources et licences » (menu principal).
//
// Ce que l'application affiche vient d'ailleurs, et le dire est une condition
// d'usage de plusieurs sources : OpenStreetMap (ODbL) et Transitous, qui exige
// un lien visible vers la liste de ses flux — chacun sous sa propre licence.
// Les crédits du fond de carte, eux, restent au bas du menu, où ils suivent les
// calques allumés.
// ---------------------------------------------------------------------------

interface SourceEntry {
  name: string;
  role: TranslationKey;
  url: string;
  licence?: TranslationKey;
}

const GROUPS: { title: TranslationKey; entries: SourceEntry[] }[] = [
  {
    title: "sources.group.map",
    entries: [
      { name: "OpenStreetMap", role: "sources.role.osm", url: CONFIG.ATTRIBUTION_LINKS.osm, licence: "sources.licence.odbl" },
      { name: "OpenFreeMap", role: "sources.role.openfreemap", url: CONFIG.ATTRIBUTION_LINKS.openfreemap },
    ],
  },
  {
    title: "sources.group.transport",
    entries: [
      { name: "Île-de-France Mobilités", role: "sources.role.idfm", url: CONFIG.ATTRIBUTION_LINKS.idfm },
      { name: "Transitous", role: "sources.role.transitous", url: CONFIG.TRANSITOUS_SOURCES_URL, licence: "sources.licence.transitous" },
    ],
  },
  {
    title: "sources.group.services",
    entries: [
      { name: "Photon", role: "sources.role.photon", url: CONFIG.ATTRIBUTION_LINKS.photon },
      { name: "Base Adresse Nationale", role: "sources.role.ban", url: CONFIG.ATTRIBUTION_LINKS.ban },
      { name: "OSRM (FOSSGIS)", role: "sources.role.osrm", url: CONFIG.ATTRIBUTION_LINKS.osrm },
      { name: "Open-Meteo", role: "sources.role.openmeteo", url: CONFIG.ATTRIBUTION_LINKS.openmeteo },
      { name: "Météo-France", role: "sources.role.meteofrance", url: CONFIG.ATTRIBUTION_LINKS.meteofrance },
      { name: "TomTom", role: "sources.role.tomtom", url: CONFIG.ATTRIBUTION_LINKS.tomtom },
      { name: "Bison Futé", role: "sources.role.bisonfute", url: CONFIG.ATTRIBUTION_LINKS.bisonfute },
      { name: "IGN", role: "sources.role.ign", url: CONFIG.ATTRIBUTION_LINKS.ign },
      { name: "Esri", role: "sources.role.esri", url: CONFIG.ATTRIBUTION_LINKS.esri },
      { name: "Mapillary", role: "sources.role.mapillary", url: CONFIG.ATTRIBUTION_LINKS.mapillary },
    ],
  },
];

export function SourcesList() {
  const { t } = useI18n();
  return (
    <div className="sources">
      <p className="sources-intro">{t("sources.intro")}</p>
      {GROUPS.map((group) => (
        <section key={group.title} className="sources-group">
          <h3>{t(group.title)}</h3>
          <ul className="sources-list">
            {group.entries.map((entry) => (
              <li key={entry.name}>
                <a href={entry.url} target="_blank" rel="noreferrer">
                  {entry.name}
                </a>
                <p>
                  {t(entry.role)}
                  {entry.licence && ` — ${t(entry.licence)}`}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="sources-app">
        <a href={CONFIG.PROJECT_URL} target="_blank" rel="noreferrer">
          MY OSM
        </a>{" "}
        — {t("sources.app")}
      </p>
    </div>
  );
}
