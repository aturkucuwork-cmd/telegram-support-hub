import json
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.request import Request, urlopen
from http.server import ThreadingHTTPServer


SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

import local_setup_bridge as bridge  # noqa: E402


class SetupBridgeRegressionTests(unittest.TestCase):
    def test_bot_config_returns_2xx_and_restarts_failed_poller(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            env_path = root / ".env.local"
            state_path = root / ".local-setup-state.json"
            # This is the fresh-host state after bootstrap: no bot secrets yet
            # and the poller has already failed because its token is missing.
            env_path.write_text("LOCAL_SETUP_TOKEN=bridge-test-token\n", encoding="utf-8")
            service_states = {
                "relaydesk-web.service": "active",
                "relaydesk-telegram-poller.service": "failed",
                "relaydesk-listener.service": "inactive",
            }
            commands = []

            def fake_systemctl(command, **_kwargs):
                commands.append(command)
                self.assertEqual(command[:4], ["sudo", "-n", "systemctl", "restart"])
                service = command[4]
                service_states[service] = "active"

            def fake_bot_api(_token, method, _payload=None):
                if method == "getMe":
                    return {"id": 123, "username": "relaydesk_test_bot"}
                if method == "deleteWebhook":
                    return True
                raise AssertionError(f"unexpected Bot API method: {method}")

            with (
                patch.object(bridge, "ENV_PATH", env_path),
                patch.object(bridge, "STATE_PATH", state_path),
                patch.object(bridge, "telegram_bot_api", side_effect=fake_bot_api),
                patch.object(bridge.subprocess, "run", side_effect=fake_systemctl),
                patch.object(bridge.os, "name", "posix"),
            ):
                server = ThreadingHTTPServer(("127.0.0.1", 0), bridge.SetupHandler)
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                try:
                    request = Request(
                        f"http://127.0.0.1:{server.server_port}/bot-config",
                        data=json.dumps({"token": "12345:ABCDEFGHIJKLMNOPQRSTUVWXYZ"}).encode(),
                        headers={
                            "Authorization": "Bearer bridge-test-token",
                            "Content-Type": "application/json",
                        },
                        method="POST",
                    )
                    with urlopen(request, timeout=5) as response:
                        payload = json.loads(response.read().decode("utf-8"))
                        self.assertGreaterEqual(response.status, 200)
                        self.assertLess(response.status, 300)
                finally:
                    server.shutdown()
                    thread.join(timeout=5)
                    server.server_close()

            self.assertTrue(payload["configured"])
            self.assertEqual(service_states["relaydesk-telegram-poller.service"], "active")
            self.assertEqual(
                commands,
                [
                    ["sudo", "-n", "systemctl", "restart", "relaydesk-web.service"],
                    ["sudo", "-n", "systemctl", "restart", "relaydesk-telegram-poller.service"],
                    ["sudo", "-n", "systemctl", "restart", "relaydesk-listener.service"],
                ],
            )
            self.assertIn("TELEGRAM_BOT_TOKEN=12345:ABCDEFGHIJKLMNOPQRSTUVWXYZ", env_path.read_text())


if __name__ == "__main__":
    unittest.main()
