import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import { LoaderCircle, TriangleAlert, X } from "lucide-react";
import { useI18n, type TranslationKey } from "../i18n";
import { useBackClose } from "../hooks/useBackClose";
import type { Theme } from "../hooks/useTheme";
import type { Place } from "../types";
import { resolveStyle } from "./map/layers";
import {
  createPlace,
  nearbyNamed,
  osmObjectUrl,
  OSM_CATEGORIES,
  splitAddress,
  tagsFor,
  type ContribForm,
  type Nearby,
  type SendStep,
} from "../services/osmEdit";
import { errorKey, markPublished, osmToken, useOsmContrib } from "../services/osmContrib";
import { OsmConnect } from "./OsmAccountSettings";

// ---------------------------------------------------------------------------
// « + OSM » : ajouter à OpenStreetMap un lieu trouvé sur le web.
//
// Tout est pré-rempli depuis la fiche — nom, adresse découpée, téléphone,
// site —, mais **rien ne part sans relecture** : la fiche DuckDuckGo vient de
// sources sous droits (Apple Plans, Yelp, TripAdvisor…) qu'OSM interdit de
// recopier. La case de confirmation n'est pas une formalité, c'est ce qui fait
// de l'ajout une contribution humaine plutôt qu'un import automatique, que le
// code de conduite des imports d'OSM encadre strictement.
//
// Trois garde-fous avant l'envoi : l'épingle, qu'on pose sur l'entrée (la
// position vient d'un géocodage d'adresse, parfois à trente mètres) ; la
// catégorie, sans laquelle le point n'a ni icône ni recherche par type ; et
// les lieux du même nom à moins de 100 m, lus sur OSM.
//
// Pas connecté ? La connexion se fait **dans cette fenêtre** (`OsmConnect`),
// plutôt que d'ouvrir la fenêtre « API » par-dessus : deux fenêtres empilées
// sur le même voile, c'est une croix de trop et un retour qui ferme la
// mauvaise.
// ---------------------------------------------------------------------------

interface OsmContribDialogProps {
  place: Place;
  theme: Theme;
  onClose: () => void;
  /** Le lieu tel qu'il vient d'être écrit dans OSM : la fiche le reprend. */
  onPublished: (place: Place) => void;
}

const STEP_LABEL: Record<SendStep, TranslationKey> = {
  changeset: "osm.send.changeset",
  node: "osm.send.node",
  close: "osm.send.close",
};

