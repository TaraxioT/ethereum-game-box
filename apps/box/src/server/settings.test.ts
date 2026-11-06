import { describe, expect, it } from "vitest";
import { readSettings, SettingsError } from "./settings.ts";

const HOME = "/home/pi";
const REPO = "/opt/egb";
const SIGNER = "python3 /home/pi/egb/current/deploy/p256-signer/hyp2003_signer.py --serve";
const CHAIN = { P256_SIGNER_CMD: SIGNER, RELAYER_URL: "https://relayer.example", SEPOLIA_RPC_URL: "https://rpc.example/v2/secret-key" };

describe("settings", () => {
  it("has the Pi's defaults", () => {
    expect(readSettings(CHAIN, HOME, REPO)).toEqual({
      host: "127.0.0.1",
      port: 8790,
      dataDir: "/home/pi/.local/share/egb",
      screenDir: "/opt/egb/apps/box/dist/screen",
      receiver: { kind: "auto" },
      stations: ["df3b9c", "df3d88"],
      chain: { kind: "sepolia", signerCmd: SIGNER, relayerUrl: "https://relayer.example", rpcUrl: "https://rpc.example/v2/secret-key", box: "mumbai-01" },
    });
  });

  it("reads every setting, with ~ and paths from the repo root", () => {
    const settings = readSettings(
      {
        EGB_PORT: "9000",
        EGB_HOST: "0.0.0.0",
        EGB_DATA: "~/egb-data",
        EGB_SCREEN_DIR: "build/screen",
        EGB_RECEIVER: "/dev/serial/by-id/usb-Espressif_USB_JTAG_serial_debug_unit_7C:DF:A1:D5:04:CC-if00",
        EGB_STATIONS: " DF3D88 , e4ba70 ",
        EGB_BOX: "demo-01",
        ...CHAIN,
      },
      HOME,
      REPO,
    );
    expect(settings).toEqual({
      host: "0.0.0.0",
      port: 9000,
      dataDir: "/home/pi/egb-data",
      screenDir: "/opt/egb/build/screen",
      receiver: { kind: "serial", path: "/dev/serial/by-id/usb-Espressif_USB_JTAG_serial_debug_unit_7C:DF:A1:D5:04:CC-if00" },
      stations: ["df3d88", "e4ba70"],
      chain: { kind: "sepolia", signerCmd: SIGNER, relayerUrl: "https://relayer.example", rpcUrl: "https://rpc.example/v2/secret-key", box: "demo-01" },
    });
    expect(readSettings({ EGB_RECEIVER: "fake" }, HOME, REPO).receiver).toEqual({ kind: "fake" });
    expect(readSettings({ EGB_RECEIVER: "none" }, HOME, REPO).receiver).toEqual({ kind: "none" });
  });

  it("names every bad value at once", () => {
    const read = () => readSettings({ EGB_PORT: "80a", EGB_RECEIVER: "ttyACM0", EGB_STATIONS: "e4ba70", ...CHAIN }, HOME, REPO);
    expect(read).toThrow(SettingsError);
    try {
      read();
    } catch (error) {
      expect((error as SettingsError).problems).toHaveLength(3);
    }
    expect(() => readSettings({ EGB_STATIONS: "e4ba70,e4ba70", ...CHAIN }, HOME, REPO)).toThrow(/two different/);
    expect(() => readSettings({ EGB_PORT: "70000", ...CHAIN }, HOME, REPO)).toThrow(/EGB_PORT/);
  });

  it("runs on the demo chain only as the simulator, and needs all three chain settings otherwise", () => {
    expect(readSettings({ EGB_RECEIVER: "fake" }, HOME, REPO).chain).toEqual({ kind: "demo" });
    expect(readSettings({ EGB_RECEIVER: "none" }, HOME, REPO).chain).toEqual({ kind: "demo" });
    expect(() => readSettings({}, HOME, REPO)).toThrow(/P256_SIGNER_CMD, RELAYER_URL, SEPOLIA_RPC_URL/);
    // Half set is a mistake even for the simulator; the RPC URL (it holds a key) is never echoed.
    const half = () => readSettings({ EGB_RECEIVER: "fake", SEPOLIA_RPC_URL: CHAIN.SEPOLIA_RPC_URL }, HOME, REPO);
    expect(half).toThrow(/P256_SIGNER_CMD, RELAYER_URL/);
    expect(() => readSettings({ ...CHAIN, SEPOLIA_RPC_URL: "not a url secret-key" }, HOME, REPO)).toThrow(/SEPOLIA_RPC_URL must be/);
    try {
      readSettings({ ...CHAIN, SEPOLIA_RPC_URL: "not a url secret-key" }, HOME, REPO);
    } catch (error) {
      expect(String(error)).not.toContain("secret-key");
    }
  });
});
