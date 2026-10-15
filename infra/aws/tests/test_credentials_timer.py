import importlib.util
import json
import os
import plistlib
import re
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


def load(name):
    path = ROOT / "scripts" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


timer = load("credentials_timer")
runtime = load("runtime_credentials")
NOW = datetime(2026, 10, 6, 2, 0, tzinfo=timezone.utc)


def stamp(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


class DueTests(unittest.TestCase):
    def test_refresh_is_due_only_inside_the_margin(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            expires = directory / timer.EXPIRES_FILE
            expires.write_text((NOW + timedelta(hours=2)).isoformat())
            self.assertFalse(timer.due(directory, NOW))
            expires.write_text((NOW + timedelta(minutes=44)).isoformat())
            self.assertTrue(timer.due(directory, NOW))
            expires.write_text((NOW - timedelta(minutes=5)).isoformat())
            self.assertTrue(timer.due(directory, NOW))

    def test_missing_or_garbled_expiry_means_refresh(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            self.assertTrue(timer.due(directory, NOW))
            (directory / timer.EXPIRES_FILE).write_text("soon")
            self.assertTrue(timer.due(directory, NOW))

    def test_an_expiry_without_a_timezone_means_refresh(self):
        # Parses, but names no instant; subtracting it from an aware now raised
        # TypeError, which the shell read as "still fresh".
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / timer.EXPIRES_FILE).write_text("2026-10-07T12:00:00")
            self.assertTrue(timer.due(directory, NOW))

    def test_not_due_has_its_own_exit_status(self):
        script = str(ROOT / "scripts" / "credentials_timer.py")
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / timer.EXPIRES_FILE).write_text(
                (datetime.now(timezone.utc) + timedelta(hours=3)).isoformat())
            fresh = subprocess.run([sys.executable, script, "due", temporary], capture_output=True)
            self.assertEqual(fresh.returncode, timer.NOT_DUE)
            (directory / timer.EXPIRES_FILE).unlink()
            stale = subprocess.run([sys.executable, script, "due", temporary], capture_output=True)
            self.assertEqual(stale.returncode, 0)
        # An uncaught error exits 1, which must not be NOT_DUE.
        crashed = subprocess.run([sys.executable, script, "due"], capture_output=True)
        self.assertNotIn(crashed.returncode, (0, timer.NOT_DUE))


class AgentTests(unittest.TestCase):
    def test_agent_runs_keep_credentials_for_its_session_every_30_minutes(self):
        agent = plistlib.loads(timer.agent("20261005222619", Path("/work/s"), "/opt/homebrew/bin:/usr/bin"))
        self.assertEqual(agent["Label"], "nz.kea-energy.credentials.20261005222619")
        self.assertEqual(agent["ProgramArguments"][-2:],
                         ["keep-credentials", "SESSION_ID=20261005222619"])
        self.assertEqual(agent["StartInterval"], 1800)
        self.assertTrue(agent["RunAtLoad"])
        self.assertEqual(agent["EnvironmentVariables"]["PATH"], "/opt/homebrew/bin:/usr/bin")
        self.assertEqual(agent["StandardErrorPath"], "/work/s/keep-credentials.log")
        # No credential ever lands in the agent definition.
        self.assertNotIn("AWS_", json.dumps(agent["EnvironmentVariables"]))


class FreshCredentialTests(unittest.TestCase):
    def exported(self, expires: datetime) -> dict:
        return {"AccessKeyId": f"key-{expires.hour}", "SecretAccessKey": "secret",
                "SessionToken": "token", "Expiration": stamp(expires)}

    def test_refresh_drops_only_the_stale_cached_role_credentials(self):
        stale = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(minutes=40)
        with tempfile.TemporaryDirectory() as temporary:
            cache = Path(temporary)
            (cache / "stale.json").write_text(json.dumps(
                {"ProviderType": "sso", "Credentials": {"Expiration": stamp(stale)}}))
            (cache / "other.json").write_text(json.dumps(
                {"ProviderType": "assume-role", "Credentials": {"Expiration": stamp(stale)}}))
            (cache / "newer.json").write_text(json.dumps(
                {"ProviderType": "sso", "Credentials": {"Expiration": stamp(stale + timedelta(hours=1))}}))
            self.assertEqual(runtime.drop_cached(stamp(stale), cache), 1)
            self.assertFalse((cache / "stale.json").exists())
            self.assertTrue((cache / "other.json").exists())
            self.assertTrue((cache / "newer.json").exists())

    def test_cache_and_export_spell_the_same_instant_differently(self):
        # The CLI cache stores "...Z"; `export-credentials` prints "...+00:00".
        with tempfile.TemporaryDirectory() as temporary:
            cache = Path(temporary)
            (cache / "entry.json").write_text(json.dumps(
                {"ProviderType": "sso", "Credentials": {"Expiration": "2026-10-06T06:01:48Z"}}))
            self.assertEqual(runtime.drop_cached("2026-10-06T06:01:48+00:00", cache), 1)

    def test_fresh_export_after_dropping_the_cache(self):
        stale = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(minutes=40)
        renewed = stale + timedelta(hours=4)
        answers = iter([self.exported(stale), self.exported(renewed)])
        with patch.object(runtime, "export_credentials", side_effect=lambda: next(answers)), \
                patch.object(runtime, "drop_cached", return_value=1) as dropped:
            values, expires = runtime.temporary_credentials(fresh=True)
        dropped.assert_called_once_with(stamp(stale))
        self.assertEqual(expires, renewed)
        self.assertEqual(values["AWS_ACCESS_KEY_ID"], f"key-{renewed.hour}")

    def test_a_first_export_keeps_cached_credentials(self):
        recent = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(hours=3, minutes=50)
        with patch.object(runtime, "export_credentials", return_value=self.exported(recent)), \
                patch.object(runtime, "drop_cached") as dropped:
            _, expires = runtime.temporary_credentials(fresh=True)
            runtime.temporary_credentials()
        dropped.assert_not_called()
        self.assertEqual(expires, recent)


class WiringTests(unittest.TestCase):
    operations = (ROOT / "scripts/operations.sh").read_text()

    def steps(self, first: str) -> list[str]:
        return re.search(rf"for step in ({first} [^;]*); do", self.operations).group(1).split()

    def test_deploy_installs_the_timer_and_teardown_removes_it_first(self):
        deploy = self.steps("login ip-allocate")
        self.assertIn("credentials-timer", deploy)
        self.assertLess(deploy.index("runtime"), deploy.index("credentials-timer"))
        teardown = self.steps("login credentials-timer-stop")
        self.assertLess(teardown.index("credentials-timer-stop"), teardown.index("destroy-apply"))

    def test_keep_credentials_refreshes_in_its_own_make_and_notifies_on_failure(self):
        body = re.search(r"^step_keep_credentials\(\) \{\n(.*?)^\}", self.operations, re.S | re.M).group(1)
        self.assertIn('make -C "$KEA_ROOT/infra/aws" refresh-credentials', body)
        self.assertIn("notify", body)
        self.assertIn("due", body)


class KeepCredentialsTests(unittest.TestCase):
    """step_keep_credentials itself, in bash, with make and the session stubbed."""

    function = re.search(r"^step_keep_credentials\(\) \{\n.*?^\}",
                         (ROOT / "scripts/operations.sh").read_text(), re.S | re.M).group(0)

    def keep(self, expires: str | None = None, fake_timer: str | None = None,
             fail_refresh: bool = False, make_stub: str | None = None,
             expect_code: int | None = None) -> str:
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            session = base / "session"
            session.mkdir()
            if expires is not None:
                (session / timer.EXPIRES_FILE).write_text(expires)
            scripts = base / "infra/aws/scripts"
            scripts.mkdir(parents=True)
            source = fake_timer or (ROOT / "scripts/credentials_timer.py").read_text()
            (scripts / "credentials_timer.py").write_text(source)
            program = "\n".join([
                "set -euo pipefail",
                "kea_load_session() { :; }",
                make_stub or
                ('make() { echo "MAKE $*"; printf "2030-01-01T00:00:00Z\\n" '
                 '> "$SESSION_DIR/runtime.env.expires"; return 1; }'
                 if fail_refresh else 'make() { echo "MAKE $*"; }'),
                self.function,
                "step_keep_credentials",
            ])
            result = subprocess.run(
                ["bash", "-c", program], capture_output=True, text=True,
                env={"PATH": os.environ["PATH"], "KEA_ROOT": temporary,
                     "SESSION_DIR": str(session), "SESSION_ID": "test"})
            if expect_code is None:
                expect_code = 1 if fail_refresh else 0
            self.assertEqual(result.returncode, expect_code, result.stderr)
            if fail_refresh:
                self.assertFalse((session / timer.EXPIRES_FILE).exists())
                self.assertTrue(timer.due(session))
            return result.stdout + result.stderr

    def test_fresh_credentials_skip_the_refresh(self):
        output = self.keep((datetime.now(timezone.utc) + timedelta(hours=3)).isoformat())
        self.assertIn("still fresh", output)
        self.assertNotIn("MAKE", output)

    def test_an_expiry_without_a_timezone_refreshes(self):
        output = self.keep("2026-10-07T12:00:00")
        self.assertNotIn("still fresh", output)
        self.assertIn("MAKE -C", output)

    def test_a_crashed_check_refreshes_and_notifies(self):
        crash = ("import sys\n"
                 "if sys.argv[1] == 'notify':\n"
                 "    print('NOTIFY ' + ' '.join(sys.argv[2:]))\n"
                 "else:\n"
                 "    raise TypeError('boom')\n")
        output = self.keep(fake_timer=crash)
        self.assertNotIn("still fresh", output)
        self.assertIn("due check failed (exit 1)", output)
        self.assertIn("NOTIFY", output)
        self.assertIn("MAKE -C", output)

    def test_failed_remote_refresh_does_not_suppress_the_next_retry(self):
        fake = ("import sys\n"
                "if sys.argv[1] == 'notify':\n"
                "    print('NOTIFY ' + ' '.join(sys.argv[2:]))\n")
        output = self.keep(fake_timer=fake, fail_refresh=True)
        self.assertIn("MAKE -C", output)
        self.assertIn("could not be refreshed", output)
        self.assertNotIn("signing in to AWS again", output)

    # The first make fails as the AWS CLI does once the SSO token lapses; later ones pass.
    SSO_EXPIRED_ONCE = (
        'make() { echo "MAKE $*"; '
        'if [[ ! -e "$SESSION_DIR/tried" ]]; then touch "$SESSION_DIR/tried"; '
        'printf "2030-01-01T00:00:00Z\\n" > "$SESSION_DIR/runtime.env.expires"; '
        'echo "aws: [ERROR]: Error when retrieving token from sso: Token has expired and refresh failed"; '
        'return 255; fi; }')

    @staticmethod
    def fake_timer(login_exit: int) -> str:
        return ("import sys\n"
                "if sys.argv[1] == 'notify':\n"
                "    print('NOTIFY ' + ' '.join(sys.argv[2:]))\n"
                "elif sys.argv[1] == 'login':\n"
                "    print('LOGIN')\n"
                f"    sys.exit({login_exit})\n")

    def test_an_expired_sso_sign_in_logs_in_again_and_retries(self):
        output = self.keep("2026-10-07T12:00:00+00:00", fake_timer=self.fake_timer(0),
                           make_stub=self.SSO_EXPIRED_ONCE, expect_code=0)
        self.assertIn("LOGIN", output)
        self.assertEqual(output.count("MAKE -C"), 2)
        self.assertIn("refreshed after signing in again", output)
        self.assertNotIn("NOTIFY", output)

    def test_an_unapproved_sign_in_notifies_without_retrying(self):
        output = self.keep("2026-10-07T12:00:00+00:00", fake_timer=self.fake_timer(1),
                           make_stub=self.SSO_EXPIRED_ONCE, expect_code=1)
        self.assertIn("LOGIN", output)
        self.assertEqual(output.count("MAKE -C"), 1)
        self.assertIn("NOTIFY Kea AWS demo credentials could not be refreshed", output)


class ExportErrorTests(unittest.TestCase):
    def test_an_expired_sso_token_message_reaches_the_log(self):
        # keep-credentials signs in again only when it sees the CLI's SSO error, so the
        # export must not swallow it on the first failed refresh.
        with tempfile.TemporaryDirectory() as temporary:
            fake = Path(temporary) / "aws"
            fake.write_text("#!/bin/sh\n"
                            "echo 'aws: [ERROR]: Error when retrieving token from sso: "
                            "Token has expired and refresh failed' >&2\n"
                            "exit 255\n")
            fake.chmod(0o755)
            code = ("import sys; sys.path.insert(0, sys.argv[1]); "
                    "import runtime_credentials; runtime_credentials.export_credentials()")
            result = subprocess.run(
                [sys.executable, "-c", code, str(ROOT / "scripts")],
                capture_output=True, text=True,
                env={"PATH": f"{temporary}:{os.environ['PATH']}", "HOME": temporary})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Token has expired", result.stderr)


class LoginTests(unittest.TestCase):
    def test_login_uses_the_demo_profile(self):
        with patch.object(timer.subprocess, "run",
                          return_value=subprocess.CompletedProcess([], 0)) as run:
            self.assertEqual(timer.login(), 0)
        self.assertEqual(run.call_args.args[0], ["aws", "sso", "login", "--profile", "kea-energy"])
        self.assertEqual(run.call_args.kwargs["timeout"], timer.LOGIN_TIMEOUT)

    def test_a_login_nobody_approves_gives_up(self):
        with patch.object(timer.subprocess, "run",
                          side_effect=subprocess.TimeoutExpired("aws", timer.LOGIN_TIMEOUT)):
            self.assertEqual(timer.login(), 1)


if __name__ == "__main__":
    unittest.main()
