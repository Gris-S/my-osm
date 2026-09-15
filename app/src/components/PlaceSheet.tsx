import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { safeWebLink } from "../utils/safe";
import { Bookmark, BookmarkCheck, Check, ChevronDown, Clipboard, Clock, Globe, MapPin, Navigation, Phone, Share2, X } from "lucide-react";
import { getFilterGroup } from "../filters";
import type { Place } from "../types";
import { copyToClipboard, formatCoords } from "../utils/clipboard";
import { canUseSystemShare, shareViaSystem } from "../utils/share";
import { computeOpenState, hoursComment, weeklyHours } from "../utils/openingHours";
import { isTransitStop } from "../services/idfm";
import { TransitDepartures } from "./TransitDepartures";
import { useI18n } from "../i18n";
import { useBackClose } from "../hooks/useBackClose";

/**
 * Le domaine d'une adresse, pour nommer un lien sans l'écrire en entier.
 * Une URL invalide est rendue telle quelle : mieux vaut un lien laid qu'un
 * lien absent.
 */
function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Où en est la recherche des informations détaillées du lieu ouvert. */
export type DetailsStatus = "none" | "loading" | "done" | "error";

interface PlaceSheetProps {
  place: Place;
  detailsStatus: DetailsStatus;
  /** Signale la ligne dépliée, pour que la carte en trace le parcours. */
  onLineFocus: (line: { lineId: string; color: string } | null) => void;
  /** Change à chaque nouveau contact sur le lieu déjà ouvert (voir `TransitDepartures`). */
  refreshToken: number;
  onClose: () => void;
  onStartItinerary: () => void;
  /** Dossier où le lieu est rangé, s'il est déjà enregistré. */
  savedIn: { name: string; color: string } | null;
  /** Ouvre la fenêtre d'enregistrement. */
  onSave: () => void;
  /** Retire l'enregistrement : c'est le même bouton qui fait les deux. */
  onUnsave: () => void;
  /** Hauteur occupée par la fiche, pour que les boutons flottants la dégagent. */
  onHeightChange: (height: number) => void;
}

/** `tel:` n'accepte ni espaces ni séparateurs de lisibilité. */
function telHref(phone: string): string {
  return `tel:${phone.replace(/[^+\d]/g, "")}`;
}

/**
 * Encart des horaires : ouvert ou fermé maintenant, en vert ou en rouge, suivi
 * de l'heure de fermeture — et la semaine entière au dépli.
 *
 * Les horaires arrivent après l'ouverture de la fiche (voir
 * `services/overpass.ts`), et tous les lieux n'en déclarent pas. Chaque cas
 * d'absence a donc son propre message : on ne fait jamais passer une
 * information manquante pour une fermeture.
 */
