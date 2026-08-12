import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Armchair, Glasses, Languages, ListFilter, TvMinimal } from "lucide-react";
import { type ShowtimeFilterOptions, type ShowtimeFilterSelections } from "./showtimeFilters";
import "./ShowtimeFilterMenu.css";
import { useI18n } from "../../i18n/I18nContext";
import { localizeFilterOption } from "../../i18n/content";
import type { MessageKey } from "../../i18n/messages";

type FilterGroup = keyof ShowtimeFilterOptions;

type ShowtimeFilterMenuProps = {
  className?: string;
  options: ShowtimeFilterOptions;
  selections: ShowtimeFilterSelections;
  onToggleOption: (group: FilterGroup, value: string) => void;
  onToggleGroup: (group: FilterGroup) => void;
};

const FILTER_GROUP_COPY: Array<{
  group: FilterGroup;
  icon: typeof Armchair;
  labelKey: MessageKey;
}> = [
  { group: "showType", icon: Armchair, labelKey: "filters.showType" },
  { group: "screenFormat", icon: Glasses, labelKey: "filters.screenFormat" },
  {
    group: "screeningTech",
    icon: TvMinimal,
    labelKey: "filters.screeningTech",
  },
  { group: "dubLanguage", icon: Languages, labelKey: "filters.dubLanguage" },
];

export function ShowtimeFilterMenu({
  className,
  options,
  selections,
  onToggleOption,
  onToggleGroup,
}: ShowtimeFilterMenuProps) {
  const { isRtl, locale, t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [panelStyle, setPanelStyle] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const panelId = useId();

  useLayoutEffect(() => {
    if (!isOpen) {
      return;
    }

    const updatePanelPosition = () => {
      const trigger = triggerRef.current;

      if (!trigger) {
        return;
      }

      const triggerRect = trigger.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const panelWidth = Math.min(320, viewportWidth - 24);
      const estimatedPanelHeight =
        panelRef.current?.getBoundingClientRect().height ??
        Math.min(540, viewportHeight * 0.68);
      const maxTop = Math.max(8, viewportHeight - estimatedPanelHeight - 8);
      const desiredTop = triggerRect.bottom + 10;
      const desiredLeft = isRtl
        ? triggerRect.left
        : triggerRect.right - panelWidth;

      setPanelStyle({
        top: Math.min(maxTop, Math.max(8, desiredTop)),
        left: Math.min(
          viewportWidth - panelWidth - 8,
          Math.max(8, desiredLeft),
        ),
        width: panelWidth,
      });
    };

    updatePanelPosition();
    const positionFrame = window.requestAnimationFrame(updatePanelPosition);

    window.addEventListener("resize", updatePanelPosition);
    window.addEventListener("scroll", updatePanelPosition, true);

    return () => {
      window.cancelAnimationFrame(positionFrame);
      window.removeEventListener("resize", updatePanelPosition);
      window.removeEventListener("scroll", updatePanelPosition, true);
    };
  }, [isOpen, isRtl]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;

      if (!(target instanceof Node)) {
        return;
      }

      const clickedInsideTriggerShell =
        menuRef.current?.contains(target) ?? false;
      const clickedInsidePanel = panelRef.current?.contains(target) ?? false;

      if (!clickedInsideTriggerShell && !clickedInsidePanel) {
        setIsOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    window.addEventListener("pointerdown", handleOutsidePointerDown);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("pointerdown", handleOutsidePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  return (
    <div
      className={["showtime-filter-shell", className].filter(Boolean).join(" ")}
      ref={menuRef}
    >
      <button
        ref={triggerRef}
        type="button"
        className={["showtime-filter-trigger", isOpen ? "is-open" : null]
          .filter(Boolean)
          .join(" ")}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={panelId}
        aria-label={t("filters.open")}
        onClick={() => {
          setIsOpen((open) => !open);
        }}
      >
        <span className="theater-map-trigger-icon">
          <ListFilter
            size={20}
            strokeWidth={2.75}
            className="app-accent-icon"
          />
        </span>
      </button>

      {isOpen && panelStyle && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={panelRef}
              id={panelId}
              className="showtime-filter-panel"
              role="dialog"
              aria-label={t("filters.title")}
              style={{
                top: `${panelStyle.top}px`,
                left: `${panelStyle.left}px`,
                width: `${panelStyle.width}px`,
              }}
            >
              {FILTER_GROUP_COPY.map(({ group, icon: GroupIcon, labelKey }) => {
                const groupOptions = options[group];
                const selectedValues = selections[group];
                const groupLabel = t(labelKey);
                const allSelected =
                  groupOptions.length > 0 &&
                  groupOptions.every((value) => selectedValues.has(value));

                if (groupOptions.length === 0) {
                  return null;
                }

                return (
                  <section
                    key={group}
                    className="showtime-filter-group"
                    aria-label={t("filters.group", { group: groupLabel })}
                  >
                    <div className="showtime-filter-options">
                      <button
                        type="button"
                        className={`showtime-filter-group-icon${allSelected ? " is-selected" : ""}`}
                        aria-label={
                          allSelected
                            ? t("filters.unselectAll", { group: groupLabel })
                            : t("filters.selectAll", { group: groupLabel })
                        }
                        aria-pressed={allSelected}
                        onClick={() => {
                          onToggleGroup(group);
                        }}
                      >
                        <GroupIcon size={17} strokeWidth={2.3} />
                      </button>
                      {groupOptions.map((value) => {
                        const checked = selectedValues.has(value);

                        return (
                          <button
                            key={`${group}-${value}`}
                            type="button"
                            className={`showtime-filter-option${checked ? " is-selected" : ""}`}
                            aria-pressed={checked}
                            onClick={() => {
                              onToggleOption(group, value);
                            }}
                          >
                            <span dir="auto">
                              {localizeFilterOption(value, locale)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
