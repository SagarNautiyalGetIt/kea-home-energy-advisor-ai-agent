import importlib.util
import io
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch


def load(name):
    path = Path(__file__).resolve().parents[1] / "scripts" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


database = load("database_credentials")
runtime = load("runtime_credentials")


class RDSCredentialTests(unittest.TestCase):
    def test_password_reuse_and_owner_only_client_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            database.prepare(directory)
            previous = (directory / "db-app-password").read_text()
            database.prepare(directory, "demo.example.ap-southeast-2.rds.amazonaws.com")
            self.assertEqual((directory / "db-app-password").read_text(), previous)
            for name in ["db-master-password", "db-app-password", "db-admin.env", "db-client.env"]:
                self.assertEqual((directory / name).stat().st_mode & 0o777, 0o600)
            self.assertIn("PGSSLMODE=verify-full", (directory / "db-client.env").read_text())
            self.assertNotIn((directory / "db-master-password").read_text().strip(),
                             (directory / "db-client.env").read_text())

    def test_password_symlink_cannot_overwrite_another_file(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            unrelated = directory / "keep"
            unrelated.write_text("keep")
            (directory / "db-master-password").symlink_to(unrelated)
            with self.assertRaises(ValueError):
                database.prepare(directory)
            self.assertEqual(unrelated.read_text(), "keep")

    def test_refresh_preserves_rds_host_and_tls_without_printing_secrets(self):
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / "runtime.env"
            original = {
                "KEA_PG_PASSWORD": "app-secret",
                "KEA_DATABASE_URL": "postgresql+asyncpg://kea:app-secret@demo.ap-southeast-2.rds.amazonaws.com:5432/kea",
                "KEA_CORS_ORIGINS": "https://192.0.2.10",
                "KEA_DATABASE_SSL_CA": "/certs/rds/global-bundle.pem",
                "KEA_BEDROCK_MODEL": "approved-model",
                "KEA_BEDROCK_MODEL_SSM_PARAMETER": "/kea/approved-model",
                "KEA_ALERT_ACCOUNT_REFS": "H-001,H-002",
            }
            target.write_text("".join(f"{key}={value}\n" for key, value in original.items())
                              + "AWS_ACCESS_KEY_ID=old-access\nAWS_SECRET_ACCESS_KEY=old-secret\n"
                              + "AWS_SESSION_TOKEN=old-token\n")
            output = io.StringIO()
            with patch("sys.argv", ["runtime_credentials", str(target), "--refresh"]), \
                    patch.object(runtime, "temporary_credentials", return_value=(
                        {"AWS_ACCESS_KEY_ID": "test-access", "AWS_SECRET_ACCESS_KEY": "test-secret", "AWS_SESSION_TOKEN": "test-token"},
                        datetime(2030, 1, 1, tzinfo=timezone.utc))), redirect_stdout(output):
                runtime.main()
            refreshed = dict(line.split("=", 1) for line in target.read_text().splitlines())
            for key, value in original.items():
                self.assertEqual(refreshed[key], value)
            self.assertEqual(refreshed["AWS_ACCESS_KEY_ID"], "test-access")
            self.assertEqual(refreshed["AWS_SECRET_ACCESS_KEY"], "test-secret")
            self.assertEqual(refreshed["AWS_SESSION_TOKEN"], "test-token")
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)
            for secret in ["app-secret", "test-access", "test-secret", "test-token"]:
                self.assertNotIn(secret, output.getvalue())


if __name__ == "__main__":
    unittest.main()
