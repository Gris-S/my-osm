import { useEffect, useRef, useState } from "react";
import { ChevronDown, TrainFront } from "lucide-react";
import { CONFIG } from "../config";
import { hasIdfmKey } from "../services/idfm";
import type { Departure, DepartureGroup, LineDepartures } from "../transport/departuresView";
import { loadDepartures, loadStationLines } from "../transport/stations";
import type { LineChip } from "../utils/markerImage";
import type { Place } from "../types";
import { currentLocale, t, useI18n } from "../i18n";

// ---------------------------------------------------------------------------
// Prochains passages à un arrêt ou dans une gare.
//
// Un encart par ligne ; déplié, il donne un encart par destination, tous modes
// confondus — le sens de circulation n'est pas fiable dans la source (voir
// `services/idfm.ts`). Chaque encart annonce le prochain passage, et se déplie
// à son tour sur ceux d'après.
// ---------------------------------------------------------------------------

/** Lignes déclarées à l'arrêt dont aucune n'a rendu de passage. */
function silentLines(declared: LineChip[], withDepartures: LineDepartures[]): LineChip[] {
  const speaking = new Set(withDepartures.map((line) => line.label));
  return declared.filter((line) => !speaking.has(line.label));
}

/** « à quai », « dans 4 min », ou l'heure quand l'attente dépasse une heure. */
function formatWait(departure: Departure): string {
  if (departure.cancelled) return t("departures.cancelled");
  if (departure.minutes <= 0) return t("departures.atPlatform");
  if (departure.minutes < 60) return t("departures.inMinutes", { minutes: departure.minutes });
  return formatTime(departure);
}

function formatTime(departure: Departure): string {
  return departure.at.toLocaleTimeString(currentLocale(), { hour: "2-digit", minute: "2-digit" });
}

function LineBadge({ line }: { line: LineDepartures }) {
  return (
    <span className="line-badge" style={{ background: line.color, color: line.textColor }}>
      {line.label}
    </span>
  );
}