export function OsmContribDialog({ place, theme, onClose, onPublished }: OsmContribDialogProps) {
  const { t } = useI18n();
  const contrib = useOsmContrib();
  const connected = contrib.account.kind === "ok";
  useBackClose(true, onClose);

  // Le nom : ce qui avait été tapé dans la recherche (demande explicite) — le
  // nom du lieu, lui, vient de la page et n'est souvent qu'une adresse
  // (« 19 Rue du Midi », constaté). Une saisie peut être approximative
  // (« mcdo »), d'où l'avertissement tant qu'on n'y a pas touché.
  const nameFromQuery = place.webQuery ?? null;
  const [form, setForm] = useState<ContribForm>(() => ({
    name: nameFromQuery ?? place.name,
    category: "",
    ...splitAddress(place.address ?? ""),
    phone: place.phone ?? "",
    website: place.website ?? "",
  }));
  const [confirmed, setConfirmed] = useState(false);
  const [pin, setPin] = useState({ lat: place.lat, lon: place.lon });
  const [dupes, setDupes] = useState<{ key: string; list: Nearby[] | null; error: boolean } | null>(null);
  const [sending, setSending] = useState<SendStep | null>(null);
  const [failure, setFailure] = useState<{ key: TranslationKey; detail?: string } | null>(null);

  const set = (field: keyof ContribForm) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [field]: event.target.value }));

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // --- La carte de l'épingle ------------------------------------------------
  // Une instance à part, petite, créée à l'ouverture et détruite à la
  // fermeture. Elle n'est rendue qu'une fois connecté : c'est le seul moment
  // où l'épingle sert.
  const mapBox = useRef<HTMLDivElement>(null);
  const start = useRef({ lat: place.lat, lon: place.lon });
  useEffect(() => {
    const container = mapBox.current;
    if (!connected || !container) return;
    const map = new maplibregl.Map({
      container,
      style: resolveStyle(theme, "standard"),
      center: [start.current.lon, start.current.lat],
      zoom: 18,
      attributionControl: false,
      pitchWithRotate: false,
      dragRotate: false,
    });
    const marker = new maplibregl.Marker({ color: "#34C759", draggable: true })
      .setLngLat([start.current.lon, start.current.lat])
      .addTo(map);
    marker.on("dragend", () => {
      const at = marker.getLngLat();
      setPin({ lat: at.lat, lon: at.lng });
    });
    return () => {
      marker.remove();
      map.remove();
    };
  }, [connected, theme]);

  // --- Les lieux du même nom autour ------------------------------------------
  // Relus quand l'épingle bouge ou que le nom change (après une pause de
  // frappe) ; un résultat n'est montré que pour la question qui l'a demandé.
  const dupeKey = `${pin.lat.toFixed(6)}|${pin.lon.toFixed(6)}|${form.name.trim()}`;
  useEffect(() => {
    if (!connected) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      nearbyNamed(pin.lat, pin.lon, form.name, controller.signal).then(
        (list) => setDupes({ key: dupeKey, list, error: false }),
        () => {
          if (!controller.signal.aborted) setDupes({ key: dupeKey, list: null, error: true });
        }
      );
    }, 500);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [connected, pin.lat, pin.lon, form.name, dupeKey]);
  const dupeState = dupes?.key === dupeKey ? dupes : null;
  const similar = dupeState?.list?.filter((d) => d.similar) ?? [];

  const tags = useMemo(() => tagsFor(form), [form]);
  const missing: TranslationKey[] = [];
  if (!form.name.trim()) missing.push("osm.form.needName");
  if (!form.category) missing.push("osm.form.needCategory");
  if (!confirmed) missing.push("osm.form.needConfirm");
  const canSend = connected && !sending && missing.length === 0 && dupeState !== null;

  async function send() {
    const token = osmToken();
    if (!canSend || !token) return;
    setFailure(null);
    try {
      const { node } = await createPlace(token, pin.lat, pin.lon, tags, __APP_VERSION__, setSending);
      const link = osmObjectUrl("node", node);
      markPublished(place.id, link);
      const street = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ");
      const town = [tags["addr:postcode"], tags["addr:city"]].filter(Boolean).join(" ");
      onPublished({
        ...place,
        name: tags.name ?? place.name,
        lat: pin.lat,
        lon: pin.lon,
        address: [street, town].filter(Boolean).join(", ") || place.address,
        phone: tags.phone,
        website: tags.website,
        rawType: OSM_CATEGORIES.find((c) => c.id === form.category)?.tag[1],
      });
    } catch (error) {
      setFailure({ key: errorKey(error), detail: error instanceof Error ? error.message : undefined });
    } finally {
      setSending(null);
    }
  }

  return (
    // Pendant l'envoi, un toucher à côté ne ferme pas : on ne saurait plus si le
    // lieu est parti.
    <div className="modal-backdrop" onClick={sending ? undefined : onClose}>
      <div
        className="settings-dialog osm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="osm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-head">
          <h2 className="settings-title" id="osm-title">
            {t("osm.dialog.title")}
          </h2>
          <button className="settings-close" onClick={onClose} aria-label={t("sheet.close")}>
            <X size={18} />
          </button>
        </div>

        <p className="osm-server-badge">{t("osm.dialog.live")}</p>

        {!connected ? (
          <div className="osm-login-inline">
            <p className="settings-hint osm-login-hint">{t("osm.dialog.loginFirst")}</p>
            <OsmConnect />
          </div>
        ) : (
          <>
            <div ref={mapBox} className="osm-pin-map" />
            <p className="settings-hint">{t("osm.form.pinHint")}</p>

            <div className={`osm-dupes ${dupeState?.error ? "is-warn" : similar.length ? "is-warn" : dupeState ? "is-ok" : ""}`}>
              {!dupeState ? (
                <>
                  <LoaderCircle size={13} className="nav-spin" />
                  {t("osm.dupes.checking")}
                </>
              ) : dupeState.error ? (
                t("osm.dupes.error")
              ) : similar.length ? (
                <>
                  <strong>{t("osm.dupes.found")}</strong>
                  <ul>
                    {similar.slice(0, 4).map((d) => (
                      <li key={`${d.type}/${d.id}`}>
                        <a href={osmObjectUrl(d.type, d.id)} target="_blank" rel="noreferrer">
                          {t("osm.dupes.item", { name: d.name, distance: String(d.distance) })}
                        </a>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                t("osm.dupes.none")
              )}
            </div>

            <div className="osm-form">
              <label className="save-field">
                <span className="settings-field-label">{t("osm.form.name")}</span>
                <input className="save-input" value={form.name} onChange={set("name")} />
                {nameFromQuery !== null && form.name === nameFromQuery && (
                  <span className="apikey-warning osm-name-check">
                    <TriangleAlert size={13} />
                    <span>{t("osm.form.nameFromQuery")}</span>
                  </span>
                )}
              </label>
              <label className="save-field">
                <span className="settings-field-label">{t("osm.form.category")}</span>
                <select className="save-input" value={form.category} onChange={set("category")}>
                  <option value="">{t("osm.form.categoryPick")}</option>
                  {OSM_CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {t(c.label)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="osm-row">
                <label className="save-field is-narrow">
                  <span className="settings-field-label">{t("osm.form.housenumber")}</span>
                  <input className="save-input" value={form.housenumber} onChange={set("housenumber")} />
                </label>
                <label className="save-field">
                  <span className="settings-field-label">{t("osm.form.street")}</span>
                  <input className="save-input" value={form.street} onChange={set("street")} />
                </label>
              </div>
              <div className="osm-row">
                <label className="save-field is-narrow">
                  <span className="settings-field-label">{t("osm.form.postcode")}</span>
                  <input className="save-input" value={form.postcode} onChange={set("postcode")} inputMode="numeric" />
                </label>
                <label className="save-field">
                  <span className="settings-field-label">{t("osm.form.city")}</span>
                  <input className="save-input" value={form.city} onChange={set("city")} />
                </label>
              </div>
              <label className="save-field">
                <span className="settings-field-label">{t("osm.form.phone")}</span>
                <input className="save-input" value={form.phone} onChange={set("phone")} inputMode="tel" />
              </label>
              <label className="save-field">
                <span className="settings-field-label">{t("osm.form.website")}</span>
                <input className="save-input" value={form.website} onChange={set("website")} inputMode="url" />
              </label>

              <label className="osm-confirm">
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                <span>{t("osm.form.confirm")}</span>
              </label>
            </div>

            <details className="osm-preview">
              <summary>{t("osm.form.preview")}</summary>
              <pre>
                {`${pin.lat.toFixed(6)}, ${pin.lon.toFixed(6)}\n` +
                  Object.entries(tags)
                    .map(([k, v]) => `${k}=${v}`)
                    .join("\n")}
              </pre>
            </details>

            {failure && (
              <p className="apikey-warning">
                <TriangleAlert size={13} />
                <span>
                  {t(failure.key)}
                  {failure.key === "osm.error.http" && failure.detail ? ` (${failure.detail})` : ""}
                </span>
              </p>
            )}
            {!failure && !sending && missing.length > 0 && <p className="settings-hint">{missing.map((k) => t(k)).join(" ")}</p>}

            <button className="osm-send sheet-action-osm" onClick={() => void send()} disabled={!canSend}>
              <span>
                {sending ? (
                  <>
                    <LoaderCircle size={15} className="nav-spin" />
                    {t(STEP_LABEL[sending])}
                  </>
                ) : (
                  t("osm.form.send")
                )}
              </span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
