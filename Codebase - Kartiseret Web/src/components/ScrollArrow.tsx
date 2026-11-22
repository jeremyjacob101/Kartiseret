import { ChevronLeft, ChevronRight } from "lucide-react";
import "./ScrollArrow.css";

type ScrollArrowProps = {
  direction: -1 | 1;
  label: string;
  disabled: boolean;
  onClick: () => void;
};

export function ScrollArrow({
  direction,
  label,
  disabled,
  onClick,
}: ScrollArrowProps) {
  const Icon = direction === -1 ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      className={`scroll-arrow scroll-arrow--${direction === -1 ? "left" : "right"}`}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon aria-hidden="true" size={16} strokeWidth={1.6} />
    </button>
  );
}
