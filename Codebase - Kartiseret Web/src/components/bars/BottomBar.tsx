import { Link } from "react-router";
import "./BottomBar.css";
import { useI18n } from "../../i18n/I18nContext";

export function BottomBar() {
  const { t } = useI18n();

  return (
    <footer className="bottom-bar-shell">
      <div className="bottom-bar" aria-label={t("footer.aria")}>
        <div className="bottom-bar-content">
          <p className="bottom-bar-credit">
            <span className="bottom-bar-credit-line">
              {t("footer.copyright")}
            </span>
          </p>
          <div className="bottom-bar-links" aria-label={t("footer.links")}>
            <Link
              className="bottom-bar-link bottom-bar-link--text"
              to="/attribution"
            >
              {t("footer.attribution")}
            </Link>
            <a
              className="bottom-bar-link"
              href="https://github.com/jeremyjacob101/"
              target="_blank"
              rel="noreferrer"
              aria-label={t("footer.github")}
            >
              <span
                className="bottom-bar-link-icon bottom-bar-link-icon-github"
                aria-hidden="true"
              />
            </a>
            <a
              className="bottom-bar-link"
              href="https://www.linkedin.com/in/jeremyjacob101/"
              target="_blank"
              rel="noreferrer"
              aria-label={t("footer.linkedin")}
            >
              <span
                className="bottom-bar-link-icon bottom-bar-link-icon-linkedin"
                aria-hidden="true"
              />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
