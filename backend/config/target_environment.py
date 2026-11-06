"""Select and validate the Supabase and R2 profile for one pipeline run."""

from __future__ import annotations

from collections.abc import Mapping
import re
from urllib.parse import unquote, urlsplit


TARGETS = ("development", "production")
PROJECT_REFS = {
    "development": "jbydpmjjptwevyijarzl",
    "production": "gsdrcyrduxbrxgsvhxvr",
}
BUCKETS = {
    "development": "kartiseret-artwork-dev",
    "production": "kartiseret-artwork-prod",
}
RUN_ARTIFACT_BUCKETS = {
    "development": "kartiseret-run-artifacts-dev",
    "production": "kartiseret-run-artifacts-prod",
}
D1_DATABASE_IDS = {
    "development": "dbace3cc-386d-42f4-8ab9-0863f17adcfc",
    # Production is provisioned separately; validate its UUID shape and the
    # dedicated database name through setup instructions after approval.
    "production": None,
}

PROFILE_KEYS = (
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_PUBLISHABLE_KEY",
    "DATABASE_URL",
    "DATABASE_SSL_CA_CERT",
    "DATABASE_POOL_MAX",
    "PUBLICATION_DATABASE_URL",
    "PUBLICATION_DATABASE_SSL_CA_CERT",
    "RESEND_API_KEY",
    "TICKET_ALERT_RECIPIENT_API_URL",
    "TICKET_ALERT_INTERNAL_API_SECRET",
    "R2_BUCKET",
    "R2_IMAGE_ORIGIN",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_READ_ACCESS_KEY_ID",
    "R2_READ_SECRET_ACCESS_KEY",
    "D1_DATABASE_ID",
    "D1_API_TOKEN",
    "RUN_ARTIFACTS_R2_BUCKET",
    "RUN_ARTIFACTS_R2_ACCESS_KEY_ID",
    "RUN_ARTIFACTS_R2_SECRET_ACCESS_KEY",
)

WRITE_R2_KEYS = (
    "R2_IMAGE_ORIGIN",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
)
READ_R2_KEYS = ("R2_READ_ACCESS_KEY_ID", "R2_READ_SECRET_ACCESS_KEY")
ALL_R2_KEYS = (
    "R2_ACCOUNT_ID",
    "R2_BUCKET",
    *WRITE_R2_KEYS,
    *READ_R2_KEYS,
)


class TargetConfigurationError(ValueError):
    """Raised before work starts when a target profile is unsafe or incomplete."""


def is_scheduled(environ: Mapping[str, str]) -> bool:
    return any(
        environ.get(name) == "true"
        for name in (
            "JJ_INTEL_MAC_DAILY_RUN",
            "JJ_INTEL_MAC_WEEKLY_RUN",
        )
    )


def validate_target(target: str | None) -> str:
    if target not in TARGETS:
        raise TargetConfigurationError(
            "Target must be either 'development' or 'production'."
        )
    return target


def _validate_project_url(name: str, value: str, project_ref: str) -> None:
    try:
        parsed = urlsplit(value)
    except ValueError as error:
        raise TargetConfigurationError(f"{name} is not a valid URL.") from error
    if parsed.scheme != "https" or parsed.hostname != f"{project_ref}.supabase.co":
        raise TargetConfigurationError(
            f"{name} does not point to the selected Supabase project."
        )


def _validate_database_url(name: str, value: str, project_ref: str) -> None:
    try:
        parsed = urlsplit(value)
    except ValueError as error:
        raise TargetConfigurationError(f"{name} is not a valid URL.") from error
    if parsed.scheme not in {"postgres", "postgresql"} or not parsed.hostname:
        raise TargetConfigurationError(f"{name} must be a PostgreSQL URL.")
    username = unquote(parsed.username or "")
    if project_ref not in parsed.hostname and project_ref not in username:
        raise TargetConfigurationError(
            f"{name} does not identify the selected Supabase project."
        )


