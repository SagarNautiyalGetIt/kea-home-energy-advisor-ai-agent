import importlib.util
import io
import re
import subprocess
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


def load(name):
    path = ROOT / "scripts" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


database = load("database_credentials")
configure = load("configure_rds")


def service(compose: str, name: str) -> str:
    """The text of one top-level Compose service, up to the next one."""
    match = re.search(rf"^  {name}:\n(.*?)(?=^  \S|^\S|\Z)", compose, re.S | re.M)
    if match is None:
        raise AssertionError(f"no service {name!r}")
    return match.group(1)


class MetabaseCredentialTests(unittest.TestCase):
    def test_metabase_passwords_are_owner_only_and_reused(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            database.prepare(directory)
            first = {name: (directory / name).read_text()
                     for name in ("metabase-db-password", "metabase-admin-password")}
            database.prepare(directory, "demo.example.ap-southeast-2.rds.amazonaws.com")
            for name, value in first.items():
                self.assertEqual((directory / name).read_text(), value)
                self.assertEqual((directory / name).stat().st_mode & 0o777, 0o600)
            # The API's client file never carries Metabase's login.
            self.assertNotIn(first["metabase-db-password"].strip(),
                             (directory / "db-client.env").read_text())

    def test_rds_setup_creates_the_read_only_login_and_redacts_it(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            database.prepare(directory)
            secret = (directory / "metabase-db-password").read_text().strip()
            failed = subprocess.CompletedProcess([], 1, "", f"ERROR near '{secret}'")
            with patch("sys.argv", ["configure_rds", str(directory), "--public-ip", "192.0.2.10"]), \
                    patch.object(configure.subprocess, "run", return_value=failed) as run, \
                    redirect_stderr(io.StringIO()) as stderr:
                self.assertEqual(configure.main(), 1)
            sql = run.call_args.kwargs["input"]
            self.assertIn("CREATE ROLE kea_metabase LOGIN PASSWORD", sql)
            self.assertNotIn("SUPERUSER", sql)
            self.assertNotIn(secret, stderr.getvalue())


class MetabaseStackTests(unittest.TestCase):
    compose = (ROOT / "ec2/compose.yml").read_text()

    def test_metabase_never_receives_the_api_credentials(self):
        metabase = service(self.compose, "metabase")
        self.assertNotIn("env_file", metabase)
        self.assertNotIn("<<: *api", metabase)
        self.assertIn("mem_limit:", metabase)
        self.assertIn("MB_SITE_URL: ${KEA_CORS_ORIGINS}/metabase/", metabase)
        self.assertNotIn("ports:", metabase)

    def test_walkthrough_login_is_enabled_for_the_demo(self):
        self.assertIn("KEA_GENERATED_DEMO_LOGIN: '1'", self.compose)

    def test_caddy_serves_metabase_under_a_path_on_443(self):
        caddy = (ROOT / "ec2/Caddyfile").read_text()
        self.assertRegex(caddy, r"handle_path /metabase/\* \{\s*reverse_proxy metabase:3000")
        self.assertIn("redir /metabase /metabase/", caddy)


class MetabaseStepTests(unittest.TestCase):
    operations = (ROOT / "scripts/operations.sh").read_text()

    def test_deploy_runs_metabase_after_verify_and_before_the_apk(self):
        steps = re.search(r"for step in (login [^;]*); do", self.operations).group(1).split()
        self.assertEqual(steps[steps.index("verify") + 1], "metabase")
        self.assertLess(steps.index("metabase"), steps.index("mobile"))

    def test_metabase_step_pins_the_story_date_and_grants_only_reads(self):
        body = re.search(r"^step_metabase\(\) \{\n(.*?)^\}", self.operations, re.S | re.M).group(1)
        self.assertIn("data/pipeline/scripts/ops/serving_as_of.sql", body)
        grants = re.findall(r"^GRANT .*$", body, re.M)
        self.assertTrue(grants)
        for grant in grants:
            self.assertRegex(grant, r"^GRANT (CONNECT|USAGE|SELECT) ")
        self.assertIn("db-client.env", body)
        self.assertNotIn("db-admin.env", body)

    def test_metabase_has_a_make_target(self):
        makefile = (ROOT / "Makefile").read_text()
        self.assertRegex(makefile, r"(?m)^metabase:\n\t@bash scripts/operations.sh metabase$")


class CapacityTests(unittest.TestCase):
    def test_host_is_big_enough_for_metabase(self):
        main = (ROOT / "ec2/main.tf").read_text()
        self.assertRegex(main, r'variable "instance_type" \{[^}]*default = "t3.medium"')

    def test_database_zone_is_a_validated_variable(self):
        rds = (ROOT / "ec2/rds.tf").read_text()
        self.assertIn("availability_zone                   = var.db_availability_zone", rds)
        self.assertIn('contains(["ap-southeast-2a", "ap-southeast-2b"], var.db_availability_zone)', rds)
        self.assertNotRegex(rds, r'availability_zone\s+= "ap-southeast-2[ab]"')


if __name__ == "__main__":
    unittest.main()
