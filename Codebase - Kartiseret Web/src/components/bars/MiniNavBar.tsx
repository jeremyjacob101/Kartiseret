import { type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../i18n/I18nContext";
import "./MiniNavBar.css";

type MiniNavBarProps = {
  actions: ReactNode;
  bottomOffset: number | null;
  isOverBottomBar: boolean;
  isVisible: boolean;
  onHomeClick: () => void;
  portalTarget?: HTMLDivElement | null;
  stackRef: RefObject<HTMLDivElement | null>;
};

export function MiniNavBar({
  actions,
  bottomOffset,
  isOverBottomBar,
  isVisible,
  onHomeClick,
  portalTarget,
  stackRef,
}: MiniNavBarProps) {
  const { t } = useI18n();
  const stackStyle =
    bottomOffset === null
      ? undefined
      : ({
          "--floating-navbar-dynamic-bottom": `${bottomOffset}px`,
        } as CSSProperties);

  const content = (
    <div
      ref={stackRef}
      className={`floating-navbar-stack${isVisible ? " is-visible" : ""}${
        isOverBottomBar ? " is-over-bottom-bar" : ""
      }`}
      aria-label={t("nav.quickActions")}
      aria-hidden={!isVisible}
      style={stackStyle}
    >
      <div className="floating-navbar-item floating-navbar-item--home">
        <button
          type="button"
          className="floating-home-button"
          tabIndex={isVisible ? 0 : -1}
          aria-label={t("nav.home")}
          onClick={onHomeClick}
        >
          <span
            className="brand-mark brand-mark--floating-home"
            aria-hidden="true"
          />
        </button>
      </div>
      {actions}
    </div>
  );

  if (typeof document === "undefined" || !portalTarget) {
    return content;
  }

  return createPortal(content, portalTarget);
}
