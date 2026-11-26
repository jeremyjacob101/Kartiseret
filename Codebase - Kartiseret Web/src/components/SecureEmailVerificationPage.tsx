import { PublicRouteLink } from "../routing/PublicRouteLink";
import { useEffect, useState } from "react";

type VerificationState = "checking" | "verified" | "invalid";

export function SecureEmailVerificationPage({ token }: { token: string }) {
  const [state, setState] = useState<VerificationState>("checking");

  useEffect(() => {
    let active = true;
    const query = new URLSearchParams({ token });
    void fetch(`/api/auth/verify-email?${query}`, {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) return false;
        const body = (await response.json()) as { status?: unknown };
        return body.status === true;
      })
      .then((verified) => {
        if (active) setState(verified ? "verified" : "invalid");
      })
      .catch(() => {
        if (active) setState("invalid");
      });
    return () => {
      active = false;
    };
  }, [token]);

  return (
    <section className="page-panel" aria-label="Email verification">
      <p className="section-kicker">Account security</p>
      <h1 className="section-title">
        {state === "checking"
          ? "Checking your email link…"
          : state === "verified"
            ? "Email verified"
            : "This email link is invalid or expired"}
      </h1>
      {state === "verified" ? (
        <p>Your Kartiseret email address is confirmed.</p>
      ) : state === "invalid" ? (
        <p>Request a new verification email and try again.</p>
      ) : (
        <p role="status">Please keep this page open for a moment.</p>
      )}
      {state !== "checking" ? (
        <PublicRouteLink to="/">Continue to Kartiseret</PublicRouteLink>
      ) : null}
    </section>
  );
}
