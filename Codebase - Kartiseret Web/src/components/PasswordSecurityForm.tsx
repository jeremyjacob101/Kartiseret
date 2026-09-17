import { getSupabaseBrowserClient } from "../lib/supabase";
import { useState, type FormEvent } from "react";
import { z } from "zod";
import "./PasswordSecurityForm.css";

type PasswordSecurityFormProps = {
  description?: string;
  requireCurrentPassword?: boolean;
  submitLabel?: string;
  successMessage?: string;
  title?: string;
  variant?: "card" | "embedded";
};

const passwordChangeSchema = z
  .object({
    currentPassword: z.string().optional(),
    password: z.string().min(6, "New password must be at least 6 characters."),
    confirmPassword: z.string().min(1, "Confirm your new password."),
  })
  .superRefine((values, context) => {
    if (values.password !== values.confirmPassword) {
      context.addIssue({
        code: "custom",
        path: ["confirmPassword"],
        message: "Passwords do not match.",
      });
    }
  });

const supabase = getSupabaseBrowserClient();

export function PasswordSecurityForm({
  description = "Choose a new password for your account.",
  requireCurrentPassword = false,
  submitLabel = "Update password",
  successMessage = "Password updated.",
  title = "Change password",
  variant = "card",
}: PasswordSecurityFormProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);

    const result = passwordChangeSchema.safeParse({
      currentPassword: requireCurrentPassword ? currentPassword : undefined,
      password,
      confirmPassword,
    });

    if (!result.success) {
      setError(result.error.issues[0]?.message ?? "Enter a valid password.");
      return;
    }

    if (requireCurrentPassword && !result.data.currentPassword) {
      setError("Enter your current password.");
      return;
    }

    setPending(true);
    const updateResult = requireCurrentPassword
      ? await supabase.auth.updateUser({
          password: result.data.password,
          current_password: result.data.currentPassword,
        })
      : await supabase.auth.updateUser({ password: result.data.password });

    setPending(false);

    if (updateResult.error) {
      setError(updateResult.error.message);
      return;
    }

    setCurrentPassword("");
    setPassword("");
    setConfirmPassword("");
    setMessage(successMessage);
  }

  return (
    <section
      className={`password-security-section password-security-section--${variant}`}
      aria-label={title}
    >
      <div className="password-security-header">
        <h2 className="password-security-title">{title}</h2>
        <p className="password-security-description">{description}</p>
      </div>

      <form className="password-security-form" onSubmit={handleSubmit}>
        {requireCurrentPassword ? (
          <label className="password-security-field">
            <span>Current password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => {
                setCurrentPassword(event.target.value);
              }}
              required
            />
          </label>
        ) : null}

        <label className="password-security-field">
          <span>New password</span>
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
            minLength={6}
            required
          />
        </label>

        <label className="password-security-field">
          <span>Confirm new password</span>
          <input
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => {
              setConfirmPassword(event.target.value);
            }}
            minLength={6}
            required
          />
        </label>

        <button
          type="submit"
          className="password-security-submit"
          disabled={pending}
        >
          {pending ? "Updating..." : submitLabel}
        </button>
      </form>

      {message ? (
        <p className="password-security-feedback" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p
          className="password-security-feedback password-security-feedback--error"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </section>
  );
}
