"""Database TLS must keep certificate and hostname validation enabled."""

import ssl
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app.db import session


def test_database_tls_verifies_certificates_and_hostname():
    context = ssl.create_default_context()
    with (
        patch.object(session, "settings", SimpleNamespace(database_ssl_ca="db-ca.pem")),
        patch.object(session.ssl, "create_default_context", return_value=context) as factory,
    ):
        result = session.connection_args()
    factory.assert_called_once_with(cafile="db-ca.pem")
    assert result["ssl"].check_hostname is True
    assert result["ssl"].verify_mode == ssl.CERT_REQUIRED
    assert result["ssl"].minimum_version == ssl.TLSVersion.TLSv1_2


def test_missing_ca_does_not_fall_back_to_plaintext():
    with (
        patch.object(session, "settings", SimpleNamespace(database_ssl_ca="/missing/ca.pem")),
        pytest.raises(FileNotFoundError),
    ):
        session.connection_args()