def resolve_target_environment(
    target: str, environ: Mapping[str, str]
) -> dict[str, str]:
    """Resolve prefixed local profiles or validate values supplied directly."""
    target = validate_target(target)
    project_ref = PROJECT_REFS[target]
    prefix = "DEV_" if target == "development" else "PROD_"
    has_profiles = any(
        f"{candidate}{key}" in environ
        for candidate in ("DEV_", "PROD_")
        for key in PROFILE_KEYS
    )

    # Never pass both environments' secrets to the worker process.
    resolved = {
        key: value
        for key, value in environ.items()
        if not key.startswith(("DEV_", "PROD_"))
    }
    # run_managed_process starts from os.environ before applying this mapping,
    # so blank the inherited profile keys explicitly in the child process.
    resolved.update(
        {
            key: ""
            for key in environ
            if key.startswith(("DEV_", "PROD_"))
        }
    )
    if has_profiles:
        # Clear the generic values first so one target cannot inherit another
        # target's DB or bucket when a profile entry is missing.
        for key in PROFILE_KEYS:
            # Empty values also block later load_dotenv() calls and inherited
            # parent environments from restoring another target's defaults.
            resolved[key] = ""
        for key in PROFILE_KEYS:
            value = environ.get(f"{prefix}{key}")
            if value is not None:
                resolved[key] = value
        if not resolved.get("SUPABASE_URL", "").strip():
            raise TargetConfigurationError(
                f"{prefix}SUPABASE_URL is required for the selected target."
            )
        if not resolved.get("SUPABASE_SERVICE_ROLE_KEY", "").strip():
            raise TargetConfigurationError(
                f"{prefix}SUPABASE_SERVICE_ROLE_KEY is required for the selected target."
            )

    supabase_url = resolved.get("SUPABASE_URL", "").strip()
    service_key = resolved.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not supabase_url or not service_key:
        raise TargetConfigurationError(
            "The selected target requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
        )
    _validate_project_url("SUPABASE_URL", supabase_url, project_ref)

    for name in ("DATABASE_URL", "PUBLICATION_DATABASE_URL"):
        value = resolved.get(name, "").strip()
        if value:
            _validate_database_url(name, value, project_ref)
    if resolved.get("PUBLICATION_DATABASE_SSL_CA_CERT", "").strip() and not resolved.get(
        "PUBLICATION_DATABASE_URL", ""
    ).strip():
        raise TargetConfigurationError(
            "PUBLICATION_DATABASE_SSL_CA_CERT requires PUBLICATION_DATABASE_URL."
        )

    writer_values = [resolved.get(key, "").strip() for key in WRITE_R2_KEYS]
    if any(writer_values) and not all(writer_values):
        raise TargetConfigurationError(
            "R2 dataflow configuration must set image origin and both writer credentials."
        )

    reader_values = [resolved.get(key, "").strip() for key in READ_R2_KEYS]
    if any(reader_values) and not all(reader_values):
        raise TargetConfigurationError(
            "R2 app configuration must set both read-only credential variables."
        )
    has_writer = all(writer_values)
    has_reader = all(reader_values)
    # The account ID is shared by artwork R2 and the run-artifact R2 bucket.
    # It is not, by itself, a request to configure artwork delivery.
    has_r2_settings = any(
        resolved.get(key, "").strip()
        for key in ("R2_BUCKET", *WRITE_R2_KEYS, *READ_R2_KEYS)
    )
    if has_r2_settings and not (has_writer or has_reader):
        raise TargetConfigurationError(
            "R2 account and bucket settings require a complete writer or read-only credential pair."
        )
    if has_writer or has_reader:
        if not resolved.get("R2_ACCOUNT_ID", "").strip():
            raise TargetConfigurationError("R2_ACCOUNT_ID is required for the selected target.")
        if resolved.get("R2_BUCKET", "").strip() != BUCKETS[target]:
            raise TargetConfigurationError(
                f"R2_BUCKET must be {BUCKETS[target]} for the selected target."
            )
        if not re.fullmatch(r"[a-fA-F0-9]{32}", resolved["R2_ACCOUNT_ID"].strip()):
            raise TargetConfigurationError("R2_ACCOUNT_ID must be a 32-character hexadecimal ID.")
    if has_writer:
        try:
            parsed_origin = urlsplit(resolved["R2_IMAGE_ORIGIN"].strip())
        except ValueError as error:
            raise TargetConfigurationError(
                "R2_IMAGE_ORIGIN must be a safe HTTP(S) origin."
            ) from error
        local_http = parsed_origin.scheme == "http" and parsed_origin.hostname in {
            "localhost",
            "127.0.0.1",
            "::1",
        }
        if (
            (parsed_origin.scheme != "https" and not local_http)
            or not parsed_origin.netloc
            or parsed_origin.path
            or parsed_origin.query
            or parsed_origin.fragment
            or parsed_origin.username
            or parsed_origin.password
        ):
            raise TargetConfigurationError("R2_IMAGE_ORIGIN must be a safe HTTP(S) origin.")

    d1_id = resolved.get("D1_DATABASE_ID", "").strip()
    d1_api_token = resolved.get("D1_API_TOKEN", "").strip()
    cloudflare_account_id = resolved.get("R2_ACCOUNT_ID", "").strip()
    run_bucket = resolved.get("RUN_ARTIFACTS_R2_BUCKET", "").strip()
    run_access = resolved.get("RUN_ARTIFACTS_R2_ACCESS_KEY_ID", "").strip()
    run_secret = resolved.get("RUN_ARTIFACTS_R2_SECRET_ACCESS_KEY", "").strip()
    run_r2_values = (run_bucket, run_access, run_secret)
    if any(run_r2_values) and not all(run_r2_values):
        raise TargetConfigurationError(
            "Run-artifact R2 requires its dedicated bucket and both writer credentials."
        )
    if not d1_id:
        env_name = f"{prefix}D1_DATABASE_ID" if has_profiles else "D1_DATABASE_ID"
        raise TargetConfigurationError(f"The selected target requires {env_name}.")
    if not re.fullmatch(r"[a-fA-F0-9-]{36}", d1_id):
        raise TargetConfigurationError("D1_DATABASE_ID must be a Cloudflare D1 database UUID.")
    expected_d1_id = D1_DATABASE_IDS[target]
    if expected_d1_id and d1_id.lower() != expected_d1_id:
        raise TargetConfigurationError(
            f"D1_DATABASE_ID does not point to the configured {target} D1 database."
        )
    if target == "production" and d1_id.lower() == D1_DATABASE_IDS["development"]:
        raise TargetConfigurationError("Production D1_DATABASE_ID cannot be the development database.")
    if len(d1_api_token) < 20:
        token_name = f"{prefix}D1_API_TOKEN" if has_profiles else "D1_API_TOKEN"
        raise TargetConfigurationError(f"{token_name} must be a Cloudflare API token with D1 access.")
    if not re.fullmatch(r"[a-fA-F0-9]{32}", cloudflare_account_id):
        raise TargetConfigurationError("R2_ACCOUNT_ID must also identify the Cloudflare account that owns D1.")
    if run_bucket != RUN_ARTIFACT_BUCKETS[target]:
        raise TargetConfigurationError(
            f"RUN_ARTIFACTS_R2_BUCKET must be {RUN_ARTIFACT_BUCKETS[target]} for {target}."
        )
    if not run_access or not run_secret:
        raise TargetConfigurationError(
            "The selected target requires dedicated run-artifact R2 write credentials."
        )

    if target == "development":
        # Development runs must never inherit production alert credentials.
        resolved["RESEND_API_KEY"] = ""
        resolved["TICKET_ALERT_RECIPIENT_API_URL"] = ""
        resolved["TICKET_ALERT_INTERNAL_API_SECRET"] = ""

    if target == "production" and has_profiles:
        for key in (
            "RESEND_API_KEY",
            "TICKET_ALERT_RECIPIENT_API_URL",
            "TICKET_ALERT_INTERNAL_API_SECRET",
        ):
            # Notification secrets are opt-in for production local runs.
            resolved.setdefault(key, "")

    resolved["KARTISERET_TARGET"] = target
    return resolved
