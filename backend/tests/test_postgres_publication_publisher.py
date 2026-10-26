import logging
import os
from unittest import TestCase
from unittest.mock import patch

from backend.dataflow.utils.PostgresPublicationPublisher import PostgresPublicationPublisher


class PublisherConfigurationTests(TestCase):
    def test_structured_metrics_remain_visible_when_runner_root_level_is_error(self):
        self.assertEqual(
            logging.getLogger(
                "backend.dataflow.utils.PostgresPublicationPublisher"
            ).getEffectiveLevel(),
            logging.INFO,
        )

    def test_missing_url_keeps_the_rest_transport(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertIsNone(PostgresPublicationPublisher.from_environment())

    def test_certificate_or_test_mode_without_url_fails_closed(self):
        with patch.dict(os.environ, {"PUBLICATION_DATABASE_SSL_CA_CERT": "ca"}, clear=True):
            with self.assertRaisesRegex(ValueError, "requires PUBLICATION_DATABASE_URL"):
                PostgresPublicationPublisher.from_environment()
        with patch.dict(os.environ, {"PUBLICATION_DATABASE_TEST_MODE": "true"}, clear=True):
            with self.assertRaisesRegex(ValueError, "requires PUBLICATION_DATABASE_URL"):
                PostgresPublicationPublisher.from_environment()

    def test_remote_publisher_requires_dedicated_role_verified_ca_and_session_port(self):
        valid_url = "postgresql://kartiseret_publisher_login.project-ref:secret@pooler.example:5432/postgres"
        valid_ca = "-----BEGIN CERTIFICATE-----\nCA\n-----END CERTIFICATE-----"
        self.assertIsInstance(PostgresPublicationPublisher(valid_url, valid_ca), PostgresPublicationPublisher)
        invalid = (
            ("postgresql://postgres:secret@db.example:5432/postgres", valid_ca, "must use kartiseret_publisher_login"),
            ("postgresql://kartiseret_publisher_login:secret@pooler.example:6543/postgres", valid_ca, r"port \(5432\)"),
            (valid_url, None, "SSL_CA_CERT is required"),
            (valid_url + "?sslmode=require", valid_ca, "must not weaken verified TLS"),
            (valid_url + "?sslrootcert=/tmp/root.crt", valid_ca, "only through PUBLICATION_DATABASE_SSL_CA_CERT"),
        )
        for url, ca, message in invalid:
            with self.subTest(url=url):
                with self.assertRaisesRegex(ValueError, message):
                    PostgresPublicationPublisher(url, ca)

    def test_test_mode_is_confined_to_loopback(self):
        with self.assertRaisesRegex(ValueError, "only permits loopback"):
            PostgresPublicationPublisher(
                "postgresql://kartiseret_publisher_login:secret@db.example:5432/postgres",
                None,
                test_mode=True,
            )
