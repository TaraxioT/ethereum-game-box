import { defineConfig } from "@playwright/test";

const PORT = 5175;

// The passkey flow in Chromium, with a CDP virtual authenticator standing in for the device. The site runs on the
// Vite dev server in `--mode e2e` (test addresses from `e2e/deployments.json`); its RPC and relayer point at hosts the
// test answers itself, so nothing reaches Sepolia or the live relayer.
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  use: { baseURL: `http://localhost:${PORT}`, browserName: "chromium" },
  webServer: {
    command: `vite --mode e2e --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    env: { VITE_RPC_URLS: "https://rpc.test", VITE_RELAYER_URL: "https://relayer.test" },
  },
});
