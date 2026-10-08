"""Regresiones del panel; ejecutar con python -m unittest discover -s launcher."""
import ctypes
import json
import sys
import threading
import unittest
import urllib.request
from unittest.mock import Mock, patch

import dashboard


def report(client, wait, ahead=""):
    return {"clientId": client, "queueId": f"queue-{client}",
            "waitText": wait, "aheadText": ahead, "numberText": ""}


class LiveRankingTests(unittest.TestCase):
    def setUp(self):
        dashboard.start_session(2)

    def test_updates_values_and_ranking_after_all_queues_arrive(self):
        dashboard.update_queue(report("A", "70 minutos"))
        dashboard.update_queue(report("B", "80 minutos"))
        dashboard.update_queue(report("B", "10 minutos", "20"))
        rows, _ = dashboard.queue_snapshot()
        self.assertEqual([row["client_id"] for row in rows], ["B", "A"])
        self.assertEqual(rows[0]["wait_text"], "10 minutos")
        self.assertEqual(rows[0]["ahead_number"], 20)

    def test_sorts_without_waiting_for_missing_window(self):
        dashboard.start_session(10)
        dashboard.update_queue(report("A", "15 minutos"))
        dashboard.update_queue(report("B", "10 minutos"))
        rows, session = dashboard.queue_snapshot()
        self.assertEqual([row["client_id"] for row in rows], ["B", "A"])
        self.assertEqual(session["expected_count"], 10)

    def test_vague_hour_does_not_beat_precise_estimate(self):
        dashboard.update_queue(report("A", "más de una hora"))
        dashboard.update_queue(report("B", "90 minutos"))
        rows, _ = dashboard.queue_snapshot()
        self.assertEqual([row["client_id"] for row in rows], ["B", "A"])
        self.assertEqual(rows[1]["wait_minutes"], 60)

    def test_transition_from_over_hour_to_minutes(self):
        dashboard.update_queue(report("A", "más de una hora"))
        dashboard.update_queue(report("B", "más de una hora"))
        dashboard.update_queue(report("B", "15 minutos"))
        rows, _ = dashboard.queue_snapshot()
        self.assertEqual([row["client_id"] for row in rows], ["B", "A"])

    def test_ties_use_people_ahead_and_keep_stable_order(self):
        dashboard.update_queue(report("A", "10 minutos", "30"))
        dashboard.update_queue(report("B", "10 minutos", "20"))
        self.assertEqual(dashboard.queue_snapshot()[0][0]["client_id"], "B")
        dashboard.update_queue(report("A", "10 minutos", "20"))
        self.assertEqual(dashboard.queue_snapshot()[0][0]["client_id"], "A")

    def test_disconnected_window_expires_after_ranking_started(self):
        with patch.object(dashboard.time, "time", return_value=100):
            dashboard.update_queue(report("A", "10 minutos"))
            dashboard.update_queue(report("B", "20 minutos"))
        with patch.object(dashboard.time, "time", return_value=120):
            dashboard.update_queue(report("B", "15 minutos"))
            rows, _ = dashboard.queue_snapshot()
        self.assertEqual([row["client_id"] for row in rows], ["B"])

    def test_latest_timestamp_and_missing_data(self):
        with patch.object(dashboard.time, "time", return_value=100):
            dashboard.update_queue(report("A", "10 minutos"))
        with patch.object(dashboard.time, "time", return_value=105):
            dashboard.update_queue(report("A", "Calculando…"))
            rows, _ = dashboard.queue_snapshot()
        self.assertIsNone(rows[0]["wait_minutes"])
        self.assertEqual(rows[0]["captured_at"], 105)

    def test_parser_units_zero_and_unknown(self):
        for text, expected in [("1,5 horas", 90), ("10 minutos", 10),
                               ("menos de un minuto", 1), ("0 minutos", 0),
                               ("más de una hora", 60), ("", None),
                               ("Calculando…", None)]:
            with self.subTest(text=text):
                self.assertEqual(dashboard._parse_wait_minutes(text), expected)

    def test_http_reports_reorder_next_snapshot(self):
        server = dashboard.ThreadingHTTPServer(("127.0.0.1", 0), dashboard.DashboardHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f"http://127.0.0.1:{server.server_port}"
        try:
            for data in [report("A", "más de una hora"),
                         report("B", "más de una hora"), report("B", "10 minutos")]:
                request = urllib.request.Request(base + "/api/queue",
                    data=json.dumps(data).encode(), headers={"Content-Type": "application/json"})
                with urllib.request.urlopen(request, timeout=2) as response:
                    self.assertEqual(response.status, 202)
            with urllib.request.urlopen(base + "/api/queues", timeout=2) as response:
                data = json.load(response)
            self.assertEqual(data["queues"][0]["client_id"], "B")
            self.assertEqual(data["queues"][0]["wait_text"], "10 minutos")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)


@unittest.skipUnless(sys.platform == "win32", "Win32 focus APIs")
class WindowsFocusTests(unittest.TestCase):
    def test_focus_success_is_verified_and_alt_is_released(self):
        for mode in ("denied", "allowed", "fallback"):
            with self.subTest(mode=mode):
                user = Mock()
                state = {"hwnd": 456, "alt": False}
                user.IsWindowVisible.return_value = 1
                user.GetWindowTextLengthW.return_value = 20
                user.GetWindowTextW.side_effect = lambda hwnd, buf, n: setattr(buf, "value", "Chrome ABCD")
                user.EnumWindows.side_effect = lambda cb, n: cb(123, n)
                user.GetForegroundWindow.side_effect = lambda: state["hwnd"]

                def activate(hwnd):
                    if mode == "allowed" or (mode == "fallback" and state["alt"]):
                        state["hwnd"] = hwnd
                    return int(state["hwnd"] == hwnd)

                def key(vk, scan, flags, extra):
                    state["alt"] = not flags

                user.SetForegroundWindow.side_effect = activate
                user.keybd_event.side_effect = key
                with patch.object(ctypes, "windll", Mock(user32=user)), patch.object(dashboard.time, "sleep"):
                    self.assertEqual(dashboard._focus_windows_windows("ABCD"), mode != "denied")
                self.assertFalse(state["alt"])
                if mode == "allowed":
                    user.keybd_event.assert_not_called()


if __name__ == "__main__":
    unittest.main()
