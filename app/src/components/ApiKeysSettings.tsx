import { useEffect, useState } from "react";
import { Check, ExternalLink, Eye, EyeOff, LoaderCircle, RotateCcw, TriangleAlert, X } from "lucide-react";
import { t, useI18n, type TranslationKey } from "../i18n";
import { checkApiKey, type KeyStatus } from "../services/apiKeyCheck";
import {
  API_KEY_SLOTS,
  apiKey,
  clearApiKey,
  hasBuiltIn,
  keyOrigin,
  restoreBuiltIn,
  setApiKey,
  useApiKeys,
  type ApiKeyId,
} from "../services/apiKeys";

// ---------------------------------------------------------------------------
// Le contenu de la fenêtre « API », ouverte depuis le menu burger.
//
// Elle avait sa place au bas des paramètres ; longue et rarement ouverte, elle
// y noyait le thème et la langue, et a désormais sa propre entrée. Le titre
// vient de la fenêtre (`AppMenu`), la section ne porte donc que l'introduction.
//
// Elle existe parce qu'une clé dans `.env.local` ne se change qu'en éditant un
// fichier puis en recompilant — impossible une fois l'application empaquetée en
// APK, où ce fichier n'existe plus. Les clés se saisissent donc ici, et la
// valeur compilée ne sert plus que de défaut.
//
// Deux partis pris, et ils tiennent au même souci :
//
// - **L'état d'une clé est établi par un appel réel au service.** Compter les
//   caractères dirait « valide » d'une clé révoquée. Le bouton « Vérifier »
//   interroge donc l'API concernée et rapporte ce qu'elle répond — y compris
//   « je n'ai pas su », quand le service ne répond pas : un doute affiché vaut
//   mieux qu'un verdict inventé.
// - **On dit d'où vient la clé employée.** Saisie ici, ou compilée depuis
//   `.env.local` : sans cette mention, supprimer une clé saisie ferait
//   réapparaître l'autre sans explication, et l'on croirait la suppression
//   sans effet.
// ---------------------------------------------------------------------------

/**
 * Les emplacements, groupés par service.
 *
 * Un groupe par service, même s'il n'a qu'une clé : le titre, l'usage et le
 * lien d'inscription se lisent ensemble, au-dessus du champ.
 *
 * `signup` mène là où l'on obtient la clé : sans lui, le champ demande quelque
 * chose sans dire où le trouver. `warning` dit ce qu'il en coûte d'activer le
 * service — à qui les requêtes parviennent — pour les rares cas où la réponse
 * n'est pas anodine ; il s'affiche juste avant le champ, au moment où le choix
 * se fait, et non dans une page d'aide que personne n'ouvre. `apis` nomme ce qu'il faut y chercher, tel que
 * le portail l'affiche — sur PRIM et chez Météo-France, un compte ne suffit
 * pas à savoir quelle API l'application interroge. Adresses relevées le
 * 17 septembre 2026 :
 * - TomTom : `my.tomtom.com`, les boutons « Get started » de
 *   docs.tomtom.com/pricing — sans carte bancaire.
 * - PRIM : l'accueil du portail, où se crée le compte et le jeton. Les deux
 *   API sont celles de `IDFM_STOP_MONITORING_URL` et `IDFM_NAVITIA_URL`.
 * - Mapillary : le tableau de bord développeur, où s'enregistre l'application
 *   dont on copie le « Client Token ».
 * - Météo-France : le portail des API, API « Données Publiques de Vigilance ».
 */
const GROUPS: {
  title: TranslationKey;
  hint: TranslationKey;
  ids: ApiKeyId[];
  signup?: { url: string; label: TranslationKey };
  apis?: TranslationKey;
  warning?: TranslationKey;
}[] = [
  {
    title: "apikeys.group.tomtom",
    hint: "apikeys.group.tomtom.hint",
    ids: ["tomtom"],
    signup: { url: "https://my.tomtom.com/", label: "apikeys.group.tomtom.link" },
  },
  {
    title: "apikeys.group.idfm",
    hint: "apikeys.group.idfm.hint",
    ids: ["idfm"],
    signup: { url: "https://prim.iledefrance-mobilites.fr/", label: "apikeys.group.idfm.link" },
    apis: "apikeys.group.idfm.apis",
  },
  {
    title: "apikeys.group.mapillary",
    hint: "apikeys.group.mapillary.hint",
    ids: ["mapillary"],
    signup: { url: "https://www.mapillary.com/dashboard/developers", label: "apikeys.group.mapillary.link" },
    apis: "apikeys.group.mapillary.apis",
    warning: "apikeys.group.mapillary.warning",
  },
  {
    title: "apikeys.group.meteofrance",
    hint: "apikeys.group.meteofrance.hint",
    ids: ["meteofranceApiKey"],
    signup: { url: "https://portail-api.meteofrance.fr/", label: "apikeys.group.meteofrance.link" },
    apis: "apikeys.group.meteofrance.apis",
  },
];

