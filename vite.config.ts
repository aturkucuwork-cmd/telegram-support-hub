import vinext from "vinext";
import { defineConfig } from "vite";
import { localMediaUpload } from "./build/local-media-upload-vite-plugin";
import { sites } from "./build/sites-vite-plugin";

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

export default defineConfig(async () => {
  return {
    server: {
      host: "0.0.0.0",
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [localMediaUpload(), vinext(), sites()],
  };
});
