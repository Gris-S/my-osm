import { useEffect, useState } from "react";
import { Check, ExternalLink, LoaderCircle, LogIn, LogOut, TriangleAlert, X } from "lucide-react";
import { CONFIG } from "../config";
import { t, useI18n, type TranslationKey } from "../i18n";
import { OSM_REGISTER_URL } from "../services/osmEdit";
import {
  builtInClientId,
  errorKey,
  logoutOsm,
  osmClientId,
  setOsmClientId,
  useOsmContrib,
  verifyAccount,
} from "../services/osmContrib";
import { startOsmLogin } from "../services/osmLogin";
import { hasInAppBrowser } from "../services/webSearch";

// ---------------------------------------------------------------------------
// Le compte OpenStreetMap, dans la fenêtre « API » (demande explicite : « les
// identifiants stockés comme les API, dans l'onglet API, pour ne pas se
// reconnecter à chaque fois »).
//
// Ce qui est gardé est un **jeton**, pas un mot de passe — OSM n'en accepte
// plus depuis 2024. Comme pour les clés, son état est établi par un appel réel
// (`whoAmI`), jamais supposé : « connecté » veut dire qu'OSM vient de le
// confirmer.
// ---------------------------------------------------------------------------

export function OsmAccountSettings() {
  useI18n();
  // L'abonnement redessine le champ quand le Client ID change ailleurs.
  useOsmContrib();
  const clientId = osmClientId();
  const [draft, setDraft] = useState(clientId);
  const [seen, setSeen] = useState(clientId);
  if (seen !== clientId) {
    setSeen(clientId);
    setDraft(clientId);
  }
  const dirty = draft.trim() !== clientId;

  return (
    <section className="apikey-group osm-account-group">
      <h3 className="apikey-group-title">{t("osm.api.title")}</h3>
      <p className="apikey-group-hint">{t("osm.api.hint")}</p>

      <div className="apikey-row osm-client">
        <label className="apikey-label" htmlFor="osm-client-id">
          {t("osm.api.clientId")}
        </label>
        <div className="apikey-input">
          <input
            id="osm-client-id"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={t("osm.api.clientIdPlaceholder")}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        <div className="apikey-actions">
          {dirty && (
            <button className="apikey-save" onClick={() => setOsmClientId(draft)}>
              {t("apikeys.save")}
            </button>
          )}
        </div>
        <p className="apikey-origin">
          {builtInClientId() && clientId === builtInClientId() ? t("osm.api.clientIdBuiltIn") : t("osm.api.clientIdHelp")}
        </p>
        <a className="apikey-signup" href={OSM_REGISTER_URL} target="_blank" rel="noreferrer">
          {t("osm.api.register")}
          <ExternalLink size={12} />
        </a>
        <p className="apikey-apis">
          {t("osm.api.registerHow", { oob: CONFIG.OSM_EDIT.REDIRECT_OOB, app: CONFIG.OSM_EDIT.REDIRECT_APP })}
        </p>
      </div>

      <OsmConnect />
    </section>
  );
}

/**
 * L'état du compte et le bouton qui va avec. Sert aussi dans la fenêtre
 * d'ajout, quand on touche « + OSM » sans être connecté : on se connecte sur
 * place, sans empiler une seconde fenêtre par-dessus.
 */
export function OsmConnect() {
  useI18n();
  const contrib = useOsmContrib();
  const token = contrib.token;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TranslationKey | null>(null);
  const [pending, setPending] = useState<{ finish: (code: string) => Promise<void> } | null>(null);
  const [code, setCode] = useState("");

  // L'état du compte est établi à l'ouverture, par un appel réel.
  useEffect(() => {
    if (token) void verifyAccount();
  }, [token]);

  async function connect() {
    setError(null);
    setBusy(true);
    try {
      const started = await startOsmLogin();
      if (started.kind === "needsCode") setPending({ finish: started.finish });
    } catch (e) {
      setError(errorKey(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitCode() {
    if (!pending || !code.trim()) return;
    setError(null);
    setBusy(true);
    try {
      await pending.finish(code);
      setPending(null);
      setCode("");
    } catch (e) {
      setError(errorKey(e));
    } finally {
      setBusy(false);
    }
  }

  const account = contrib.account;
  const noClient = !osmClientId();

  return (
    <div className="osm-connect">
      <div className="apikey-actions">
        {token ? (
          account.kind === "ok" ? (
            <span className="apikey-pill is-valid">
              <Check size={12} />
              {t("osm.account.ok", { name: account.name })}
            </span>
          ) : account.kind === "revoked" ? (
            <span className="apikey-pill is-invalid">
              <X size={12} />
              {t("osm.account.revoked")}
            </span>
          ) : account.kind === "unreachable" ? (
            <span className="apikey-pill is-unknown">
              <TriangleAlert size={12} />
              {t("apikeys.unreachable")}
            </span>
          ) : (
            <span className="apikey-pill is-checking">
              <LoaderCircle size={12} className="nav-spin" />
              {t("apikeys.checking")}
            </span>
          )
        ) : (
          <span className="apikey-pill is-empty">{t("osm.account.none")}</span>
        )}

        {token && account.kind !== "revoked" ? (
          <button className="apikey-clear" onClick={logoutOsm}>
            <LogOut size={13} />
            {t("osm.account.logout")}
          </button>
        ) : (
          <button className="apikey-save" onClick={() => void connect()} disabled={busy}>
            {busy ? <LoaderCircle size={13} className="nav-spin" /> : <LogIn size={13} />}
            {t("osm.account.login")}
          </button>
        )}
      </div>

      {/* Sans Client ID, le bouton reste actif : grisé, il semblait en panne
          (constaté) ; touché, il dit ce qui manque, en encadré. */}
      {noClient && !token && !error && <p className="apikey-origin">{t("osm.error.noClientId")}</p>}
      {!token && !noClient && hasInAppBrowser() && <p className="apikey-origin">{t("osm.account.loginHintApp")}</p>}

      {pending && (
        <div className="osm-code">
          <p className="apikey-origin">{t("osm.account.codeHint")}</p>
          <div className="apikey-input">
            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && void submitCode()}
              placeholder={t("osm.account.codePlaceholder")}
              spellCheck={false}
              autoComplete="off"
            />
          </div>
          <div className="apikey-actions">
            <button className="apikey-save" onClick={() => void submitCode()} disabled={busy || !code.trim()}>
              {t("osm.account.codeSubmit")}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="apikey-warning">
          <TriangleAlert size={13} />
          <span>{t(error)}</span>
        </p>
      )}
    </div>
  );
}
