import "./BottomBar.css";

export function BottomBar() {
  return (
    <footer className="bottom-bar-shell">
      <div className="bottom-bar" aria-label="Site footer">
        <div className="bottom-bar-content">
          <p className="bottom-bar-credit">
            <span className="bottom-bar-credit-line">©2026 Kartiseret</span>
          </p>
          <div className="bottom-bar-links" aria-label="Social links">
            <a
              className="bottom-bar-link"
              href="https://github.com/jeremyjacob101/"
              target="_blank"
              rel="noreferrer"
              aria-label="Jeremy Jacob on GitHub"
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
              aria-label="Jeremy Jacob on LinkedIn"
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
