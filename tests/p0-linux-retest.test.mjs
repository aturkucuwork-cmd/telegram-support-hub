import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("P0 Linux retest runner is guarded and fail-closed", async () => {
  const runner = await readFile("deploy/p0-linux-retest.sh", "utf8");

  assert.match(runner, /set -euo pipefail/);
  assert.match(runner, /uname -s/);
  assert.match(runner, /NOT RUN/);
  assert.match(runner, /systemd-analyze verify/);
  assert.match(runner, /TELEGRAM_BOT_TOKEN/);
  assert.match(runner, /SESSION_ENCRYPTION_KEY/);
  assert.match(runner, /INTERNAL_API_SECRET/);
  assert.doesNotMatch(runner, /echo\s+.*TELEGRAM_BOT_TOKEN/);
  assert.doesNotMatch(runner, /printf\s+.*SESSION_ENCRYPTION_KEY/);
});
