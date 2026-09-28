import { useEffect, useState } from "react";
import { BookOpen } from "lucide-react";
import type { AreaInfo, Place } from "../types";
import { useI18n } from "../i18n";
import { safeWebLink } from "../utils/safe";
import { wikiSummary, type WikiSummary } from "../services/wikipedia";
import { readOfflineWiki } from "../services/offline/wiki";

// ---------------------------------------------------------------------------
// Deux blocs de la fiche d'un lieu :
//
//  - les **chiffres** d'une ville ou d'un quartier touché sur la carte
//    (`AreaFacts`) : population, surface, densité, département, région ;
//  - le **résumé Wikipédia** d'un lieu qui a un article (`WikiCard`) — ville,
//    quartier, musée, monument —, avec sa photo, comme dans OsmAnd.
// ---------------------------------------------------------------------------

export function AreaFacts({ area }: { area: AreaInfo }) {
  const { t, locale } = useI18n();
  const number = (value: number, digits = 0) => value.toLocaleString(locale, { maximumFractionDigits: digits });
  const density = area.population && area.areaKm2 ? area.population / area.areaKm2 : undefined;
  const where = [area.county, area.state].filter(Boolean).join(" · ");

  const rows: { label: string; value: string }[] = [];
  if (area.population) {
    rows.push({
      label: t("area.population"),
      value: area.populationYear ? t("area.populationIn", { value: number(area.population), year: area.populationYear }) : number(area.population),
    });
  }
  if (area.areaKm2) rows.push({ label: t("area.surface"), value: t("area.km2", { value: number(area.areaKm2, area.areaKm2 < 10 ? 2 : 1) }) });
  if (density) rows.push({ label: t("area.density"), value: t("area.perKm2", { value: number(density) }) });
  if (area.postcode) rows.push({ label: t("area.postcode"), value: area.postcode });
  if (where) rows.push({ label: t("area.where"), value: where });

  if (!rows.length) return null;
  return (
    <dl className="area-facts">
      {rows.map((row) => (
        <div key={row.label} className="area-fact">
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

type WikiState = { status: "loading" } | { status: "done"; summary: WikiSummary | null } | { status: "error" };

/**
 * Le résumé Wikipédia du lieu. Rien du tout tant qu'on ne sait pas s'il y en
 * a un, ni s'il n'y en a pas : la fiche d'un commerce sans article ne doit pas
 * porter une case vide.
 */
export function WikiCard({ place }: { place: Place }) {
  const { t, lang } = useI18n();
  const [state, setState] = useState<WikiState>({ status: "loading" });
  const ref = { wikidata: place.wikidata, wikipedia: place.wikipedia };
  const hasRef = !!(ref.wikidata || ref.wikipedia);

  useEffect(() => {
    if (!hasRef) return;
    const controller = new AbortController();
    wikiSummary(ref, lang, controller.signal, readOfflineWiki)
      .then((summary) => setState({ status: "done", summary }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error" });
      });
    return () => controller.abort();
    // Les deux références suffisent : un nouvel objet `place` au même lieu ne
    // doit pas relancer la requête.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref.wikidata, ref.wikipedia, lang, hasRef]);

  if (!hasRef || state.status !== "done" || !state.summary) return null;
  const { summary } = state;
  const link = safeWebLink(summary.url);
  // Une photo prise avec une zone est une adresse locale (`blob:`), créée par
  // l'application ; toute autre passe par le filtre des liens.
  const photo = summary.thumbnail?.startsWith("blob:") ? summary.thumbnail : safeWebLink(summary.thumbnail);
  return (
    <section className="wiki-card">
      {photo && <img className="wiki-photo" src={photo} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />}
      <p className="wiki-extract" lang={summary.lang}>
        {summary.extract}
      </p>
      {link && (
        <a className="wiki-link" href={link} target="_blank" rel="noreferrer">
          <BookOpen size={15} />
          {t("wiki.read")}
          {summary.lang !== lang && <span className="wiki-lang">{summary.lang.toUpperCase()}</span>}
        </a>
      )}
      <span className="wiki-credit">{t("wiki.credit")}</span>
    </section>
  );
}
