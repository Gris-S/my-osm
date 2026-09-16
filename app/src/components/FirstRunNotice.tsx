import { KeyRound, Scale, X } from "lucide-react";
import { CONFIG } from "../config";
import { useBackClose } from "../hooks/useBackClose";
import { useI18n } from "../i18n";
import { rememberFirstRunSeen } from "../services/firstRun";

// ---------------------------------------------------------------------------
// Fenêtre d'accueil, au tout premier lancement.
//
// Elle dit les deux choses qu'on ne découvrirait autrement qu'au moment où
// elles manquent : la clé TomTom, sans laquelle la navigation voiture est
// amputée en silence, et l'existence du dépôt public.
//
// **Elle ne s'ouvre qu'une fois.** Une fenêtre qui revient est une fenêtre
// qu'on apprend à fermer sans lire ; celle-ci se retire dès qu'elle a été vue,
// par quelque sortie que ce soit — le bouton, le voile, la croix, le geste
// retour. Aucune de ces sorties n'est un piège : toutes valent « j'ai vu ».
// ---------------------------------------------------------------------------

interface FirstRunNoticeProps {
  /** Referme la fenêtre. Appelée par toutes les sorties. */
  onClose: () => void;
  /** Ouvre l'écran des clés d'API (Menu › API). */
  onAddKey: () => void;
}

export function FirstRunNotice({ onClose, onAddKey }: FirstRunNoticeProps) {
  const { t } = useI18n();

  const close = () => {
    rememberFirstRunSeen();
    onClose();
  };

  // Le geste retour ne fait jamais plus que le bouton de fermeture.
  useBackClose(true, close);

  const addKey = () => {
    close();
    onAddKey();
  };

  return (
    <div className="modal-backdrop" onClick={close}>
      <div
        className="settings-dialog first-run"
        role="dialog"
        aria-modal="true"
        aria-labelledby="first-run-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="settings-head">
          <h2 className="settings-title" id="first-run-title">
            {t("firstRun.title")}
          </h2>
          <button className="settings-close" onClick={close} aria-label={t("firstRun.close")}>
            <X size={16} />
          </button>
        </div>

        <p className="first-run-lead">{t("firstRun.lead")}</p>

        <section className="first-run-block is-key">
          <h3 className="first-run-block-title">
            <KeyRound size={15} />
            {t("firstRun.tomtom.title")}
          </h3>
          <p className="first-run-text">{t("firstRun.tomtom.body")}</p>
          <p className="first-run-note">{t("firstRun.tomtom.free")}</p>
          <button className="first-run-action is-primary" onClick={addKey}>
            {t("firstRun.addKey")}
          </button>
        </section>

        <section className="first-run-block">
          <h3 className="first-run-block-title">
            <Scale size={15} />
            {t("firstRun.github.title")}
          </h3>
          <p className="first-run-text">{t("firstRun.github.body")}</p>
          <a
            className="first-run-action"
            href={CONFIG.PROJECT_URL}
            target="_blank"
            rel="noreferrer"
            onClick={close}
          >
            {t("firstRun.openGithub")}
          </a>
        </section>

        <button className="first-run-later" onClick={close}>
          {t("firstRun.later")}
        </button>
      </div>
    </div>
  );
}
