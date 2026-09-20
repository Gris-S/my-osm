import { lazy, Suspense, useEffect, useRef, useState, memo } from "react";
import { Download, History, KeyRound, Menu, Moon, Scale, Settings, Sun, SunMoon, ToggleRight, TrainFront, X } from "lucide-react";
import type { AutoSource, Theme } from "../hooks/useTheme";
import { useI18n, useLangSetting, type Lang, type TranslationKey } from "../i18n";
import type { LonLat } from "../types";
// Navigation guidée — voir `src/navigation/README.md`. La section entière est
// fournie par le module ; la fenêtre ne fait que lui donner sa place.
import { ApiKeysSettings } from "./ApiKeysSettings";
import { HistoryPanel, ModesSettings, navText, NavigationSettings } from "../navigation";
import { HomeWorkSettings } from "./HomeWorkSettings";
import { SourcesList } from "./SourcesList";
import { useBackClose } from "../hooks/useBackClose";
import { setStationsFirstEnabled, stationsFirstEnabled } from "../search/searchResults";

// Les fenêtres du menu ne servent qu'à leur ouverture : chargées à la demande,
// elles sortent du démarrage (la carte réduite, les contours, le téléchargement).
const DownloadPanel = lazy(() => import("./DownloadPanel").then((m) => ({ default: m.DownloadPanel })));

// ---------------------------------------------------------------------------
// Menu principal (bouton burger, en haut à gauche).
//
// Il rassemble ce qui règle l'application elle-même, par opposition au menu
// des calques — qui règle le rendu de la carte — et à celui des catégories,
// qui règle ce qu'elle montre.
//
// Deux temps : le burger découvre une courte liste d'entrées — « Paramètres »,
// « Téléchargement », « Historique », « Modes », « API », « Sources et licences » — et l'entrée choisie ouvre une **fenêtre au centre de
// l'écran**, posée sur un voile. Le menu reste ainsi une table des matières,
// que d'autres entrées pourront rejoindre, et les réglages eux-mêmes ne
// s'ajustent pas du coin de l'œil en regardant la carte.
// ---------------------------------------------------------------------------

/**
 * Choix du thème, à trois positions. « Automatique » n'est pas un troisième
 * thème mais l'absence de choix : l'application suit alors la lumière ambiante
 * (ou, sans capteur, l'appareil), et bascule en cours de route.
 */
const THEMES: { id: Theme | "auto"; label: TranslationKey; icon: typeof Sun }[] = [
  { id: "auto", label: "settings.theme.auto", icon: SunMoon },
  { id: "light", label: "settings.theme.light", icon: Sun },
  { id: "dark", label: "settings.theme.dark", icon: Moon },
];

/**
 * Choix de la langue, sur le même modèle. Les noms de langues restent dans
 * leur propre langue — « Français » ne se traduit pas pour qui cherche à
 * quitter une interface qu'il ne lit pas.
 */
const LANGS: { id: Lang | "system"; label: TranslationKey | string }[] = [
  { id: "system", label: "settings.language.system" },
  { id: "fr", label: "Français" },
  { id: "en", label: "English" },
];

interface AppMenuProps {
  theme: Theme;
  /**
   * Centre de la carte principale, pour ouvrir la carte de sélection du
   * téléchargement là où l'utilisateur regarde plutôt qu'à Paris.
   */
  center: LonLat;
  /**
   * Les crédits des sources de carte en vigueur, relevés par `MapView`.
   * Ils vivent au bas de ce menu depuis qu'ils ne barrent plus la carte.
   */
  credits: string[];
  /** Vrai tant que l'utilisateur n'a pas choisi de thème lui-même. */
  auto: boolean;
  /** Ce que suit le thème automatique : le capteur de lumière, ou l'appareil. */
  autoSource: AutoSource;
  onThemeChange: (theme: Theme) => void;
  onAutoTheme: () => void;
  /**
   * Compteur qu'on incrémente pour demander l'ouverture de l'écran des clés.
   *
   * Un nombre, et non un booléen : la fenêtre d'accueil doit pouvoir rouvrir
   * cet écran autant de fois qu'on le lui demande, or un booléen déjà à vrai ne
   * redéclencherait rien. `0` signifie « personne n'a rien demandé ».
   *
   * `apiOpen` reste **local à ce menu**. Le lever jusqu'à `App` pour un seul
   * appelant ferait traverser tout le rendu à un état qui ne regarde que le
   * menu, et le projet n'a délibérément pas de contexte pour l'y conduire.
   */
  openApiSignal?: number;
}

