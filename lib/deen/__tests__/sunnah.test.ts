import { describe, expect, it } from "vitest";
import { RAWATIB, sunnahForPrayer } from "../sunnah";

describe("RAWATIB", () => {
  it("has exactly the 7 rawatib prescribed by the spec", () => {
    expect(RAWATIB).toHaveLength(7);
  });

  it("has unique (prayerName, slot) pairs, matching the DB's unique constraint", () => {
    const keys = RAWATIB.map((s) => `${s.prayerName}-${s.slot}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("sunnahForPrayer", () => {
  it("returns only a before-slot for Fajr", () => {
    const result = sunnahForPrayer("fajr");
    expect(result).toEqual([{ prayerName: "fajr", slot: "before", rakah: 2, emphasis: "mu'akkadah" }]);
  });

  it("returns before and after slots for Dhuhr", () => {
    const result = sunnahForPrayer("dhuhr");
    expect(result).toEqual([
      { prayerName: "dhuhr", slot: "before", rakah: 4, emphasis: "mu'akkadah" },
      { prayerName: "dhuhr", slot: "after", rakah: 2, emphasis: "mu'akkadah" },
    ]);
  });

  it("returns only a non-mu'akkadah before-slot for Asr", () => {
    const result = sunnahForPrayer("asr");
    expect(result).toEqual([{ prayerName: "asr", slot: "before", rakah: 4, emphasis: "ghayr mu'akkadah" }]);
  });

  it("returns only an after-slot for Maghrib", () => {
    const result = sunnahForPrayer("maghrib");
    expect(result).toEqual([{ prayerName: "maghrib", slot: "after", rakah: 2, emphasis: "mu'akkadah" }]);
  });

  it("returns after and witr slots for Isha", () => {
    const result = sunnahForPrayer("isha");
    expect(result).toEqual([
      { prayerName: "isha", slot: "after", rakah: 2, emphasis: "mu'akkadah" },
      { prayerName: "isha", slot: "witr", rakah: 3, emphasis: "witr" },
    ]);
  });
});
