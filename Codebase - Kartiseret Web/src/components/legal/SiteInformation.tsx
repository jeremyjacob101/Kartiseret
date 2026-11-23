import { cinemathequeSources, mapDataSources, ratingSources, theaterChainSources } from "./creditSources";
import { supportEmail, type SiteInformationPage } from "../../routing/siteInformation";
import mitLicenseUrl from "../../../../LICENSE.md?url&no-inline";
import { Link, useLocation } from "react-router";
import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect } from "react";
import "./SiteInformation.css";

type InformationSection = {
  id: string;
  title: string;
  content: ReactNode;
};

type InformationDocument = {
  intro: string;
  updated?: { date: string; label: string };
  sections: InformationSection[];
};

function EmailLink({
  topic,
  children,
}: {
  topic: string;
  children: ReactNode;
}) {
  return (
    <a
      href={`mailto:${supportEmail}?subject=${encodeURIComponent(`Kartiseret · ${topic}`)}`}
    >
      {children}
    </a>
  );
}

function SourceLinks({
  sources,
}: {
  sources: readonly {
    name: string;
    href: string;
    logoSrc: string;
    darkLogo?: boolean;
  }[];
}) {
  return (
    <ul className="site-info-sources">
      {sources.map(({ name, href, logoSrc, darkLogo }) => (
        <li key={name}>
          <a href={href} target="_blank" rel="noreferrer">
            <span className="site-info-source-logo">
              <img
                src={logoSrc}
                alt=""
                loading="lazy"
                className={darkLogo ? "site-info-source-logo--dark" : undefined}
              />
            </span>
            <span>{name}</span>
            <ArrowUpRight size={15} aria-hidden="true" />
          </a>
        </li>
      ))}
    </ul>
  );
}