export function ApiKeysSettings() {
  useI18n();
  // L'abonnement au magasin : une suppression doit redessiner la ligne, et
  // l'état « d'où vient la clé » avec elle.
  useApiKeys();

  return (
    <div className="settings-field">
      <p className="settings-hint">{t("apikeys.intro")}</p>

      <div className="apikeys">
        {GROUPS.map((group) => (
          <section key={group.title} className="apikey-group">
            <h3 className="apikey-group-title">{t(group.title)}</h3>
            <p className="apikey-group-hint">{t(group.hint)}</p>
            {group.signup && (
              <a className="apikey-signup" href={group.signup.url} target="_blank" rel="noreferrer">
                {t(group.signup.label)}
                <ExternalLink size={12} />
              </a>
            )}
            {group.apis && <p className="apikey-apis">{t(group.apis)}</p>}
            {group.warning && (
              <p className="apikey-warning">
                <TriangleAlert size={13} />
                <span>{t(group.warning)}</span>
              </p>
            )}
            {group.ids.map((id) => (
              <KeyRow key={id} id={id} />
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

function KeyRow({ id }: { id: ApiKeyId }) {
  const slot = API_KEY_SLOTS.find((s) => s.id === id);
  const value = apiKey(id);
  const origin = keyOrigin(id);

  // Le champ est tenu localement tant qu'on tape : enregistrer à chaque touche
  // ferait repartir la vérification et réécrirait le stockage une fois par
  // caractère.
  const [draft, setDraft] = useState(value);
  const [shown, setShown] = useState(false);
  // La valeur peut changer sous nos pieds — suppression, retour à la valeur
  // compilée — et le champ doit suivre : repris pendant le rendu, dès qu'elle
  // diffère de celle qu'on a vue.
  const [seenValue, setSeenValue] = useState(value);
  if (seenValue !== value) {
    setSeenValue(value);
    setDraft(value);
  }
  // Le verdict du service, rangé avec la clé qu'il juge : une vérification en
  // cours ou dépassée ne se donne jamais pour celui de la clé actuelle.
  const [verdict, setVerdict] = useState<{ value: string; status: KeyStatus } | null>(null);
  const status: KeyStatus = !value
    ? { kind: "empty" }
    : verdict?.value === value
      ? verdict.status
      : { kind: "checking" };

  // L'état de la clé en vigueur est établi à l'ouverture, puis à chaque
  // changement : c'est ce qui permet de voir d'un coup d'œil, en arrivant dans
  // les paramètres, laquelle est morte.
  useEffect(() => {
    if (!value) return;
    const controller = new AbortController();
    void checkApiKey(id, value, controller.signal).then((next) => {
      if (!controller.signal.aborted) setVerdict({ value, status: next });
    });
    return () => controller.abort();
  }, [id, value]);

  const dirty = draft.trim() !== value;

  return (
    <div className="apikey-row">
      <label className="apikey-label" htmlFor={`apikey-${id}`}>
        {t(slot?.label as TranslationKey)}
      </label>

      <div className="apikey-input">
        <input
          id={`apikey-${id}`}
          // Masquée par défaut : ces fenêtres s'ouvrent parfois devant quelqu'un.
          type={shown ? "text" : "password"}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t("apikeys.placeholder")}
          spellCheck={false}
          autoComplete="off"
        />
        <button
          className="apikey-eye"
          onClick={() => setShown((s) => !s)}
          aria-label={t(shown ? "apikeys.hide" : "apikeys.show")}
          title={t(shown ? "apikeys.hide" : "apikeys.show")}
        >
          {shown ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>

      <div className="apikey-actions">
        <StatusPill status={dirty ? { kind: "empty" } : status} dirty={dirty} />

        {dirty && (
          <button className="apikey-save" onClick={() => setApiKey(id, draft)}>
            {t("apikeys.save")}
          </button>
        )}

        {/* Supprimer efface la clé **et** fait taire celle du fichier : c'est
            la seule façon de désactiver un service dont la clé est compilée
            dans le programme. */}
        {!dirty && origin !== "none" && (
          <button className="apikey-clear" onClick={() => clearApiKey(id)}>
            {t("apikeys.clear")}
          </button>
        )}

        {/* …et l'inverse, quand une valeur compilée existe et qu'on l'a écartée
            ou remplacée. */}
        {!dirty && origin !== "builtIn" && hasBuiltIn(id) && (
          <button className="apikey-restore" onClick={() => restoreBuiltIn(id)}>
            <RotateCcw size={13} />
            {t("apikeys.restore")}
          </button>
        )}
      </div>

      <p className="apikey-origin">{t(ORIGIN_LABEL[origin])}</p>
    </div>
  );
}

const ORIGIN_LABEL = {
  stored: "apikeys.origin.stored",
  builtIn: "apikeys.origin.builtIn",
  none: "apikeys.origin.none",
} as const satisfies Record<string, TranslationKey>;

/**
 * La pastille d'état.
 *
 * Plusieurs états, et chacun dit quelque chose de différent — c'est tout
 * l'intérêt de ne pas se contenter d'un vert et d'un rouge. « Injoignable »
 * n'accuse pas la clé, et une saisie non enregistrée n'a pas d'état du tout.
 */
function StatusPill({ status, dirty }: { status: KeyStatus; dirty: boolean }) {
  if (dirty) return <span className="apikey-pill is-draft">{t("apikeys.unsaved")}</span>;

  switch (status.kind) {
    case "checking":
      return (
        <span className="apikey-pill is-checking">
          <LoaderCircle size={12} className="nav-spin" />
          {t("apikeys.checking")}
        </span>
      );
    case "valid":
      return (
        <span className="apikey-pill is-valid">
          <Check size={12} />
          {t("apikeys.valid")}
        </span>
      );
    case "invalid":
      return (
        <span className="apikey-pill is-invalid">
          <X size={12} />
          {t("apikeys.invalid")}
        </span>
      );
    case "unreachable":
      return (
        <span className="apikey-pill is-unknown">
          <TriangleAlert size={12} />
          {t("apikeys.unreachable")}
        </span>
      );
    default:
      return <span className="apikey-pill is-empty">{t("apikeys.absent")}</span>;
  }
}
