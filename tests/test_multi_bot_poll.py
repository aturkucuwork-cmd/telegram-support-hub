import asyncio
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

import telegram_long_poll as poller  # noqa: E402


class MultiBotPollTests(unittest.TestCase):
    def test_poll_one_bot_relays_updates_with_its_own_bot_id_and_advances_offset(self):
        relayed = []
        get_updates_calls = {"token-a": 0}

        def fake_telegram_call(token, method, payload=None, *, timeout=35):
            if method == "getMe":
                return {"id": 1, "username": f"user_of_{token}", "can_read_all_group_messages": True}
            if method == "getWebhookInfo":
                return {}
            if method == "getUpdates":
                get_updates_calls[token] += 1
                if get_updates_calls[token] == 1:
                    return [
                        {"update_id": 1001, "message": {"message_id": 1}},
                        {"update_id": 1002, "message": {"message_id": 2}},
                    ]
                raise poller.TelegramApiError("no more updates in this test")
            raise AssertionError(f"unexpected Telegram API method: {method}")

        def fake_relay_update(update, webhook_secret, bot_id):
            relayed.append((bot_id, update["update_id"], webhook_secret))

        async def run_briefly():
            with self.assertRaises(asyncio.TimeoutError):
                await asyncio.wait_for(
                    poller.poll_one_bot(77, "token-a", "secret-xyz"),
                    timeout=0.3,
                )

        with (
            patch.object(poller, "telegram_call", side_effect=fake_telegram_call),
            patch.object(poller, "relay_update", side_effect=fake_relay_update),
        ):
            asyncio.run(run_briefly())

        self.assertEqual(relayed, [(77, 1001, "secret-xyz"), (77, 1002, "secret-xyz")])
        self.assertGreaterEqual(get_updates_calls["token-a"], 2)

    def test_a_failing_bot_does_not_stop_a_sibling_bots_polling_loop(self):
        relayed = []
        calls = {"good-token": 0, "bad-token": 0}

        def fake_telegram_call(token, method, payload=None, *, timeout=35):
            if method == "getMe":
                return {"id": 1, "username": "bot", "can_read_all_group_messages": True}
            if method == "getWebhookInfo":
                return {}
            if method == "getUpdates":
                calls[token] += 1
                if token == "bad-token":
                    raise poller.TelegramApiError("bad-token always fails")
                if calls[token] == 1:
                    return [{"update_id": 2001, "message": {"message_id": 1}}]
                raise poller.TelegramApiError("good-token has no more updates")
            raise AssertionError(f"unexpected Telegram API method: {method}")

        def fake_relay_update(update, webhook_secret, bot_id):
            relayed.append((bot_id, update["update_id"]))

        async def run_both_briefly():
            good = asyncio.create_task(poller.poll_one_bot(1, "good-token", "secret"))
            bad = asyncio.create_task(poller.poll_one_bot(2, "bad-token", "secret"))
            await asyncio.sleep(0.3)
            good.cancel()
            bad.cancel()
            for task in (good, bad):
                with self.assertRaises(asyncio.CancelledError):
                    await task

        with (
            patch.object(poller, "telegram_call", side_effect=fake_telegram_call),
            patch.object(poller, "relay_update", side_effect=fake_relay_update),
        ):
            asyncio.run(run_both_briefly())

        # The bad bot's own errors must never prevent the good bot's update
        # from being relayed with its correct, independent bot id.
        self.assertIn((1, 2001), relayed)
        self.assertGreaterEqual(calls["bad-token"], 1)


if __name__ == "__main__":
    unittest.main()