function HoursBox({ place, status }: { place: Place; status: DetailsStatus }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const openState = computeOpenState(place.openingHours);
  const week = weeklyHours(place.openingHours);

  if (!place.openingHours) {
    const message =
      status === "loading"
        ? t("hours.loading")
        : status === "error"
          ? t("hours.unavailable")
          : status === "done"
            ? t("hours.unknown")
            : null;
    if (!message) return null;
    return (
      <div className="hours-box is-unknown">
        <div className="hours-summary">
          <Clock size={16} className="hours-icon" />
          <span className="hours-detail">{message}</span>
        </div>
      </div>
    );
  }

  // Rien de lisible du tout. On **ne montre pas la valeur brute** : c'est de la
  // syntaxe OSM, et elle se lit très mal — le Jardin du Luxembourg affichait
  // ainsi « open "check website https://…"; (sunset-00:30)-(sunrise-00:15)
  // closed; Mar01-Sep30 (sunset-00:30)-07:30 closed », constaté sur appareil.
  //
  // Ce qu'on montre à la place, quand il existe, c'est le **commentaire entre
  // guillemets** : c'est la seule partie de la valeur écrite pour un humain, et
  // elle porte souvent l'essentiel — ici, l'adresse de la page des horaires. À
  // défaut, on dit simplement qu'on ne sait pas les lire, ce qui est vrai et
  // n'occupe pas l'écran avec ce que personne ne peut interpréter.
  if (!week) {
    const comment = hoursComment(place.openingHours);
    // L'adresse que porte souvent ce commentaire devient un lien court, nommé
    // par son domaine : écrite en entier elle prenait trois lignes et ne se
    // touchait pas, ce qui est le comble pour une page d'horaires.
    return (
      <div className="hours-box is-unknown">
        <div className="hours-summary">
          <Clock size={16} className="hours-icon" />
          <span className="hours-detail">
            {comment?.text || t("hours.unreadable")}
            {comment?.url && (
              <>
                {comment.text ? " " : ""}
                <a className="hours-link" href={comment.url} target="_blank" rel="noreferrer">
                  {hostOf(comment.url)}
                </a>
              </>
            )}
          </span>
        </div>
      </div>
    );
  }

  // La semaine se lit mais pas l'horaire du jour (« Sa sunrise-sunset ») :
  // l'encart reste neutre et le tableau, lui, garde tout son intérêt.
  const tone = !openState ? "is-unknown" : openState.isOpen ? "is-open" : "is-closed";

  return (
    <div className={`hours-box ${tone}`}>
      <button className="hours-summary" onClick={() => setExpanded((prev) => !prev)} aria-expanded={expanded}>
        {openState ? (
          <>
            <span className="hours-state">{openState.status}</span>
            {openState.detail && <span className="hours-detail">· {openState.detail}</span>}
          </>
        ) : (
          <>
            <Clock size={16} className="hours-icon" />
            <span className="hours-detail">{t("hours.checkToday")}</span>
          </>
        )}
        <ChevronDown size={18} className={`hours-chevron ${expanded ? "is-open" : ""}`} />
      </button>

      {expanded && (
        <>
          <table className="hours-week">
            <tbody>
              {week.days.map((day) => (
                <tr key={day.day} className={day.isToday ? "is-today" : ""}>
                  <th scope="row">{day.day}</th>
                  <td>{day.hours}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* Jours fériés, vacances, dates particulières : ce que la semaine
              ordinaire ne dit pas. */}
          {week.notes.length > 0 && (
            <ul className="hours-notes">
              {week.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Bouton « Partager » et son menu : passer la main aux applications du
 * téléphone, ou recopier les coordonnées.
 *
 * Le partage système n'apparaît que là où il existe vraiment
 * (`navigator.share`, essentiellement sur mobile) : proposer une action inerte
 * sur un navigateur de bureau vaudrait moins que ne rien proposer.
 */
function ShareAction({ place }: { place: Place }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  useBackClose(open, () => setOpen(false));
  const [copied, setCopied] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);
  const coords = formatCoords(place.lat, place.lon);

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  // Fermeture au clic à l'extérieur et à la touche Échap, comme les autres
  // menus de l'application.
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

  async function handleSystemShare() {
    setOpen(false);
    await shareViaSystem(place);
  }

  async function handleCopy() {
    const done = await copyToClipboard(coords);
    setOpen(false);
    if (!done) return;
    setCopied(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="share-wrap" ref={wrapRef}>
      {open && (
        <div className="share-menu" role="menu">
          {canUseSystemShare() && (
            <button className="share-option" onClick={handleSystemShare} role="menuitem">
              <Share2 size={18} />
              <span className="share-option-text">
                <span className="share-option-label">{t("sheet.shareSystem")}</span>
                <span className="share-option-hint">{t("sheet.shareSystemHint")}</span>
              </span>
            </button>
          )}
          <button className="share-option" onClick={handleCopy} role="menuitem">
            <Clipboard size={18} />
            <span className="share-option-text">
              <span className="share-option-label">{t("sheet.copyCoords")}</span>
              <span className="share-option-hint">{coords}</span>
            </span>
          </button>
        </div>
      )}

      <button
        className={`sheet-action-secondary ${copied ? "is-done" : ""}`}
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        {copied ? <Check size={16} /> : <Share2 size={16} />}
        {copied ? t("sheet.copied") : t("sheet.share")}
      </button>
    </div>
  );
}

export function PlaceSheet({
  place,
  detailsStatus,
  onLineFocus,
  refreshToken,
  onClose,
  onStartItinerary,
  savedIn,
  onSave,
  onUnsave,
  onHeightChange,
}: PlaceSheetProps) {
  const { t } = useI18n();
  // Le geste retour ferme la fiche, comme sa croix.
  useBackClose(true, onClose);

  // La fiche mesure sa propre hauteur et la publie.
  //
  // Les boutons flottants du bord droit se rangent au-dessus d'elle, et leur
  // décalage était un nombre écrit à la main (220 px). Il ne pouvait pas
  // tenir : la hauteur d'une fiche dépend de son contenu — une adresse, des
  // horaires, des prochains passages, un bandeau d'enregistrement — et sur un
  // téléphone elle dépasse largement cette valeur, si bien que la moitié des
  // boutons passait dessous (constaté sur appareil). On mesure donc.
  const sheetRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const element = sheetRef.current;
    if (!element) return;
    onHeightChange(element.offsetHeight);
    if (typeof ResizeObserver === "undefined") return;
    // La fiche grandit après coup : les horaires arrivent d'Overpass, les
    // prochains passages de PRIM. Une mesure au montage ne suffirait pas.
    const observer = new ResizeObserver(() => onHeightChange(element.offsetHeight));
    observer.observe(element);
    return () => {
      observer.disconnect();
      // La fiche se referme : les boutons reprennent leur place basse.
      onHeightChange(0);
    };
  }, [onHeightChange]);

  // Glisser la poignée vers le bas referme la fiche.
  //
  // La fiche suit le doigt par un `transform` posé directement sur l'élément,
  // sans passer par l'état React : un rendu à chaque mouvement ferait saccader
  // le geste. Au lâcher, elle se ferme si on l'a descendue d'un tiers de sa
  // hauteur (120 px au plus) ou d'un geste vif, et remonte sinon. La zone de
  // prise est plus large que la barre dessinée : 36 × 5 px ne se visent pas au
  // doigt.
  //
  // La vitesse se mesure sur les ~100 dernières millisecondes, et non entre
  // deux événements : deux relevés à une milliseconde d'écart donnent une
  // vitesse absurde, et un glissement lent passait pour un geste vif.
  const dragRef = useRef<{ pointerId: number; startY: number; samples: { y: number; t: number }[] } | null>(null);

  function handleGrabDown(event: ReactPointerEvent<HTMLDivElement>) {
    const element = sheetRef.current;
    if (!element || dragRef.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, startY: event.clientY, samples: [{ y: event.clientY, t: event.timeStamp }] };
    element.style.transition = "none";
  }

  function handleGrabMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    const element = sheetRef.current;
    if (!drag || !element || drag.pointerId !== event.pointerId) return;
    drag.samples.push({ y: event.clientY, t: event.timeStamp });
    while (drag.samples.length > 2 && event.timeStamp - drag.samples[0].t > 100) drag.samples.shift();
    // Vers le haut, la fiche ne monte pas : il n'y a rien au-dessus à découvrir.
    element.style.transform = `translateY(${Math.max(0, event.clientY - drag.startY)}px)`;
  }

  function handleGrabEnd(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    const element = sheetRef.current;
    if (!drag || !element || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    const distance = Math.max(0, event.clientY - drag.startY);
    const threshold = Math.min(120, element.offsetHeight / 3);
    // Un geste interrompu par le système (`pointercancel`) ne ferme jamais.
    const oldest = drag.samples[0];
    const elapsed = event.timeStamp - oldest.t;
    const speed = elapsed >= 30 ? (event.clientY - oldest.y) / elapsed : 0;
    const closing = event.type === "pointerup" && (distance > threshold || (distance > 40 && speed > 0.8));
    element.style.transition = "transform 0.2s ease-out";
    if (!closing) {
      element.style.transform = "";
      return;
    }
    element.style.transform = "translateY(100%)";
    // La fermeture attend la fin de la descente ; le délai couvre le cas où
    // `transitionend` ne viendrait pas (animations réduites par le système).
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      onClose();
    };
    element.addEventListener("transitionend", close, { once: true });
    window.setTimeout(close, 260);
  }

  const group = getFilterGroup(place.group);
  const groupLabel = group ? t(group.label) : t("sheet.place");

  // Un arrêt ou une gare n'a pas d'horaires d'ouverture : ce sont les prochains
  // passages qui répondent à la question, et annoncer « horaires non
  // renseignés » juste au-dessus n'apprenait rien. Pour les transports,
  // l'encart d'horaires n'apparaît donc que si le lieu en déclare vraiment —
  // une station-service ouverte 24 h/24, par exemple.
  const isTransit = isTransitStop(place);
  // Une rue, une adresse, un point posé au hasard : rien de tout cela n'ouvre
  // ni ne ferme, et « horaires non renseignés » n'y apprend rien. L'encart est
  // réservé aux lieux classés — commerce, musée, parc… — à moins qu'OSM ne
  // connaisse malgré tout des horaires à ce point précis.
  const canHaveHours = place.group !== null || !!place.openingHours;
  const showHours = canHaveHours && (!isTransit || !!place.openingHours);

  return (
    <div className="sheet" ref={sheetRef}>
      <div
        className="sheet-grab"
        onPointerDown={handleGrabDown}
        onPointerMove={handleGrabMove}
        onPointerUp={handleGrabEnd}
        onPointerCancel={handleGrabEnd}
      >
        <div className="sheet-handle" />
      </div>
      <button className="sheet-close" onClick={onClose} aria-label={t("sheet.close")}>
        <X size={18} />
      </button>

      <div className="sheet-header">
        <h2 className="sheet-title">{place.name}</h2>
        <div className="sheet-subtitle">{groupLabel}</div>
      </div>

      {/* Dans une gare ou à un arrêt, l'horaire qui compte est celui du
          prochain passage : il passe donc avant tout le reste. */}
      {isTransit && <TransitDepartures key={place.id} place={place} onLineFocus={onLineFocus} refreshToken={refreshToken} />}

      {showHours && <HoursBox place={place} status={detailsStatus} />}

      <div className="sheet-actions">
        <button className="sheet-action-primary" onClick={onStartItinerary}>
          <Navigation size={16} />
          {t("sheet.itinerary")}
        </button>
        {place.phone && (
          <a className="sheet-action-secondary" href={telHref(place.phone)}>
            <Phone size={16} />
            {t("sheet.call")}
          </a>
        )}
        {/* Un site venu d'OSM peut porter n'importe quel schéma : seul un lien web est rendu. */}
        {safeWebLink(place.website) && (
          <a className="sheet-action-secondary" href={safeWebLink(place.website)} target="_blank" rel="noreferrer">
            <Globe size={16} />
            {t("sheet.website")}
          </a>
        )}
        {/* Enregistrer passe avant Partager : on range un lieu bien plus
            souvent qu'on ne l'envoie. Le même bouton défait l'enregistrement,
            et porte alors la couleur de son dossier. */}
        <button
          className={`sheet-action-secondary ${savedIn ? "is-saved" : ""}`}
          onClick={savedIn ? onUnsave : onSave}
          style={savedIn ? { color: savedIn.color } : undefined}
          title={savedIn ? t("sheet.savedTitle", { folder: savedIn.name }) : t("sheet.saveTitle")}
        >
          {savedIn ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}
          {savedIn ? t("sheet.saved") : t("sheet.save")}
        </button>
        <ShareAction place={place} />
      </div>

      <div className="sheet-info">
        {place.phone && (
          <a className="sheet-info-row is-link" href={telHref(place.phone)}>
            <span className="sheet-info-icon">
              <Phone size={17} />
            </span>
            <span className="sheet-info-value">{place.phone}</span>
          </a>
        )}
        {place.address && (
          <div className="sheet-info-row">
            <span className="sheet-info-icon">
              <MapPin size={17} />
            </span>
            <span className="sheet-info-value">{place.address}</span>
          </div>
        )}
      </div>
    </div>
  );
}
