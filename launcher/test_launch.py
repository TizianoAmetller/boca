"""Compatibilidad del launcher de una cuenta y manejo de pipes cerrados."""
from contextlib import ExitStack, closing, redirect_stdout
import errno
import io
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

import launch


class LauncherCompatibilityTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        root = Path(self.stack.enter_context(tempfile.TemporaryDirectory()))
        self.profiles = root / "launcher" / "profiles"
        self.main = self.profiles / "profile-0"
        (self.main / "Default" / "Local Storage").mkdir(parents=True)
        (self.main / "Local State").write_text("fixture")
        (self.main / "Default" / "Local Storage" / "login").write_text("own-account")
        with closing(sqlite3.connect(self.main / "Default" / "Cookies")) as db:
            db.execute("CREATE TABLE cookies (host_key TEXT, name TEXT)")
            db.executemany("INSERT INTO cookies VALUES (?, ?)",
                           [("boca", "login"), ("queue-it.net", "QueueIT")])
            db.commit()
        self.stack.enter_context(patch.multiple(launch, PROFILES=self.profiles, MAIN=self.main))
        self.stack.enter_context(patch.object(launch, "check_closed"))
        self.stack.enter_context(patch.object(launch, "find_chrome", return_value="chrome"))
        self.stack.enter_context(patch.object(launch, "work_areas", return_value=[(0, 0, 500, 500)]))
        self.stack.enter_context(patch.object(launch, "tile", return_value=[(0, 0, 500, 500)]))
        self.stack.enter_context(patch.object(launch.time, "sleep"))
        self.server = self.stack.enter_context(patch.object(launch, "ensure_dashboard_server"))
        self.session = self.stack.enter_context(patch.object(launch, "start_dashboard_session"))
        self.browser = self.stack.enter_context(patch.object(launch.webbrowser, "open"))
        self.opened = self.stack.enter_context(patch.object(launch, "launch",
            return_value=Mock(poll=Mock(return_value=None))))
        self.stack.enter_context(redirect_stdout(io.StringIO()))

    def run_launcher(self, *args):
        with patch.object(sys, "argv", ["launch.py", *args]):
            launch.main()

    def test_default_three_windows_use_own_login_and_original_names(self):
        self.run_launcher()
        self.assertEqual([c.args[1] for c in self.opened.call_args_list],
                         [self.profiles / f"profile-{i}" for i in range(3)])
        for i in range(3):
            profile = self.profiles / f"profile-{i}"
            self.assertEqual((profile / "Default" / "Local Storage" / "login").read_text(), "own-account")
            with closing(sqlite3.connect(profile / "Default" / "Cookies")) as db:
                self.assertEqual(db.execute("SELECT name FROM cookies").fetchall(), [("login",)])
        self.server.assert_called_once()
        self.assertEqual(self.session.call_args.args[1], 3)
        self.browser.assert_called_once()

    def test_count_url_and_optional_dashboard(self):
        self.run_launcher("-n", "4", "-u", "https://example.test/", "--no-dashboard")
        self.assertEqual(self.opened.call_count, 4)
        self.assertTrue(all(c.args[2] == "https://example.test/" for c in self.opened.call_args_list))
        self.server.assert_not_called()
        self.session.assert_not_called()
        self.browser.assert_not_called()

    def test_setup_still_opens_original_profile(self):
        self.run_launcher("--setup")
        self.assertEqual(self.opened.call_args.args[1], self.main)
        self.opened.return_value.wait.assert_called_once()
        self.server.assert_not_called()


class DevToolsPipeTests(unittest.TestCase):
    def test_closed_write_is_reported_without_oserror_escaping(self):
        with patch.object(launch.os, "write", side_effect=OSError(errno.EINVAL, "Invalid argument")):
            with self.assertRaises(RuntimeError):
                launch.DevToolsPipe(1, 2).call("Target.getTargets")

    def test_closed_read_sets_error(self):
        with patch.object(launch.os, "read", side_effect=OSError(errno.EINVAL, "Invalid argument")):
            result = {}
            launch.DevToolsPipe(1, 2)._read_until(1, result)
        self.assertIn("error", result)

    def test_parent_pipe_descriptors_close_after_launch_failure(self):
        descriptors = []
        original_pipe = os.pipe

        def make_pipe():
            pair = original_pipe()
            descriptors.extend(pair)
            return pair

        with tempfile.TemporaryDirectory() as root, patch.object(launch.os, "pipe", side_effect=make_pipe), \
             patch.object(launch.subprocess, "Popen", return_value=Mock(poll=Mock(return_value=1), returncode=1)) as spawn, \
             patch.object(launch.DevToolsPipe, "call", side_effect=RuntimeError("Chrome closed")), \
             redirect_stdout(io.StringIO()):
            launch.launch("chrome", Path(root) / "profile-0", "about:blank", (0, 0, 500, 500))
        self.assertIn("--disable-background-mode", spawn.call_args.args[0])
        for descriptor in descriptors:
            with self.assertRaises(OSError):
                os.fstat(descriptor)


if __name__ == "__main__":
    unittest.main()