const documents: Record<SiteInformationPage["path"], InformationDocument> = {
  "/support": {
    intro: "Get help with Kartiseret or tell me what needs fixing.",
    sections: [
      {
        id: "contact",
        title: "Contact",
        content: (
          <p>
            Kartiseret is operated by Jeremy Jacob. Email{" "}
            <EmailLink topic="Support">{supportEmail}</EmailLink> for help with
            the website or iOS app.
          </p>
        ),
      },
      {
        id: "showtime-corrections",
        title: "Showtimes and corrections",
        content: (
          <p>
            For an incorrect listing or broken booking link, send the movie,
            cinema, date and time, and the Kartiseret page link. A link to the
            cinema’s listing is helpful.{" "}
            <EmailLink topic="Listing correction">
              Report a listing issue
            </EmailLink>
            .
          </p>
        ),
      },
      {
        id: "bookings",
        title: "Tickets and refunds",
        content: (
          <p>
            Contact the cinema or ticket seller listed on your confirmation for
            payments, changes, cancellations, refunds, and seat or venue
            accessibility questions.
          </p>
        ),
      },
      {
        id: "accounts-and-alerts",
        title: "Accounts and alerts",
        content: (
          <p>
            Manage alerts and account security in{" "}
            <Link to="/user">User Preferences</Link>. For trouble signing in or
            receiving an alert, describe what happened and when. Please leave
            passwords, verification codes, and payment details out of your
            email.{" "}
            <EmailLink topic="Account or alert help">
              Get account help
            </EmailLink>
            .
          </p>
        ),
      },
    ],
  },
  "/accessibility": {
    intro: "I want everyone to be able to find a film and plan a cinema visit.",
    updated: { date: "2026-11-23", label: "23 November 2026" },
    sections: [
      {
        id: "commitment",
        title: "Our commitment",
        content: (
          <p>
            Kartiseret is a free, independently run personal project. I’m doing
            everything I can to make the website and iOS app as accessible as
            possible. I’ll keep working to meet the accessibility requirements
            that apply and update this statement as I make improvements.
          </p>
        ),
      },
      {
        id: "israeli-accessibility-rules",
        title: "Israeli accessibility rules",
        content: (
          <>
            <p>
              I’m including the regulation here for reference. Kartiseret earns
              no revenue and has no ads, paid subscriptions, or booking
              commissions. Based on how the project operates today, my
              understanding is that the low-turnover exemption in Regulation{" "}
              <bdi dir="rtl" lang="he">
                35ו(ז)
              </bdi>{" "}
              may apply. The regulation provides a separate turnover route
              alongside the VAT-exempt dealer route:
            </p>
            <blockquote lang="he" dir="rtl">
              או שהמחזור השנתי הממוצע שלו אינו עולה על 100,000 שקלים חדשים, יהיה
              פטור מביצוע התאמות נגישות לפי סימן זה.
            </blockquote>
            <p>
              In English, the quoted provision exempts a service provider whose
              average annual turnover does not exceed ₪100,000 from the internet
              accessibility adjustments in that section. Regulation 35 defines
              qualifying turnover at the operator level. I’ll revisit how the
              exemption applies if the project’s circumstances change.
            </p>
            <p>
              <a href="https://www.osh.org.il/UploadedImages/10_2017/kt_7876.pdf#page=7">
                Published regulation in Hebrew
              </a>{" "}
              ·{" "}
              <a href="https://www.gov.il/en/pages/website_accessibility">
                Israeli internet accessibility guidance
              </a>
            </p>
          </>
        ),
      },
      {
        id: "available-features",
        title: "Features available today",
        content: (
          <ul>
            <li>
              On the website, you can tab through the main navigation and use
              the arrow keys to change films or Escape to close an open film in
              the movie carousel.
            </li>
            <li>
              The website’s movie carousel respects the system’s reduced-motion
              setting for some animations.
            </li>
            <li>
              The iOS app includes accessibility labels for movie cards,
              ratings, showtime filters, and booking controls.
            </li>
          </ul>
        ),
      },
      {
        id: "current-limitations",
        title: "Current limitations",
        content: (
          <p>
            A full accessibility audit of the website and iOS app is pending.
            Some interactions, including maps and embedded trailers, may be
            harder to use with assistive technology. Cinema booking pages are
            operated by the ticket sellers.
          </p>
        ),
      },
      {
        id: "accessibility-help",
        title: "Report an accessibility problem",
        content: (
          <p>
            Please email{" "}
            <EmailLink topic="Accessibility">{supportEmail}</EmailLink> if
            something gets in your way or you need help finding a screening. If
            you can, include the page or screen, what you were trying to do, and
            your device or assistive technology. I’ll look into it as soon as I
            can and help you find another way to get the information in the
            meantime. <strong>Jeremy Jacob</strong> is the accessibility
            contact.
          </p>
        ),
      },
    ],
  },
  "/privacy": {
    intro:
      "How Kartiseret handles information when you browse, create an account, or sign up for alerts.",
    updated: { date: "2026-11-23", label: "23 November 2026" },
    sections: [
      {
        id: "operator",
        title: "Who handles your information",
        content: (
          <p>
            Jeremy Jacob operates Kartiseret and is responsible for the personal
            information described here. This policy covers the website and iOS
            app. For privacy questions or requests, email{" "}
            <EmailLink topic="Privacy">{supportEmail}</EmailLink>.
          </p>
        ),
      },
      {
        id: "accounts",
        title: "Accounts and preferences",
        content: (
          <p>
            You can browse listings without an account. If you choose to
            register by email, we use your name, email address, password hash,
            account status, and session information to verify your email, sign
            you in, secure the account, and help you recover it. If you use
            Google or Apple sign-in, we receive the account identifiers and
            profile details the provider shares. We use your saved city, display
            preferences, and movie settings to personalize your experience and
            sync it across supported devices. Providing account information is
            voluntary and required to use account features such as synced
            preferences and alerts.
          </p>
        ),
      },
      {
        id: "device-storage",
        title: "Cookies, device storage and location",
        content: (
          <>
            <p>
              The website uses session cookies to keep you signed in and browser
              storage to remember choices such as your city, theme, and showtime
              filters. You can clear this data in your browser. The iOS app
              keeps sign-in credentials in the iOS Keychain and stores
              preferences on the device.
            </p>
            <p>
              On the web, choosing the nearest-city option asks your browser for
              your location. The website uses the coordinates on your device to
              match a city and saves the selected city as a preference. You can
              pick a city manually and manage location access in your browser
              settings.
            </p>
          </>
        ),
      },
      {
        id: "email",
        title: "Account emails and movie alerts",
        content: (
          <p>
            We use your email to deliver verification, password reset, and
            deletion messages. If you set up movie alerts, we use your email,
            alert settings, watched titles, and any public Letterboxd list you
            connect to check for updates, send alerts and avoid duplicate
            deliveries. Change or remove alerts in{" "}
            <Link to="/user">User Preferences</Link>, or use the unsubscribe
            option when provided in an alert email.
          </p>
        ),
      },
      {
        id: "providers",
        title: "Hosting, analytics and other services",
        content: (
          <>
            <p>
              Vercel serves the website and API, Supabase hosts the database,
              and Resend delivers emails on our behalf. Requests can include
              technical information such as IP address, user agent, and
              timestamps, which our infrastructure can use to deliver the
              service, diagnose errors and limit abuse. Providers may process
              information outside Israel.
            </p>
            <p>
              On the website, Vercel Web Analytics measures visits using
              information such as pages viewed, referrer, browser, device and
              approximate region. It uses no analytics cookies. Map requests go
              to CARTO and trailer requests go to YouTube’s privacy-enhanced
              player. These providers receive technical request information when
              their content loads. Google and Apple handle authentication if you
              choose their sign-in option. If you follow a cinema booking link,
              the seller handles information you provide there under its own
              policy.
            </p>
            <p>
              We may also disclose information when required by law or to
              protect the security of the service.
            </p>
          </>
        ),
      },
      {
        id: "retention",
        title: "How long information is kept",
        content: (
          <p>
            Account details, synced preferences and subscriptions are kept while
            your account is active or until you remove the relevant data. Web
            sessions expire 30 days after sign-in or the most recent renewal.
            Guest preferences can remain on your device until cleared or
            replaced. Account deletion removes the account and account-linked
            settings and alerts from the active database. Backup copies,
            security logs, email delivery records and support correspondence may
            persist for the time needed for recovery, security, delivery
            troubleshooting, support, or legal obligations.
          </p>
        ),
      },
      {
        id: "your-choices",
        title: "Access, correction and account deletion",
        content: (
          <p>
            To ask to see or correct your personal information, request
            deletion, or raise a privacy concern, email{" "}
            <EmailLink topic="Privacy request">{supportEmail}</EmailLink>. To
            delete your account yourself, open{" "}
            <Link to="/user">User Preferences</Link>, choose{" "}
            <strong>Sign-in &amp; security</strong> and follow the{" "}
            <strong>Delete account</strong> steps, including the confirmation
            email.
          </p>
        ),
      },
    ],
  },
  "/terms": {
    intro:
      "What to expect when you browse Kartiseret, follow a booking link, or set up a movie alert.",
    updated: { date: "2026-11-23", label: "23 November 2026" },
    sections: [
      {
        id: "the-service",
        title: "Using Kartiseret",
        content: (
          <p>
            Kartiseret, operated by Jeremy Jacob, brings together movie listings
            and showtimes from cinemas and other sources. Listings may be
            incomplete, delayed, inaccurate, or changed by the venue. Check the
            cinema’s listing for the time, venue, language, format,
            accessibility, and availability before making plans.{" "}
            <Link to="/support#showtime-corrections">Report a correction</Link>.
          </p>
        ),
      },
      {
        id: "ticket-purchases",
        title: "Ticket purchases",
        content: (
          <p>
            Booking links take you to the cinema or another ticket seller. The
            seller sets prices and fees, takes payment, issues tickets, and
            handles seating, booking changes, cancellations and refunds under
            its own terms. For purchase issues, contact the seller on your
            booking confirmation.
          </p>
        ),
      },
      {
        id: "movie-alerts",
        title: "Movie alerts",
        content: (
          <p>
            Alerts are informational. They can be delayed, and screenings or
            release dates can change before an alert arrives. An alert does not
            hold a seat or guarantee availability. Manage your alert choices in{" "}
            <Link to="/user">User Preferences</Link>.
          </p>
        ),
      },
      {
        id: "acceptable-use",
        title: "Acceptable use",
        content: (
          <p>
            Use the service lawfully and respect other users and rights holders.
            Keep your account credentials private. Avoid impersonation, attempts
            to access someone else’s account, bypassing service limits, or
            automated traffic that disrupts the service. Access may be limited
            to protect the service and its users.
          </p>
        ),
      },
      {
        id: "rights-and-changes",
        title: "Rights and changes",
        content: (
          <p>
            See{" "}
            <Link to="/attribution#licenses-and-rights">
              Licenses &amp; rights
            </Link>{" "}
            before reusing material. Kartiseret may change or discontinue
            features and will post updates to these terms on this page. Your
            rights under applicable law continue to apply. For questions,
            contact <EmailLink topic="Terms">{supportEmail}</EmailLink>.
          </p>
        ),
      },
    ],
  },
  "/attribution": {
    intro:
      "The people, cinema listings, film databases, maps and software behind Kartiseret.",
    sections: [
      {
        id: "project",
        title: "Kartiseret",
        content: (
          <p>
            Created and operated by Jeremy Jacob.{" "}
            <a
              href="https://github.com/jeremyjacob101/"
              target="_blank"
              rel="noreferrer"
            >
              GitHub
            </a>{" "}
            ·{" "}
            <a
              href="https://www.linkedin.com/in/jeremyjacob101/"
              target="_blank"
              rel="noreferrer"
            >
              LinkedIn
            </a>
          </p>
        ),
      },
      {
        id: "movie-data",
        title: "Movie data and ratings",
        content: (
          <>
            <p>
              This product uses the TMDB API but is not endorsed or certified by
              TMDB.
            </p>
            <p>
              Film metadata, posters, and backdrops are sourced through TMDB.
              Ratings are attributed to their respective providers. Trailers
              play through YouTube.
            </p>
            <SourceLinks sources={ratingSources} />
          </>
        ),
      },
      {
        id: "cinemas",
        title: "Cinemas and cinematheques",
        content: (
          <>
            <p>
              Showtimes and venue details are compiled from cinema and
              cinematheque websites. Check the venue’s listing for the latest
              details.
            </p>
            <h3>Cinema chains</h3>
            <SourceLinks sources={theaterChainSources} />
            <h3>Cinematheques and independent venues</h3>
            <SourceLinks sources={cinemathequeSources} />
          </>
        ),
      },
      {
        id: "maps",
        title: "Maps",
        content: (
          <>
            <p>
              The website’s theater map uses CARTO basemaps and © OpenStreetMap
              contributors.
            </p>
            <SourceLinks sources={mapDataSources} />
          </>
        ),
      },
      {
        id: "licenses-and-rights",
        title: "Licenses & rights",
        content: (
          <>
            <p>
              Kartiseret’s code is licensed under the{" "}
              <a href={mitLicenseUrl}>MIT License</a>. See the{" "}
              <a href="/third-party-licenses.txt">
                third-party software notices
              </a>{" "}
              for the web build. The website uses system fonts.
            </p>
            <p>
              Film artwork, trailers, ratings, cinema logos, and other
              third-party materials remain subject to their respective rights
              and licenses. To flag a rights or attribution issue, email{" "}
              <EmailLink topic="Rights or attribution">
                {supportEmail}
              </EmailLink>{" "}
              with the Kartiseret URL, the work in question, and details of your
              request.
            </p>
          </>
        ),
      },
    ],
  },
};

