import { useEffect, useState } from "react";
import "./LetterboxdUnsubscribePage.css";

type Source = {
  id: string;
  sourceUrl: string;
  sourceType: "watchlist" | "list";
};

type ApiEnvelope<Data> = {
  data: Data | null;
  error: { message: string } | null;
};

const genericLinkError =
  "This unsubscribe link is invalid or has expired. Open the latest email and try again.";

function readTokenFromFragment(): string | null {
  const parameters = new URLSearchParams(window.location.hash.slice(1));
  const token = parameters.get("token");
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

async function request<Data>(
  path: string,
  token: string,
  init?: RequestInit,
): Promise<Data> {
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");
  headers.set("Authorization", `Bearer ${token}`);
  if (init?.body) headers.set("Content-Type", "application/json");
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    headers,
  });
  const envelope = (await response.json()) as ApiEnvelope<Data>;
  if (!response.ok || envelope.error || envelope.data === null) {
    throw new Error(
      response.status === 404
        ? genericLinkError
        : (envelope.error?.message ?? "The request could not be completed."),
    );
  }
  return envelope.data;
}

function sourceLabel(source: Source): string {
  try {
    const url = new URL(source.sourceUrl);
    const path = url.pathname.replace(/^\/+|\/+$/g, "");
    return (
      path ||
      (source.sourceType === "watchlist" ? "Watchlist" : "Letterboxd list")
    );
  } catch {
    return source.sourceType === "watchlist" ? "Watchlist" : "Letterboxd list";
  }
}

