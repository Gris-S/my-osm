import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { useNav } from "../strings";
import { useBackClose } from "../../hooks/useBackClose";

// ---------------------------------------------------------------------------
// Le bouton qui lance une course, sous le burger, en face de la boussole.
//
// Même taille et même matière que la boussole (44 px, fond plein, ombre), et
// l'orange du mode course pour le pictogramme : on le reconnaît avant de le
// lire. Il disparaît pendant une navigation, un itinéraire ou une course.
//
// **Le lancement passe par une confirmation** : le bouton est petit et posé
// près du burger, un doigt qui vise l'un touche l'autre. Un bouton de 44 px
// n'a pas de place où déplier la confirmation, elle ouvre donc une fenêtre
// dans le voile commun (`.modal-backdrop`), jamais `window.confirm`.
// ---------------------------------------------------------------------------

export function RunButton({ onStart }: { onStart: () => void }) {
  const { nav } = useNav();
  const [confirming, setConfirming] = useState(false);
  useBackClose(confirming, () => setConfirming(false));

  useEffect(() => {
    if (!confirming) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setConfirming(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [confirming]);

  return (
    <>
      <button
        className="run-button"
        onClick={() => setConfirming(true)}
        aria-label={nav("run.button")}
        title={nav("run.button")}
      >
        <Activity size={20} />
      </button>

      {confirming && (
        <div className="modal-backdrop" onClick={() => setConfirming(false)}>
          <div
            className="settings-dialog run-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="run-confirm-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="settings-title" id="run-confirm-title">
              {nav("run.confirmTitle")}
            </h2>
            <p className="run-confirm-text">{nav("run.confirmText")}</p>
            <div className="run-confirm-actions">
              <button className="run-confirm-cancel" onClick={() => setConfirming(false)}>
                {nav("run.confirmNo")}
              </button>
              <button
                className="run-confirm-go"
                autoFocus
                onClick={() => {
                  setConfirming(false);
                  onStart();
                }}
              >
                {nav("run.confirmYes")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
