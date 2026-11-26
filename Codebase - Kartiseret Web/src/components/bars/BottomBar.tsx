import { usePublicRouteLocation } from "../../routing/PublicRouteLocation";
import { siteInformationPages } from "../../routing/siteInformation";
import { PublicRouteLink } from "../../routing/PublicRouteLink";
import "./BottomBar.css";

export function BottomBar() {
  const { pathname } = usePublicRouteLocation();
  const year = new Date().toLocaleString("en", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
  });

  return (
    <footer className="bottom-bar-shell">
      <div className="bottom-bar">
        <nav className="bottom-bar-links" aria-label="Footer">
          {siteInformationPages.map(({ path, label }) => (
            <PublicRouteLink
              key={path}
              className="bottom-bar-link"
              to={path}
              aria-current={pathname === path ? "page" : undefined}
            >
              {label}
            </PublicRouteLink>
          ))}
        </nav>
        <div className="bottom-bar-identity">
          <p className="bottom-bar-credit">©{year} Kartiseret</p>
          <a
            className="bottom-bar-profile"
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
            className="bottom-bar-profile"
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
    </footer>
  );
}