export function LetterboxdUnsubscribePage() {
  const [token] = useState<string | null>(() =>
    typeof window === "undefined" ? null : readTokenFromFragment());
  const [sources, setSources] = useState<Source[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(Boolean(token));
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(
    token ? null : genericLinkError,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);

  useEffect(() => {
    document.title = "Manage Letterboxd alerts · Kartiseret";
    let referrerMeta = document.querySelector<HTMLMetaElement>(
      'meta[name="referrer"]',
    );
    const createdReferrerMeta = !referrerMeta;
    if (!referrerMeta) {
      referrerMeta = document.createElement("meta");
      referrerMeta.name = "referrer";
      document.head.append(referrerMeta);
    }
    const activeReferrerMeta = referrerMeta;
    const oldReferrerContent = activeReferrerMeta.content;
    activeReferrerMeta.content = "no-referrer";
    let robotsMeta = document.querySelector<HTMLMetaElement>(
      'meta[name="robots"]',
    );
    const createdRobotsMeta = !robotsMeta;
    if (!robotsMeta) {
      robotsMeta = document.createElement("meta");
      robotsMeta.name = "robots";
      document.head.append(robotsMeta);
    }
    const activeRobotsMeta = robotsMeta;
    const oldRobotsContent = activeRobotsMeta.content;
    activeRobotsMeta.content = "noindex, nofollow, noarchive";
    // The token lives in the URL fragment, so it was not sent to the server.
    // Remove it from browser history as soon as it has been captured in memory.
    window.history.replaceState(null, "", window.location.pathname);
    return () => {
      if (createdReferrerMeta) referrerMeta?.remove();
      else activeReferrerMeta.content = oldReferrerContent;
      if (createdRobotsMeta) activeRobotsMeta.remove();
      else activeRobotsMeta.content = oldRobotsContent;
    };
  }, []);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    request<{ sources: Source[] }>("/api/v1/unsubscribe/letterboxd", token)
      .then(({ sources: nextSources }) => {
        if (!cancelled) {
          setSources(nextSources);
          setSelected([]);
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : genericLinkError);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, refreshCount]);

  function toggle(sourceId: string) {
    setSelected((current) =>
      current.includes(sourceId)
        ? current.filter((id) => id !== sourceId)
        : [...current, sourceId]);
    setNotice(null);
  }

  async function removeSelected() {
    if (!token || selected.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const { removed } = await request<{ removed: Source[] }>(
        "/api/v1/unsubscribe/letterboxd",
        token,
        { method: "POST", body: JSON.stringify({ sourceIds: selected }) },
      );
      setConfirming(false);
      setSelected([]);
      setNotice(
        removed.length
          ? `Removed: ${removed.map(sourceLabel).join(", ")}. You can connect lists again from account settings.`
          : "Those lists were already removed. You can connect lists again from account settings.",
      );
      setLoading(true);
      setRefreshCount((current) => current + 1);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The lists could not be removed. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="letterboxd-unsubscribe-page">
      <section
        className="letterboxd-unsubscribe-card"
        aria-labelledby="unsubscribe-title"
      >
        <p className="letterboxd-unsubscribe-kicker">
          KARTISERET · EMAIL PREFERENCES
        </p>
        <h1 id="unsubscribe-title">Manage Letterboxd list alerts</h1>
        <p className="letterboxd-unsubscribe-intro">
          Choose which connected Letterboxd lists should stop generating movie
          alerts.
        </p>
        <p className="letterboxd-unsubscribe-detail">
          Removing a list disconnects it from Kartiseret. Individual movie
          watches and your other connected lists stay active.
        </p>

        {loading ? (
          <p
            className="letterboxd-unsubscribe-status"
            role="status"
            aria-busy="true"
          >
            Loading your connected lists…
          </p>
        ) : null}
        {error ? (
          <div className="letterboxd-unsubscribe-error" role="alert">
            <p>{error}</p>
            {token ? (
              <button
                className="letterboxd-unsubscribe-secondary"
                type="button"
                disabled={submitting}
                onClick={() => {
                  setError(null);
                  setNotice(null);
                  setConfirming(false);
                  setSelected([]);
                  setLoading(true);
                  setRefreshCount((current) => current + 1);
                }}
              >
                Try again
              </button>
            ) : null}
          </div>
        ) : null}
        {notice ? (
          <p className="letterboxd-unsubscribe-success" role="status">
            {notice}
          </p>
        ) : null}

        {!loading && !error && sources.length === 0 ? (
          <p className="letterboxd-unsubscribe-empty" role="status">
            No connected Letterboxd lists remain. Individual movie watches are
            unchanged.
          </p>
        ) : null}

        {!loading && !error && sources.length > 0 && !confirming ? (
          <>
            <fieldset className="letterboxd-unsubscribe-list">
              <legend>Connected lists</legend>
              {sources.map((source) => (
                <label className="letterboxd-unsubscribe-row" key={source.id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(source.id)}
                    onChange={() => toggle(source.id)}
                  />
                  <span>
                    <strong>{sourceLabel(source)}</strong>
                    <small>
                      {source.sourceType === "watchlist" ? "Watchlist" : "List"}
                    </small>
                  </span>
                </label>
              ))}
            </fieldset>
            <button
              className="letterboxd-unsubscribe-primary"
              type="button"
              disabled={selected.length === 0}
              onClick={() => setConfirming(true)}
            >
              Remove selected lists
            </button>
          </>
        ) : null}

        {!loading && !error && confirming ? (
          <div className="letterboxd-unsubscribe-confirm" aria-live="polite">
            <h2>Remove these lists?</h2>
            <ul>
              {sources
                .filter((source) => selected.includes(source.id))
                .map((source) => (
                  <li key={source.id}>{sourceLabel(source)}</li>
                ))}
            </ul>
            <p>Alerts supported only by these lists will stop.</p>
            <div className="letterboxd-unsubscribe-actions">
              <button
                className="letterboxd-unsubscribe-secondary"
                type="button"
                disabled={submitting}
                onClick={() => setConfirming(false)}
              >
                Go back
              </button>
              <button
                className="letterboxd-unsubscribe-primary"
                type="button"
                disabled={submitting}
                onClick={() => void removeSelected()}
              >
                {submitting ? "Removing…" : "Confirm removal"}
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
