import { type CSSProperties, type ReactNode, type RefObject } from "react";
import "./MiniNavBar.css";

type MiniNavBarProps = {
  actions: ReactNode;
  bottomOffset: number | null;
  isOverBottomBar: boolean;
  isVisible: boolean;
  onHomeClick: () => void;
  stackRef: RefObject<HTMLDivElement | null>;
};

export function MiniNavBar({
  actions,
  bottomOffset,
  isOverBottomBar,
  isVisible,
  onHomeClick,
  stackRef,
}: MiniNavBarProps) {
  const stackStyle =
    bottomOffset === null
      ? undefined
      : ({
          "--floating-navbar-dynamic-bottom": `${bottomOffset}px`,
        } as CSSProperties);

  return (
    <div
      ref={stackRef}
      className={`floating-navbar-stack${isVisible ? " is-visible" : ""}${
        isOverBottomBar ? " is-over-bottom-bar" : ""
      }`}
      aria-label="Quick actions"
      aria-hidden={!isVisible}
      style={stackStyle}
    >
      {actions}
      <div className="floating-navbar-item floating-navbar-item--home">
        <button
          type="button"
          className="floating-home-button"
          aria-label="Go to homepage"
          onClick={onHomeClick}
        >
          <span
            className="brand-mark brand-mark--floating-home"
            aria-hidden="true"
          />
        </button>
      </div>
    </div>
  );
}