export default function SiteInformation({
  page,
}: {
  page: SiteInformationPage;
}) {
  const { hash } = useLocation();
  const title = "title" in page ? page.title : page.label;
  const { intro, sections, updated } = documents[page.path];

  useEffect(() => {
    if (hash) {
      document.getElementById(hash.slice(1))?.scrollIntoView();
    } else {
      window.scrollTo({ top: 0, behavior: "instant" });
    }
  }, [hash, page.path]);

  return (
    <article className="site-info" aria-labelledby="site-info-title">
      <header className="site-info-header">
        <h1 id="site-info-title">{title}</h1>
        <p>{intro}</p>
        {updated ? (
          <p className="site-info-date">
            Last updated <time dateTime={updated.date}>{updated.label}</time>
          </p>
        ) : null}
      </header>
      <div className="site-info-layout">
        <aside>
          <nav className="site-info-index" aria-label="On this page">
            <h2>On this page</h2>
            <ul>
              {sections.map(({ id, title }) => (
                <li key={id}>
                  <a href={`#${id}`}>{title}</a>
                </li>
              ))}
            </ul>
          </nav>
        </aside>
        <div className="site-info-sections">
          {sections.map(({ id, title, content }) => (
            <section
              className="site-info-section"
              key={id}
              id={id}
              aria-labelledby={`${id}-title`}
            >
              <h2 id={`${id}-title`}>{title}</h2>
              {content}
            </section>
          ))}
        </div>
      </div>
    </article>
  );
}
