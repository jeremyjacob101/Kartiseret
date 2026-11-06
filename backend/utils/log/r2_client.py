"""Shared fail-closed R2 S3 client construction."""
from __future__ import annotations

import os

from backend.utils.log.r2_budget import initialize_job_budget, install_budget


def create_r2_s3_client(*, access_key: str, secret_key: str, signature_version: str = "s3v4"):
    account_id = os.environ.get("R2_ACCOUNT_ID", "").strip()
    if not account_id or not access_key or not secret_key:
        raise RuntimeError("R2 account and writer credentials are required")
    # Initialize before client use. Existing inherited paths join this job's
    # atomic ledger; standalone commands receive their own ledger.
    initialize_job_budget()
    try:
        import boto3
        from botocore.config import Config
    except ImportError as error:
        raise RuntimeError("boto3 is required for R2 access") from error
    client = boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        region_name="auto",
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        config=Config(
            signature_version=signature_version,
            retries={"total_max_attempts": 1, "mode": "standard"},
        ),
    )
    from backend.utils.log.job_lease import before_mutation
    client.meta.events.register_first("before-send.s3.*", lambda **_kwargs: before_mutation())
    install_budget(client)
    from backend.utils.log.r2_storage_guard import install_storage_guard
    install_storage_guard(client)
    return client
