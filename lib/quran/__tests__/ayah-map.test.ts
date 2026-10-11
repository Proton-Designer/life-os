import { describe, expect, it } from "vitest";
import { PAGE_START_AYAH, TOTAL_AYAHS, ayahLabel, ayahRef, firstAyahOfPage, globalAyah, lastAyahOfPage, pageOfAyah, pageSpanAyahLabel, verifyAyahMap } from "../ayah-map";
import { PAGE_FIRST_SURAH } from "../page-map";

describe("ayah map", () => {
  it("is internally consistent (positive control: a corrupted copy is caught)", () => {
    expect(verifyAyahMap()).toEqual([]);
    const broken = [...PAGE_START_AYAH];
    broken[10] = broken[9];
    expect(verifyAyahMap(broken).length).toBeGreaterThan(0);
    expect(verifyAyahMap(PAGE_START_AYAH.slice(1)).length).toBeGreaterThan(0);
  });
  it("agrees with page-map.ts: every page opens in the same surah in both tables", () => {
    for (let p = 1; p <= 604; p++) expect(ayahRef(PAGE_START_AYAH[p - 1]).surah).toBe(PAGE_FIRST_SURAH[p - 1]);
  });
  it("global numbers round-trip and the ends are right", () => {
    expect(globalAyah(1, 1)).toBe(1);
    expect(globalAyah(2, 1)).toBe(8);
    expect(globalAyah(114, 6)).toBe(TOTAL_AYAHS);
    expect(globalAyah(2, 287)).toBeNull();
    expect(globalAyah(115, 1)).toBeNull();
    for (const g of [1, 7, 8, 293, 6000, 6236]) {
      const r = ayahRef(g);
      expect(globalAyah(r.surah, r.ayah)).toBe(g);
    }
    expect(ayahLabel(149)).toBe("Al-Baqara 2:142");
  });
  it("pages and ayahs map both ways (juz 2 starts at 2:142 on page 22)", () => {
    expect(pageOfAyah(globalAyah(2, 142)!)).toBe(22);
    expect(firstAyahOfPage(22)).toBe(globalAyah(2, 142));
    expect(pageOfAyah(1)).toBe(1);
    expect(pageOfAyah(TOTAL_AYAHS)).toBe(604);
    expect(lastAyahOfPage(604)).toBe(TOTAL_AYAHS);
    expect(lastAyahOfPage(1)).toBe(7);
    for (let p = 1; p <= 604; p++) {
      expect(pageOfAyah(firstAyahOfPage(p))).toBe(p);
      expect(pageOfAyah(lastAyahOfPage(p))).toBe(p);
    }
  });
  it("labels a span of pages", () => {
    expect(pageSpanAyahLabel(1, 1)).toBe("Al-Faatiha 1:1 – 7");
    expect(pageSpanAyahLabel(1, 2)).toMatch(/^Al-Faatiha 1:1 – Al-Baqara 2:5$/);
  });
});
