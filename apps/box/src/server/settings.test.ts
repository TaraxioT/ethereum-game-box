import { describe, expect, it } from "vitest";
import { readSettings, SettingsError } from "./settings.ts";

const HOME = "/home/pi";
const REPO = "/opt/egb";

describe("settings", () => {
  it("has the Pi's defaults", () => {
    expect(readSettings({}, HOME, REPO)).toEqual({
      host: "127.0.0.1",
      port: 8790,
      dataDir: "/home/pi/.local/share/egb",
      screenDir: "/opt/egb/apps/box/dist/screen",
      receiver: { kind: "auto" },
      stations: ["e4ba70", "df3d88"],
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
    });
    expect(readSettings({ EGB_RECEIVER: "fake" }, HOME, REPO).receiver).toEqual({ kind: "fake" });
    expect(readSettings({ EGB_RECEIVER: "none" }, HOME, REPO).receiver).toEqual({ kind: "none" });
  });

  it("names every bad value at once", () => {
    const read = () => readSettings({ EGB_PORT: "80a", EGB_RECEIVER: "ttyACM0", EGB_STATIONS: "e4ba70" }, HOME, REPO);
    expect(read).toThrow(SettingsError);
    try {
      read();
    } catch (error) {
      expect((error as SettingsError).problems).toHaveLength(3);
    }
    expect(() => readSettings({ EGB_STATIONS: "e4ba70,e4ba70" }, HOME, REPO)).toThrow(/two different/);
    expect(() => readSettings({ EGB_PORT: "70000" }, HOME, REPO)).toThrow(/EGB_PORT/);
  });
});
