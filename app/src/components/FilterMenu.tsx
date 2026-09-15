import { createElement, useCallback, useEffect, useRef, useState, type CSSProperties, memo } from "react";
import { Check, ChevronDown, Store, X } from "lucide-react";
import { FILTER_GROUPS, type FilterGroupId, type IconNode } from "../filters";
import type { SelectionState } from "../hooks/usePlaceFilters";
import { useI18n } from "../i18n";
import { useBackClose } from "../hooks/useBackClose";

/**
 * Rend un pictogramme de catégorie à partir de sa description (`icon` dans
 * `src/filters.ts`). La carte redessine exactement les mêmes tracés sur un
 * canvas, de sorte que la puce du menu et la pastille sur la carte ne peuvent
 * pas diverger.
 */
function GroupGlyph({ icon, size }: { icon: IconNode; size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {icon.map(([element, attrs], index) => createElement(element, { key: index, ...attrs }))}
    </svg>
  );
}

/**
 * L'ordre du menu : **Transports en tête** (demande explicite), le reste dans
 * l'ordre de `FILTER_GROUPS`. On ne réordonne pas `FILTER_GROUPS` lui-même :
 * son ordre décide du classement des lieux (`groupFromTags`).
 */
const MENU_GROUPS = [
  ...FILTER_GROUPS.filter((group) => group.id === "transport"),
  ...FILTER_GROUPS.filter((group) => group.id !== "transport"),
];

interface FilterMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: SelectionState;
  isSelected: (id: FilterGroupId) => boolean;
  onToggle: (id: FilterGroupId) => void;
  onToggleAll: () => void;
  /** Nombre de catégories cochées, pour la pastille du bouton burger. */
  selectedCount: number;
  /** Hauteur au-dessus du bas de l'écran : le bouton suit la colonne de droite. */
  offsetBottom: number;
  /**
   * Vrai quand le menu des calques est ouvert : son panneau se déploie
   * précisément sur ce bouton, qui s'efface alors plutôt que de flotter par
   * dessus.
   */
  covered: boolean;
}

