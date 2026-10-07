import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class ApkDownloadTests(unittest.TestCase):
    compose = (ROOT / "ec2/compose.yml").read_text()
    caddy = (ROOT / "ec2/Caddyfile").read_text()
    operations = (ROOT / "scripts/operations.sh").read_text()

    def test_web_mounts_only_the_downloads_folder_read_only(self):
        web = re.search(r"^  web:\n(.*?)(?=^  \S)", self.compose, re.S | re.M).group(1)
        self.assertIn("- /opt/kea/downloads:/downloads:ro", web)

    def test_download_route_serves_files_without_a_listing(self):
        route = re.search(r"handle_path /download/\* \{(.*?)\n\t\}", self.caddy, re.S).group(1)
        self.assertIn("root * /downloads", route)
        self.assertIn("file_server", route)
        self.assertNotIn("browse", route)
        self.assertIn("application/vnd.android.package-archive", route)

    def test_deploy_publishes_after_the_build(self):
        steps = re.search(r"for step in (login ip-allocate [^;]*); do", self.operations).group(1).split()
        self.assertEqual(steps[-2:], ["mobile", "publish-apk"])

    def test_apk_is_built_for_arm64_unless_told_otherwise(self):
        body = re.search(r"^step_mobile\(\) \{\n(.*?)^\}", self.operations, re.S | re.M).group(1)
        self.assertIn('local abis="${ANDROID_ABIS:-arm64-v8a}"', body)
        self.assertIn('[[ "$abis" != all ]]', body)

    def test_qr_code_is_committed_and_published_only_for_its_address(self):
        qr = ROOT / "downloads/kea-energy-apk-qr.png"
        self.assertTrue(qr.read_bytes().startswith(b"\x89PNG"))
        body = re.search(r"^step_publish_apk\(\) \{\n(.*?)^\}", self.operations, re.S | re.M).group(1)
        self.assertIn("qr_ip=13.54.25.80", body)
        self.assertIn('if [[ "$PUBLIC_IP" == "$qr_ip" ]]', body)

    def test_publish_checks_the_link(self):
        body = re.search(r"^step_publish_apk\(\) \{\n(.*?)^\}", self.operations, re.S | re.M).group(1)
        self.assertIn("/opt/kea/downloads/kea-energy.apk", body)
        self.assertIn("application/vnd.android.package-archive", body)
        self.assertIn("install -m 644", body)


if __name__ == "__main__":
    unittest.main()