/**
 * Un crédit de source, rendu en éléments React.
 *
 * Ces chaînes viennent du style de carte, donc d'un tiers, et portent des
 * balises `<a>` vers les licences. Les injecter en HTML brut ferait confiance à
 * ce tiers pour tout le document ; on les analyse donc et on ne reconstruit
 * **que** du texte et des liens — tout le reste est ignoré. Les liens comptent :
 * une attribution qui ne mène pas à la licence ne vaut pas grand-chose.
 */
function renderCredit(html: string): React.ReactNode[] {
  const root = new DOMParser().parseFromString(html, "text/html").body;
  return [...root.childNodes].map((node, index) => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    const element = node as HTMLElement;
    const href = element.tagName === "A" ? element.getAttribute("href") : null;
    // Seuls `http(s)` sont suivis : une URL `javascript:` venue d'un style
    // tiers n'a rien à faire dans un lien qu'on rend cliquable.
    if (href && /^https?:\/\//i.test(href)) {
      return (
        <a key={index} href={href} target="_blank" rel="noreferrer">
          {element.textContent}
        </a>
      );
    }
    return element.textContent;
  });
}

// Protégé contre les rendus inutiles (`memo`) : `App` se redessine à chaque
// relevé GPS d'une navigation, et ce composant n'a alors rien de neuf à montrer.
export const AppMenu = memo(function AppMenu({ theme, center, credits, auto, autoSource, onThemeChange, onAutoTheme, openApiSignal }: AppMenuProps) {
  const { t } = useI18n();
  const language = useLangSetting();
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [stationsFirst, setStationsFirst] = useState(stationsFirstEnabled);
  // Les clés d'API ont leur propre fenêtre : longue, rarement ouverte, elle
  // noyait le thème et la langue au bas des paramètres.
  const [apiOpen, setApiOpen] = useState(false);
  // Les interrupteurs des modes : bouton de course, fiches de fin.
  const [modesOpen, setModesOpen] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  // D'où viennent les données, et sous quelle licence (Transitous exige ce lien).
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Ouverture de l'écran des clés demandée du dehors (fenêtre d'accueil).
  //
  // L'ajustement se fait **pendant le rendu**, et non dans un effet : c'est le
  // patron que React prévoit pour réagir au changement d'une prop, et un effet
  // qui appelle `setState` déclenche un rendu de plus pour rien. Le menu se
  // referme au passage — la fenêtre des clés se pose par-dessus, et le laisser
  // ouvert derrière elle n'aurait aucun sens une fois qu'on la fermera.
  const [handledApiSignal, setHandledApiSignal] = useState(openApiSignal ?? 0);
  if ((openApiSignal ?? 0) !== handledApiSignal) {
    setHandledApiSignal(openApiSignal ?? 0);
    setMenuOpen(false);
    setApiOpen(true);
  }

  // Menu déroulé : fermeture au clic à l'extérieur et à Échap, comme les
  // autres menus flottants de l'application.
  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  // Fenêtres des paramètres et des clés d'API : Échap les ferme aussi. Le clic
  // à l'extérieur, lui, est porté par le voile — il couvre tout, il n'y a rien
  // à écouter sur le document. Une seule est ouverte à la fois, d'où un seul
  // bouton de fermeture à viser.
  const dialogOpen = settingsOpen || apiOpen || modesOpen || sourcesOpen;
  // Le geste retour ferme le menu déroulé, et les fenêtres des paramètres, des
  // modes et des clés d'API comme leur croix (`hooks/useBackClose.ts`).
  useBackClose(menuOpen, () => setMenuOpen(false));
  useBackClose(dialogOpen, () => {
    setSettingsOpen(false);
    setApiOpen(false);
    setModesOpen(false);
    setSourcesOpen(false);
  });
  useEffect(() => {
    if (!dialogOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setSettingsOpen(false);
        setApiOpen(false);
        setModesOpen(false);
        setSourcesOpen(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    // Le clavier arrive dans la fenêtre plutôt que de rester sur la carte.
    closeRef.current?.focus();
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [dialogOpen]);

  const current = auto ? "auto" : theme;

  return (
    <>
      <div className="app-menu" ref={wrapRef}>
        <button
          className={`app-menu-button ${menuOpen ? "is-open" : ""}`}
          onClick={() => setMenuOpen((prev) => !prev)}
          aria-label={t("menu.aria")}
          aria-expanded={menuOpen}
          title={t("menu.title")}
        >
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>

        {menuOpen && (
          <div className="app-menu-panel" role="menu">
            <button
              className="app-menu-item"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                setSettingsOpen(true);
              }}
            >
              <Settings size={17} />
              {t("menu.settings")}
            </button>
            <button
              className="app-menu-item"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                setDownloadOpen(true);
              }}
            >
              <Download size={17} />
              {t("menu.download")}
            </button>
            {/* Navigation guidée — voir `src/navigation/README.md`. L'entrée et
                son panneau viennent du module ; le menu ne fait que les
                référencer. */}
            <button
              className="app-menu-item"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                setHistoryOpen(true);
              }}
            >
              <History size={17} />
              {navText("menu.history")}
            </button>
            <button
              className="app-menu-item"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                setModesOpen(true);
              }}
            >
              <ToggleRight size={17} />
              {navText("menu.modes")}
            </button>
            <button
              className="app-menu-item"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                setApiOpen(true);
              }}
            >
              <KeyRound size={17} />
              {t("menu.api")}
            </button>
            <button
              className="app-menu-item"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                setSourcesOpen(true);
              }}
            >
              <Scale size={17} />
              {t("menu.sources")}
            </button>

            {/* Les crédits des sources, au bas du menu.
                Ils étaient un bandeau pleine largeur posé sur la carte, qui
                recouvrait les boutons flottants sur un téléphone. La licence
                ODbL impose de les **conserver**, pas de les afficher en
                permanence par-dessus la carte : ils sont donc ici, à un geste,
                et suivent exactement les sources allumées. */}
            <div className="app-menu-credits">
              {credits.map((credit) => (
                <p key={credit}>{renderCredit(credit)}</p>
              ))}
              {/* La version, sous les crédits : `package.json`, injectée par
                  `vite.config.ts`. */}
              <p className="app-menu-version">{t("menu.version", { version: __APP_VERSION__ })}</p>
            </div>
          </div>
        )}
      </div>

      <Suspense fallback={null}>
        {downloadOpen && <DownloadPanel center={center} onClose={() => setDownloadOpen(false)} />}
        {historyOpen && <HistoryPanel onClose={() => setHistoryOpen(false)} />}
      </Suspense>


      {sourcesOpen && (
        <div className="modal-backdrop" onClick={() => setSourcesOpen(false)}>
          <div
            className="settings-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sources-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="settings-head">
              <h2 className="settings-title" id="sources-title">
                {t("sources.title")}
              </h2>
              <button ref={closeRef} className="settings-close" onClick={() => setSourcesOpen(false)} aria-label={t("sources.close")}>
                <X size={18} />
              </button>
            </div>
            <SourcesList />
          </div>
        </div>
      )}

      {settingsOpen && (
        // Le voile ferme au clic ; l'arrêt de propagation sur la fenêtre évite
        // qu'un clic dans les réglages ne la referme aussitôt.
        <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}>
          <div
            className="settings-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="settings-head">
              <h2 className="settings-title" id="settings-title">
                {t("settings.title")}
              </h2>
              <button
                ref={closeRef}
                className="settings-close"
                onClick={() => setSettingsOpen(false)}
                aria-label={t("settings.close")}
              >
                <X size={18} />
              </button>
            </div>

            <div className="settings-field">
              <span className="settings-field-label">{t("settings.theme")}</span>
              <div className="segmented" role="radiogroup" aria-label={t("settings.theme")}>
                {THEMES.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    className={`segmented-option ${current === id ? "is-active" : ""}`}
                    onClick={() => (id === "auto" ? onAutoTheme() : onThemeChange(id))}
                    role="radio"
                    aria-checked={current === id}
                  >
                    <Icon size={16} />
                    {t(label)}
                  </button>
                ))}
              </div>
              {auto && (
                <p className="settings-hint">
                  {t(autoSource === "sensor" ? "settings.theme.hintSensor" : "settings.theme.hintSystem")}
                </p>
              )}
            </div>

            <div className="settings-field">
              <span className="settings-field-label">{t("settings.language")}</span>
              <div className="segmented" role="radiogroup" aria-label={t("settings.language")}>
                {LANGS.map(({ id, label }) => {
                  const active = (language.followSystem ? "system" : language.lang) === id;
                  return (
                    <button
                      key={id}
                      className={`segmented-option ${active ? "is-active" : ""}`}
                      onClick={() => (id === "system" ? language.followSystemLang() : language.setLang(id))}
                      role="radio"
                      aria-checked={active}
                      lang={id === "system" ? undefined : id}
                    >
                      {id === "system" ? t(label as TranslationKey) : label}
                    </button>
                  );
                })}
              </div>
              {language.followSystem && <p className="settings-hint">{t("settings.language.hint")}</p>}
            </div>

            {/* Refonte de la recherche (demande explicite) : réglable, actif par
                défaut. Lu à chaque recherche, sans rien à propager. */}
            <button
              className="modes-row settings-switch-row"
              onClick={() => {
                setStationsFirstEnabled(!stationsFirst);
                setStationsFirst(!stationsFirst);
              }}
              role="switch"
              aria-checked={stationsFirst}
            >
              <span className="modes-row-text">
                <span className="modes-row-label">
                  <TrainFront size={16} />
                  {t("settings.stationsFirst")}
                </span>
                <span className="modes-row-hint">{t("settings.stationsFirst.hint")}</span>
              </span>
              <span className={`toggle-switch ${stationsFirst ? "is-on" : ""}`} aria-hidden="true">
                <span className="toggle-switch-knob" />
              </span>
            </button>

            <HomeWorkSettings />
            <NavigationSettings />
          </div>
        </div>
      )}

      {modesOpen && (
        <div className="modal-backdrop" onClick={() => setModesOpen(false)}>
          <div
            className="settings-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modes-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="settings-head">
              <h2 className="settings-title" id="modes-title">
                {navText("modes.title")}
              </h2>
              <button
                ref={closeRef}
                className="settings-close"
                onClick={() => setModesOpen(false)}
                aria-label={t("settings.close")}
              >
                <X size={18} />
              </button>
            </div>

            <ModesSettings />
          </div>
        </div>
      )}

      {apiOpen && (
        <div className="modal-backdrop" onClick={() => setApiOpen(false)}>
          <div
            className="settings-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="api-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="settings-head">
              <h2 className="settings-title" id="api-title">
                {t("apikeys.title")}
              </h2>
              <button
                ref={closeRef}
                className="settings-close"
                onClick={() => setApiOpen(false)}
                aria-label={t("settings.close")}
              >
                <X size={18} />
              </button>
            </div>

            <ApiKeysSettings />
          </div>
        </div>
      )}
    </>
  );
});
