import { Languages } from "lucide-react";
import { useI18n } from "../i18n/I18nContext";
import "./LanguageToggle.css";

type LanguageToggleProps = {
  className?: string;
  compact?: boolean;
  showCurrentLanguage?: boolean;
  tabIndex?: number;
};

export function LanguageToggle({
  className,
  compact = false,
  showCurrentLanguage = false,
  tabIndex,
}: LanguageToggleProps) {
  const { locale, toggleLocale, t } = useI18n();
  const nextLocale = locale === "en" ? "he" : "en";
  const currentLanguage = t(`language.name.${locale}`);
  const nextLanguage = t(`language.name.${nextLocale}`);
  const label = t(`language.switchTo.${nextLocale}`);

  return (
    <button
      type="button"
      className={[
        "language-toggle",
        compact ? "language-toggle--compact" : null,
        showCurrentLanguage ? "language-toggle--expanded" : null,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={label}
      title={label}
      tabIndex={tabIndex}
      onClick={toggleLocale}
    >
      <Languages
        size={20}
        strokeWidth={2.6}
        className="app-accent-icon language-toggle-icon"
        aria-hidden="true"
      />
      <span className="language-toggle-label" dir="auto">
        {showCurrentLanguage ? currentLanguage : nextLanguage}
      </span>
      {showCurrentLanguage ? (
        <span className="visually-hidden">
          {t("language.current", { language: currentLanguage })}
        </span>
      ) : null}
    </button>
  );
}