// Protégé contre les rendus inutiles (`memo`) : `App` se redessine à chaque
// relevé GPS d'une navigation, et ce composant n'a alors rien de neuf à montrer.
export const FilterMenu = memo(function FilterMenu({
  open,
  onOpenChange,
  state,
  isSelected,
  onToggle,
  onToggleAll,
  selectedCount,
  offsetBottom,
  covered,
}: FilterMenuProps) {
  const { t } = useI18n();
  const wrapRef = useRef<HTMLDivElement>(null);

  useBackClose(open, () => onOpenChange(false));

  // Fermeture au clic à l'extérieur et à la touche Échap.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) onOpenChange(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onOpenChange]);

  // Le libellé décrit l'état courant : « Tout », « Aucun », ou le décompte
  // quand seules certaines catégories sont cochées.
  const allLabel =
    state === "all"
      ? t("filterMenu.all")
      : state === "none"
        ? t("filterMenu.none")
        : t("filterMenu.some", { count: selectedCount, total: FILTER_GROUPS.length });

  const listRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(false);
  // Glisser la liste à la souris : un clic maintenu la fait défiler, comme on
  // pousserait une feuille. Le tactile s'en passe, il défile déjà tout seul.
  const drag = useRef<{ y: number; top: number; moved: boolean } | null>(null);
  const swallowClick = useRef(false);

  const updateScrollHint = useCallback(() => {
    const list = listRef.current;
    if (list) setAtBottom(list.scrollHeight - list.clientHeight - list.scrollTop < 8);
  }, []);

  // La mesure est repoussée d'une image : la faire pendant le rendu
  // relancerait aussitôt un rendu.
  const attachList = useCallback(
    (node: HTMLDivElement | null) => {
      listRef.current = node;
      if (node) requestAnimationFrame(updateScrollHint);
    },
    [updateScrollHint]
  );

  function startDrag(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType !== "mouse" || !listRef.current) return;
    // Pas de capture du pointeur à ce stade : elle détournerait le clic vers la
    // liste, et plus aucune catégorie ne pourrait être cochée. Elle n'est prise
    // qu'au premier vrai déplacement, quand il s'agit bien d'un glissement.
    drag.current = { y: e.clientY, top: listRef.current.scrollTop, moved: false };
  }

  function moveDrag(e: React.PointerEvent<HTMLDivElement>) {
    const state = drag.current;
    const list = listRef.current;
    if (!state || !list) return;
    const delta = e.clientY - state.y;
    if (!state.moved && Math.abs(delta) > 3) {
      state.moved = true;
      list.setPointerCapture(e.pointerId);
    }
    if (state.moved) list.scrollTop = state.top - delta;
  }

  function endDrag(e: React.PointerEvent<HTMLDivElement>) {
    const state = drag.current;
    if (!state) return;
    const list = listRef.current;
    if (list?.hasPointerCapture(e.pointerId)) list.releasePointerCapture(e.pointerId);
    // Un glissement ne doit pas cocher la catégorie qui se trouvait sous le
    // curseur au moment du relâchement.
    swallowClick.current = state.moved;
    drag.current = null;
  }

  /** Fait descendre la liste d'un écran, à peu de chose près. */
  function scrollDown() {
    const list = listRef.current;
    if (!list) return;
    list.scrollBy({ top: Math.round(list.clientHeight * 0.8), behavior: "smooth" });
  }

  function guardClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!swallowClick.current) return;
    swallowClick.current = false;
    e.preventDefault();
    e.stopPropagation();
  }

  return (
    // Le panneau précède le bouton : la colonne est ancrée par le bas, le menu
    // s'ouvre donc **au-dessus** du bouton, comme celui des calques.
    // `--filter-offset` reprend cette hauteur pour que la liste ne dépasse
    // jamais du haut de l'écran, fiche ouverte comme fermée.
    <div
      className={`filter-menu ${covered ? "is-covered" : ""}`}
      ref={wrapRef}
      style={{ bottom: offsetBottom, "--filter-offset": `${offsetBottom}px` } as CSSProperties}
    >
      {open && (
        <div className="filter-panel" role="group" aria-label={t("filterMenu.aria")}>
          <div className="filter-panel-title">{t("filterMenu.title")}</div>

          {/* Bascule unique « tout / aucun » : le curseur reflète l'état global
              — plein, vide, ou à mi-course quand la sélection est partielle. */}
          <button className="filter-all" onClick={onToggleAll} role="switch" aria-checked={state === "all"}>
            <span className="filter-all-label">{allLabel}</span>
            <span className={`toggle-switch is-${state}`} aria-hidden="true">
              <span className="toggle-switch-knob" />
            </span>
          </button>

          <div
            className="filter-list"
            ref={attachList}
            onScroll={updateScrollHint}
            onPointerDown={startDrag}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onClickCapture={guardClick}
          >
            {MENU_GROUPS.map((group) => {
              const checked = isSelected(group.id);
              return (
                <button
                  key={group.id}
                  className={`filter-item ${checked ? "is-checked" : ""}`}
                  onClick={() => onToggle(group.id)}
                  role="checkbox"
                  aria-checked={checked}
                >
                  <span className="filter-item-icon" style={{ background: group.color }}>
                    <GroupGlyph icon={group.icon} size={15} />
                  </span>
                  <span className="filter-item-label">{t(group.label)}</span>
                  <span className="filter-item-check">{checked && <Check size={15} strokeWidth={3} />}</span>
                </button>
              );
            })}
          </div>

          {/* Bande de bas de liste : elle indique qu'il reste des catégories
              plus bas et les fait défiler au clic. Elle intercepte le survol,
              de sorte qu'une catégorie à demi recouverte ne s'allume pas sous
              le voile. Elle s'efface une fois la liste au bout. */}
          {!atBottom && (
            <button className="filter-more" onClick={scrollDown} aria-label={t("filterMenu.more")}>
              <ChevronDown size={16} />
            </button>
          )}
        </div>
      )}

      <button
        className={`filter-burger ${open ? "is-open" : ""}`}
        onClick={() => onOpenChange(!open)}
        aria-label={t("filterMenu.button")}
        aria-expanded={open}
        title={t("filterMenu.buttonTitle")}
      >
        {/* Une devanture de magasin plutôt qu'un pictogramme de réglages : ce
            menu ne règle pas l'application, il choisit ce que la carte montre —
            des commerces et des équipements. Le bouton dit ce qu'il ouvre. */}
        {open ? <X size={20} /> : <Store size={20} />}
        {!open && state !== "all" && <span className="filter-burger-badge">{selectedCount}</span>}
      </button>
    </div>
  );
});
