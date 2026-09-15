import { useEffect, useRef, useState } from "react";
import { Check, FolderPlus, X } from "lucide-react";
import type { Bookmarks } from "../hooks/useBookmarks";
import type { Place } from "../types";
import { useI18n } from "../i18n";
import { useBackClose } from "../hooks/useBackClose";

// ---------------------------------------------------------------------------
// Fenêtre d'enregistrement d'un lieu.
//
// Deux décisions, et pas une de plus : sous quel nom, et dans quel dossier.
// Le nom est pré-rempli avec celui du lieu — on peut valider sans rien écrire —
// et un dossier peut se créer sans quitter la fenêtre, faute de quoi il
// faudrait renoncer à enregistrer pour aller le préparer ailleurs.
// ---------------------------------------------------------------------------

interface SavePlaceDialogProps {
  place: Place;
  bookmarks: Bookmarks;
  onClose: () => void;
}

export function SavePlaceDialog({ place, bookmarks, onClose }: SavePlaceDialogProps) {
  const { t } = useI18n();
  const existing = bookmarks.findSaved(place.id);
  const [name, setName] = useState(existing?.place.name ?? place.name);
  const [folderId, setFolderId] = useState(existing?.folder.id ?? bookmarks.folders[0]?.id ?? "");
  const [creating, setCreating] = useState(false);
  const [newFolder, setNewFolder] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  useBackClose(true, onClose);
  useBackClose(creating, () => setCreating(false));

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    nameRef.current?.focus();
    nameRef.current?.select();
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function confirmNewFolder() {
    const created = bookmarks.createFolder(newFolder);
    setFolderId(created);
    setCreating(false);
    setNewFolder("");
  }

  function submit() {
    if (!folderId) return;
    bookmarks.savePlace(folderId, place, name);
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-head">
          <h2 className="settings-title" id="save-title">
            {t("save.title")}
          </h2>
          <button className="settings-close" onClick={onClose} aria-label={t("sheet.close")}>
            <X size={18} />
          </button>
        </div>

        <label className="save-field">
          <span className="settings-field-label">{t("save.name")}</span>
          <input
            ref={nameRef}
            className="save-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder={place.name}
          />
        </label>

        <div className="save-field">
          <span className="settings-field-label">{t("save.folder")}</span>
          <div className="save-folders">
            {bookmarks.folders.map((folder) => (
              <button
                key={folder.id}
                className={`save-folder ${folder.id === folderId ? "is-active" : ""}`}
                onClick={() => setFolderId(folder.id)}
                role="radio"
                aria-checked={folder.id === folderId}
              >
                <span className="save-folder-dot" style={{ background: folder.color }} />
                <span className="save-folder-name">{folder.name}</span>
                {folder.id === folderId && <Check size={15} strokeWidth={3} />}
              </button>
            ))}
          </div>

          {creating ? (
            <div className="save-new-folder">
              <input
                autoFocus
                className="save-input"
                value={newFolder}
                onChange={(e) => setNewFolder(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") confirmNewFolder();
                  if (e.key === "Escape") setCreating(false);
                }}
                placeholder={t("folder.placeholder")}
              />
              <button className="save-confirm" onClick={confirmNewFolder} aria-label={t("folder.create")}>
                <Check size={16} />
              </button>
            </div>
          ) : (
            <button className="save-add-folder" onClick={() => setCreating(true)}>
              <FolderPlus size={16} />
              {t("folder.new")}
            </button>
          )}
        </div>

        <button className="save-submit" onClick={submit} disabled={!folderId}>
          {existing ? t("save.move") : t("save.submit")}
        </button>
      </div>
    </div>
  );
}
