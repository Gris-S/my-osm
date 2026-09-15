import { useEffect, useRef, useState, memo } from "react";
import { Bookmark, Check, ChevronDown, FolderPlus, MapPin, Palette, Pencil, Trash2, X } from "lucide-react";
import { DEFAULT_FOLDER_ID, FOLDER_COLORS, type BookmarkFolder, type Bookmarks, type SavedPlace } from "../hooks/useBookmarks";
import { useI18n } from "../i18n";
import { useBackClose } from "../hooks/useBackClose";

// ---------------------------------------------------------------------------
// Menu des lieux enregistrés (bouton signet, au-dessus des catégories).
//
// Un dossier s'y **allume** — ses points apparaissent alors sur la carte, à sa
// couleur — et se **déplie**, pour retrouver un lieu par son nom. Les deux
// gestes sont distincts : on consulte souvent une liste sans vouloir couvrir
// la carte, et l'inverse est vrai aussi.
// ---------------------------------------------------------------------------

interface FolderRowProps {
  folder: BookmarkFolder;
  visible: boolean;
  bookmarks: Bookmarks;
  onOpenPlace: (place: SavedPlace) => void;
}

function FolderRow({ folder, visible, bookmarks, onOpenPlace }: FolderRowProps) {
  const { t, tp } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(folder.name);
  const [picking, setPicking] = useState(false);
  // Suppression demandée, en attente de confirmation : un dossier peut
  // contenir des mois de repérages, il ne part pas sur un clic.
  const [confirming, setConfirming] = useState(false);
  useBackClose(picking, () => setPicking(false));
  useBackClose(renaming, () => {
    setName(folder.name);
    setRenaming(false);
  });
  useBackClose(confirming, () => setConfirming(false));
  // Le dossier par défaut n'est pas supprimable — il reste le point de chute
  // de tout enregistrement.
  const removable = folder.id !== DEFAULT_FOLDER_ID;

  function commitRename() {
    bookmarks.renameFolder(folder.id, name);
    setRenaming(false);
  }

  return (
    <div className={`bookmark-folder ${visible ? "is-visible" : ""}`}>
      <div className="bookmark-folder-head">
        {/* Allumer le dossier : c'est ce qui pose ses points sur la carte. */}
        <button
          className="bookmark-toggle"
          onClick={() => bookmarks.toggleVisible(folder.id)}
          role="switch"
          aria-checked={visible}
          title={visible ? t("bookmarks.hide") : t("bookmarks.show")}
        >
          <span className="bookmark-dot" style={{ background: visible ? folder.color : "transparent", borderColor: folder.color }}>
            {visible && <Check size={11} strokeWidth={4} color="#fff" />}
          </span>
        </button>

        {renaming ? (
          <input
            autoFocus
            className="bookmark-rename"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") {
                setName(folder.name);
                setRenaming(false);
              }
            }}
          />
        ) : (
          <button className="bookmark-folder-name" onClick={() => setExpanded((prev) => !prev)} aria-expanded={expanded}>
            <span className="bookmark-folder-label">{folder.name}</span>
            <span className="bookmark-count">{folder.places.length}</span>
            <ChevronDown size={15} className={`departure-chevron ${expanded ? "is-open" : ""}`} />
          </button>
        )}

        <button className="bookmark-icon-button" onClick={() => setPicking((prev) => !prev)} aria-label={t("bookmarks.color")}>
          <Palette size={15} />
        </button>
        <button
          className="bookmark-icon-button"
          onClick={() => {
            setName(folder.name);
            setRenaming(true);
          }}
          aria-label={t("bookmarks.rename")}
        >
          <Pencil size={15} />
        </button>
        {removable && (
          <button
            className="bookmark-icon-button is-danger"
            onClick={() => {
              setPicking(false);
              setConfirming(true);
            }}
            aria-label={t("bookmarks.delete")}
            title={t("bookmarks.delete")}
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>

      {confirming && (
        <div className="bookmark-confirm" role="alertdialog" aria-label={t("bookmarks.confirmAria")}>
          {/* La phrase nomme le dossier et compte ses lieux : ce qu'il contient
              représente parfois des mois de repérages. */}
          <p className="bookmark-confirm-text">
            {folder.places.length === 0
              ? t("bookmarks.confirmEmpty", { folder: folder.name })
              : tp("bookmarks.confirm", folder.places.length, { folder: folder.name })}
          </p>
          <div className="bookmark-confirm-actions">
            <button className="bookmark-confirm-cancel" onClick={() => setConfirming(false)}>
              {t("bookmarks.cancel")}
            </button>
            <button className="bookmark-confirm-delete" onClick={() => bookmarks.deleteFolder(folder.id)}>
              {t("bookmarks.confirmDelete")}
            </button>
          </div>
        </div>
      )}

      {picking && (
        <div className="bookmark-colors" role="radiogroup" aria-label={t("bookmarks.color")}>
          {FOLDER_COLORS.map((color) => (
            <button
              key={color}
              className={`bookmark-color ${color === folder.color ? "is-active" : ""}`}
              style={{ background: color }}
              onClick={() => {
                bookmarks.recolorFolder(folder.id, color);
                setPicking(false);
              }}
              role="radio"
              aria-checked={color === folder.color}
              aria-label={t("bookmarks.colorValue", { color })}
            />
          ))}
        </div>
      )}

      {expanded && (
        <div className="bookmark-places">
          {folder.places.length === 0 && <p className="bookmark-empty">{t("bookmarks.empty")}</p>}
          {folder.places.map((place) => (
            <button key={place.id} className="bookmark-place" onClick={() => onOpenPlace(place)}>
              <MapPin size={14} color={folder.color} />
              <span className="bookmark-place-text">
                <span className="bookmark-place-name">{place.name}</span>
                {place.address && <span className="bookmark-place-addr">{place.address}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface BookmarksMenuProps {
  bookmarks: Bookmarks;
  onOpenPlace: (place: SavedPlace) => void;
  offsetBottom: number;
  /** Vrai quand un menu voisin se déploie par-dessus ce bouton. */
  covered: boolean;
}

// Protégé contre les rendus inutiles (`memo`) : `App` se redessine à chaque
// relevé GPS d'une navigation, et ce composant n'a alors rien de neuf à montrer.
export const BookmarksMenu = memo(function BookmarksMenu({ bookmarks, onOpenPlace, offsetBottom, covered }: BookmarksMenuProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newFolder, setNewFolder] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  useBackClose(open, () => setOpen(false));
  useBackClose(creating, () => setCreating(false));

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

  // Un dossier allumé, ce sont des points posés sur la carte : le signet en
  // prend la couleur et se remplit, pour qu'on sache d'où ils viennent sans
  // ouvrir le menu. Plusieurs dossiers allumés : c'est le premier de la liste
  // qui donne le ton, la pastille ne disant qu'une chose — il y en a.
  const activeFolder = bookmarks.folders.find((folder) => bookmarks.visibleIds.includes(folder.id));

  function confirmNewFolder() {
    bookmarks.createFolder(newFolder);
    setCreating(false);
    setNewFolder("");
  }

  return (
    <div
      className={`bookmarks-menu ${covered ? "is-covered" : ""}`}
      ref={wrapRef}
      style={{ bottom: offsetBottom, "--bookmarks-offset": `${offsetBottom}px` } as React.CSSProperties}
    >
      {open && (
        <div className="bookmarks-panel" role="group" aria-label={t("bookmarks.aria")}>
          <div className="bookmarks-title">{t("bookmarks.aria")}</div>

          <div className="bookmarks-list">
            {bookmarks.folders.map((folder) => (
              <FolderRow
                key={folder.id}
                folder={folder}
                visible={bookmarks.visibleIds.includes(folder.id)}
                bookmarks={bookmarks}
                onOpenPlace={(place) => {
                  setOpen(false);
                  onOpenPlace(place);
                }}
              />
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
      )}

      <button
        className={`bookmarks-button ${open ? "is-open" : ""}`}
        onClick={() => setOpen((prev) => !prev)}
        aria-label={t("bookmarks.aria")}
        aria-expanded={open}
        title={t("bookmarks.aria")}
      >
        {open ? (
          <X size={20} />
        ) : (
          <Bookmark size={20} color={activeFolder?.color} fill={activeFolder ? activeFolder.color : "none"} />
        )}
      </button>
    </div>
  );
});
