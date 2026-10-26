import json
import logging
import sys

import psycopg

from backend.dataflow.utils.PostgresPublicationPublisher import PostgresPublicationPublisher


logging.basicConfig(level=logging.INFO, format="%(message)s", stream=sys.stderr)
request = json.load(sys.stdin)
publisher = PostgresPublicationPublisher.from_environment()
if publisher is None:
    raise RuntimeError("The disposable publisher connection was not configured")
parts = [
    part if isinstance(part, str) else json.dumps(part, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    for part in request.get("parts", [])
]

if request.get("mode") == "stage_only":
    publisher._stage(request["identity"], parts)
    print("{}")
    raise SystemExit(0)

if request.get("mode") == "permissions":
    with publisher._connect() as connection:
        with connection.transaction():
            cursor = connection.cursor()
            cursor.execute("SET LOCAL ROLE kartiseret_publisher")
            cursor.execute(
                "SELECT has_function_privilege(current_user, 'pipeline_internal.commit_category_publication_direct(uuid,text)', 'EXECUTE') AS can_publish, "
                "has_function_privilege(current_user, 'pipeline_internal.commit_category_publication_impl(uuid,text,integer)', 'EXECUTE') AS can_call_impl, "
                "has_table_privilege(current_user, 'public.\"finalMovies\"', 'SELECT') AS can_read_catalog, "
                "has_table_privilege(current_user, 'public.pipeline_publication_parts', 'INSERT') AS can_stage, "
                "has_table_privilege(current_user, 'public.pipeline_publications', 'UPDATE') AS can_update_receipt"
            )
            permissions = cursor.fetchone()
            try:
                cursor.execute("SELECT count(*) FROM auth.users")
                can_read_auth = True
            except psycopg.errors.InsufficientPrivilege:
                can_read_auth = False
    print(json.dumps({**permissions, "can_read_auth": can_read_auth}))
    raise SystemExit(0)

if request.get("simulate_lost_ack"):
    apply = publisher._apply

    def apply_and_drop_ack(identity):
        apply(identity)
        raise psycopg.OperationalError("simulated lost commit acknowledgement")

    publisher._apply = apply_and_drop_ack

receipt = publisher.publish(request["identity"], parts)
print(json.dumps(receipt, separators=(",", ":")))
