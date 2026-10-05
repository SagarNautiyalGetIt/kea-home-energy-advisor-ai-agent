import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/export_serving.py"
spec = importlib.util.spec_from_file_location("export_serving", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ExportTests(unittest.TestCase):
    def test_creation_race_never_deletes_another_export(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)
            dump = target / "test12345.dump"

            def another_process_wins(*args, **kwargs):
                dump.write_bytes(b"another export")
                raise FileExistsError("won by another process")

            with (
                patch.object(module, "capture", return_value="160015"),
                patch.object(module.os, "open", side_effect=another_process_wins),
                self.assertRaises(FileExistsError),
            ):
                module.export("test12345", destination=target)
            self.assertEqual(dump.read_bytes(), b"another export")

    def test_rejects_session_path_traversal_before_docker(self):
        with patch.object(module, "capture") as capture:
            with self.assertRaises(ValueError):
                module.export("../../secrets")
            capture.assert_not_called()

    def test_rejects_wrong_postgres_major_before_writing(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "exports"
            with (
                patch.object(module, "capture", return_value="170001"),
                self.assertRaises(RuntimeError),
            ):
                module.export("test12345", destination=target)
            self.assertFalse(target.exists())

    def test_does_not_overwrite_existing_dump(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)
            old = target / "test12345.dump"
            old.write_bytes(b"keep")
            with (
                patch.object(module, "capture", return_value="160015"),
                self.assertRaises(FileExistsError),
            ):
                module.export("test12345", destination=target)
            self.assertEqual(old.read_bytes(), b"keep")