function GroupCard({ group }: { group: DepartureGroup }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const next = group.departures[0];
  // Le premier passage est déjà annoncé sur la ligne repliée : le dépli montre
  // ce qui vient **après**, sinon la première ligne du tableau ne dirait rien
  // de neuf.
  const rest = group.departures.slice(1, 1 + CONFIG.IDFM_MAX_DEPARTURES);

  return (
    <div className="departure-group">
      <button className="departure-summary" onClick={() => setOpen((prev) => !prev)} aria-expanded={open}>
        <span className="departure-direction">{group.label}</span>
        <span className={`departure-next ${next ? "" : "is-ended"}`}>
          {next ? formatWait(next) : t("departures.ended")}
        </span>
        <ChevronDown size={16} className={`departure-chevron ${open ? "is-open" : ""}`} />
      </button>

      {open && rest.length === 0 && <p className="departure-none">{t("departures.noneAfter")}</p>}

      {open && rest.length > 0 && (
        <ul className="departure-list">
          {rest.map((departure, index) => (
            <li key={`${departure.at.toISOString()}-${index}`} className={departure.cancelled ? "is-cancelled" : ""}>
              <span className="departure-wait">{formatWait(departure)}</span>
              <span className="departure-time">{formatTime(departure)}</span>
              {departure.platform && (
                <span className="departure-platform">{t("departures.platform", { platform: departure.platform })}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Une ligne et ses destinations.
 *
 * L'ouverture est tenue par le parent : une seule ligne reste dépliée à la
 * fois, sans quoi la fiche d'un arrêt bien desservi s'allongerait sur plusieurs
 * écrans. Les destinations d'une même ligne, elles, se déplient librement — on
 * compare volontiers deux directions du même bus. Replier une ligne démonte ses
 * destinations, qui repartent donc fermées à la réouverture.
 */
function LineCard({ line, open, onToggle }: { line: LineDepartures; open: boolean; onToggle: () => void }) {
  const { t } = useI18n();
  // Le passage le plus proche, toutes directions confondues : c'est ce que
  // l'encart annonce tant qu'il est replié.
  const next = line.groups.flatMap((group) => group.departures)[0];

  return (
    <div className="line-card">
      <button className="line-summary" onClick={onToggle} aria-expanded={open}>
        <LineBadge line={line} />
        <span className={`departure-next ${next ? "" : "is-ended"}`}>
          {next ? formatWait(next) : t("departures.ended")}
        </span>
        <ChevronDown size={16} className={`departure-chevron ${open ? "is-open" : ""}`} />
      </button>

      {open && (
        <div className="line-groups">
          {line.groups.map((group) => (
            <GroupCard key={group.key} group={group} />
          ))}
        </div>
      )}
    </div>
  );
}

type State =
  | { status: "loading" }
  | { status: "done"; lines: LineDepartures[] }
  | { status: "error" };

/**
 * Une ligne desservant l'arrêt dont la source ne dit rien.
 *
 * Le référentiel et le temps réel ne couvrent pas le même périmètre : à
 * Châtelet-Les Halles, le premier annonce les RER A, B et D, le second ne
 * diffuse par moments que le A et le B. La ligne muette est donc affichée, en
 * retrait, plutôt que passée sous silence — sans quoi on la cherche en vain.
 */
function SilentLine({ line }: { line: LineChip }) {
  const { t } = useI18n();

  return (
    <div className="line-card is-silent">
      <div className="line-summary">
        <span className="line-badge" style={{ background: line.color, color: line.textColor }}>
          {line.label}
        </span>
        <span className="departure-next is-ended">{t("departures.silentLine")}</span>
      </div>
    </div>
  );
}

interface TransitDeparturesProps {
  place: Place;
  /** Prévient du dépli d'une ligne, pour que la carte en trace le parcours. */
  onLineFocus: (line: { lineId: string; color: string } | null) => void;
  /**
   * Change à chaque nouveau contact sur l'arrêt déjà ouvert : les passages sont
   * alors redemandés, sans passer par le cache.
   */
  refreshToken: number;
}

export function TransitDepartures({ place, onLineFocus, refreshToken }: TransitDeparturesProps) {
  const { t } = useI18n();
  // La phrase entoure un `<code>` : lue sans variable, elle se coupe sur `{file}`.
  const noKeyNote = t("departures.noKey").split("{file}");
  const [state, setState] = useState<State>({ status: "loading" });
  // Ligne dépliée, s'il y en a une : l'accordéon se joue à ce niveau.
  const [openLine, setOpenLine] = useState<string | null>(null);
  // Lignes déclarées à l'arrêt par le référentiel, pour repérer les muettes.
  const [stopLines, setStopLines] = useState<LineChip[]>([]);

  // Le composant est monté par arrêt (clé sur l'identifiant du lieu, côté
  // fiche) : l'état part donc de « chargement » sans avoir à le réinitialiser.
  // Le lieu est lu par une ref : seule son identité d'arrêt commande la
  // requête. Sans cela, le moindre rendu du parent relancerait la recherche et
  // refermerait la ligne dépliée.
  const placeRef = useRef(place);
  useEffect(() => {
    placeRef.current = place;
  }, [place]);

  useEffect(() => {
    if (!hasIdfmKey()) return;
    const controller = new AbortController();
    let cancelled = false;
    // Le référentiel des lignes est interrogé en parallèle : il dit ce qui
    // dessert l'arrêt, le temps réel ce qui y passe. L'écart entre les deux est
    // précisément ce qu'on veut montrer.
    loadStationLines(placeRef.current, controller.signal)
      .then((lines) => {
        if (!cancelled) setStopLines(lines);
      })
      .catch(() => {
        /* sans cette liste, la fiche se contente des lignes qui répondent */
      });

    loadDepartures(placeRef.current, controller.signal)
      .then((lines) => {
        if (cancelled) return;
        setState({ status: "done", lines });
        // Un arrêt qui ne voit passer qu'une ligne s'ouvre directement dessus.
        setOpenLine(lines.length === 1 ? lines[0].lineId : null);
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [place.id]);

  // Nouveau contact sur l'arrêt déjà ouvert : on redemande les passages. Les
  // précédents restent affichés, estompés, le temps de la réponse — la fiche ne
  // repasse pas par « Recherche… » — et la ligne dépliée le reste si elle passe
  // toujours. Le jeton du montage ne compte pas : l'effet ci-dessus vient de
  // lancer le chargement initial. On compare au jeton du montage, et non au
  // dernier vu, pour que le double montage de `StrictMode` relance bien la
  // requête qu'il vient d'annuler.
  const [refresh, setRefresh] = useState<"idle" | "running" | "failed">("idle");
  const mountTokenRef = useRef(refreshToken);
  useEffect(() => {
    if (refreshToken === mountTokenRef.current || !hasIdfmKey()) return;
    const controller = new AbortController();
    let cancelled = false;
    setRefresh("running");
    loadDepartures(placeRef.current, controller.signal, { fresh: true })
      .then((lines) => {
        if (cancelled) return;
        setState({ status: "done", lines });
        setOpenLine((current) => {
          if (current && lines.some((line) => line.lineId === current)) return current;
          return lines.length === 1 ? lines[0].lineId : null;
        });
        setRefresh("idle");
      })
      .catch(() => {
        if (!cancelled) setRefresh("failed");
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [refreshToken]);

  // Le tracé suit la ligne dépliée, et s'efface avec elle — y compris quand la
  // fiche se ferme, qui démonte ce composant.
  useEffect(() => {
    const line = state.status === "done" ? state.lines.find((candidate) => candidate.lineId === openLine) : undefined;
    onLineFocus(line ? { lineId: line.lineId, color: line.color } : null);
    return () => onLineFocus(null);
  }, [openLine, state, onLineFocus]);

  // Sans clé PRIM, autant le dire clairement plutôt que de laisser un vide :
  // la fonctionnalité existe, il lui manque une clé personnelle et gratuite.
  if (!hasIdfmKey()) {
    return (
      <div className="departures">
        <div className="departures-title">
          <TrainFront size={16} />
          {t("departures.title")}
        </div>
        {/* La phrase entoure un `<code>` : on la coupe sur son propre marqueur
            plutôt que d'en faire deux clés. */}
        <p className="departures-note">
          {noKeyNote[0]}
          <code>.env.local</code>
          {noKeyNote[1]}
        </p>
      </div>
    );
  }

  return (
    <div className={`departures ${refresh === "running" ? "is-refreshing" : ""}`} aria-busy={refresh === "running"}>
      <div className="departures-title">
        <TrainFront size={16} />
        {t("departures.title")}
      </div>

      {refresh === "failed" && state.status === "done" && (
        <p className="departures-note">{t("departures.refreshError")}</p>
      )}
      {state.status === "loading" && <p className="departures-note">{t("departures.loading")}</p>}
      {state.status === "error" && <p className="departures-note">{t("departures.error")}</p>}
      {state.status === "done" && state.lines.length === 0 && (
        <p className="departures-note">{t("departures.none")}</p>
      )}
      {state.status === "done" && silentLines(stopLines, state.lines).length > 0 && (
        <>
          {silentLines(stopLines, state.lines).map((line) => (
            <SilentLine key={`silent-${line.label}`} line={line} />
          ))}
          <p className="departures-note is-aside">{t("departures.silentNote")}</p>
        </>
      )}

      {state.status === "done" &&
        state.lines.map((line) => (
          <LineCard
            key={line.lineId}
            line={line}
            open={openLine === line.lineId}
            onToggle={() => setOpenLine((current) => (current === line.lineId ? null : line.lineId))}
          />
        ))}
    </div>
  );
}
