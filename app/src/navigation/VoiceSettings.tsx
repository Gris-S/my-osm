import { useEffect, useState } from "react";
import { Volume2 } from "lucide-react";
import { useNav } from "./strings";
import {
  canDownloadVoices,
  chooseVoice,
  listVoices,
  openVoiceDownloads,
  sampleVoice,
  spokenLanguageOf,
  useChosenVoice,
  type DeviceVoice,
} from "./voice";

// ---------------------------------------------------------------------------
// « Voix des annonces », dans la section Navigation des paramètres.
//
// **Une langue, puis ses voix** (demande explicite, 13 octobre 2026 : la liste
// de toutes les voix à plat était trop longue). Le sélecteur ne propose que
// les langues **déjà téléchargées** ; en choisir une déplie ses voix, chacune
// avec son bouton d'écoute — Android ne dit ni « homme » ni « femme », il n'y
// a qu'à entendre. « Voix par défaut du téléphone » ne déplie rien. Le lien du
// bas ouvre l'écran du moteur pour en télécharger d'autres ; la liste est
// relue au retour dans l'application.
// ---------------------------------------------------------------------------

export function VoiceSettings() {
  const { nav, locale } = useNav();
  const chosen = useChosenVoice();
  const [voices, setVoices] = useState<DeviceVoice[] | null>(null);
  // La langue dépliée : celle de la voix retenue, tant qu'on n'en a pas touché une autre.
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void listVoices().then((list) => {
        if (!cancelled) setVoices(list);
      });
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    load();
    document.addEventListener("visibilitychange", onVisible);
    // Un navigateur ne donne ses voix qu'après coup.
    const web = typeof speechSynthesis === "undefined" ? null : speechSynthesis;
    web?.addEventListener?.("voiceschanged", load);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      web?.removeEventListener?.("voiceschanged", load);
    };
  }, []);

  if (voices === null) return null;
  const native = canDownloadVoices();
  // Les langues de l'interface d'abord, puis les autres par ordre alphabétique.
  const mine = locale.slice(0, 2).toLowerCase();
  const locales = [...new Set(voices.map((voice) => voice.locale))]
    .map((code) => ({ code, label: languageName(code, locale), home: code.toLowerCase().startsWith(mine) }))
    .sort((a, b) => Number(b.home) - Number(a.home) || a.label.localeCompare(b.label, locale));
  const open = picked ?? voices.find((voice) => voice.name === chosen)?.locale ?? "";
  const listed = voices.filter((voice) => voice.locale === open);

  return (
    <>
      <label className="settings-field-label nav-settings-second" htmlFor="nav-voice-language">
        {nav("settings.voice")}
      </label>
      {locales.length === 0 ? (
        <p className="settings-hint">{nav("settings.voice.none")}</p>
      ) : (
        <select
          id="nav-voice-language"
          className="nav-settings-select"
          aria-label={nav("settings.voice.language")}
          value={open}
          onChange={(event) => {
            setPicked(event.target.value);
            // Revenir à la voix du téléphone, c'est un choix ; déplier une langue n'en est pas encore un.
            if (event.target.value === "") chooseVoice("");
          }}
        >
          <option value="">{nav("settings.voice.default")}</option>
          {locales.map(({ code, label }) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </select>
      )}
      {listed.length > 0 && (
        <ul className="voice-list">
          {listed.map((voice, rank) => {
            const label = nav("settings.voice.item", { n: rank + 1 });
            return (
              <li key={voice.name} className={`voice-row ${chosen === voice.name ? "is-chosen" : ""}`}>
                <button className="voice-pick" onClick={() => chooseVoice(voice.name, voice.locale)} role="radio" aria-checked={chosen === voice.name}>
                  <span className="voice-radio" aria-hidden="true" />
                  <span className="voice-name">{label}</span>
                </button>
                <button className="voice-listen" onClick={() => sampleVoice(voice.name, voice.locale)} aria-label={`${nav("settings.voice.listen")} — ${label}`}>
                  <Volume2 size={18} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {/* Une langue qu'on ne sait pas écrire (le polonais…) : la voix lira la langue de l'application. */}
      {open !== "" && spokenLanguageOf(open) === null && <p className="settings-hint">{nav("settings.voice.foreign")}</p>}
      {native && (
        <button className="nav-settings-link" onClick={openVoiceDownloads}>
          {nav("settings.voice.download")}
        </button>
      )}
      <p className="settings-hint">{nav(native ? "settings.voice.hint" : "settings.voice.hint.web")}</p>
    </>
  );
}

/** « Français (France) », « Anglais (Royaume-Uni) » : la langue d'une voix, dite dans celle de l'interface. */
function languageName(code: string, uiLocale: string): string {
  try {
    const name = new Intl.DisplayNames([uiLocale], { type: "language" }).of(code);
    return name ? name.charAt(0).toUpperCase() + name.slice(1) : code;
  } catch {
    return code;
  }
}
