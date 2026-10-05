import { describe, expect, it } from "vitest";
import {
  JUZ_START_PAGES,
  PAGE_FIRST_SURAH,
  SURAHS,
  TOTAL_PAGES,
  juzForPage,
  surahAtPage,
  surahLabelForSpan,
  surahsInSpan,
  verifyPageMap,
} from "../page-map";

// The juz start pages in the approved design (QURAN-DESIGN.md), independent of the generated table.
const DESIGN_JUZ_STARTS = [1, 22, 42, 62, 82, 102, 121, 142, 162, 182, 201, 222, 242, 262, 282, 302, 322, 342, 362, 382, 402, 422, 442, 462, 482, 502, 522, 542, 562, 582];

describe("page map invariants (verified against Tanzil's Madani metadata)", () => {
  it("is internally consistent: 114 surahs, 30 juz, 604 pages, monotonic, 6236 ayahs", () => {
    expect(verifyPageMap()).toEqual([]);
    expect(SURAHS).toHaveLength(114);
    expect(PAGE_FIRST_SURAH).toHaveLength(TOTAL_PAGES);
  });
  it("matches the approved design's juz start pages exactly", () => {
    expect([...JUZ_START_PAGES]).toEqual(DESIGN_JUZ_STARTS);
  });
  it("known anchors: p1 Al-Fatiha, p2 Al-Baqara, p582 An-Naba (juz 30), p604 Al-Ikhlas/Al-Falaq/An-Nas", () => {
    expect(surahAtPage(1).transliteration).toBe("Al-Faatiha");
    expect(surahAtPage(2).transliteration).toBe("Al-Baqara");
    expect(SURAHS[77].transliteration).toBe("An-Naba");
    expect(SURAHS[77].startPage).toBe(582);
    expect(juzForPage(581)).toBe(29);
    expect(juzForPage(582)).toBe(30);
    expect([112, 113, 114].map((n) => SURAHS[n - 1].startPage)).toEqual([604, 604, 604]);
    expect(surahsInSpan(604, 604).map((s) => s.number)).toEqual([112, 113, 114]);
  });
  it("juzForPage lands on each boundary and clamps out-of-range pages", () => {
    DESIGN_JUZ_STARTS.forEach((p, i) => {
      expect(juzForPage(p)).toBe(i + 1);
      if (p > 1) expect(juzForPage(p - 1)).toBe(i);
    });
    expect(juzForPage(0)).toBe(1);
    expect(juzForPage(9999)).toBe(30);
  });
  it("a surah that starts mid-page shares that page with the previous surah's end", () => {
    // Al-Maaida (5) starts part-way down page 106, which opens in An-Nisaa (4); Aal-i-Imraan (3) starts at the TOP of page 50.
    expect(surahAtPage(106).number).toBe(4);
    expect(surahsInSpan(106, 106).map((s) => s.number)).toEqual([4, 5]);
    expect(surahLabelForSpan(106, 106)).toBe(`${SURAHS[3].transliteration} – ${SURAHS[4].transliteration}`);
    expect(surahAtPage(50).number).toBe(3);
    expect(surahsInSpan(50, 50).map((s) => s.number)).toEqual([3]);
    expect(surahLabelForSpan(2, 5)).toBe("Al-Baqara");
    // a span across several surahs reads "first – last", never "+N"
    const across = surahsInSpan(2, 187);
    expect(across[0].number).toBe(2);
    expect(across[across.length - 1].number).toBe(9);
    expect(surahLabelForSpan(2, 187)).toBe("Al-Baqara – At-Tawba");
    expect(surahLabelForSpan(1, 60)).toBe(`${SURAHS[0].transliteration} – ${SURAHS[2].transliteration}`);
    expect(surahLabelForSpan(1, 60)).not.toMatch(/\+/);
  });
  it("positive control: verifyPageMap catches corrupted tables", () => {
    const good = { surahs: SURAHS, juzStartPages: JUZ_START_PAGES, pageFirstSurah: PAGE_FIRST_SURAH };
    expect(verifyPageMap({ ...good, surahs: SURAHS.slice(0, 113) }).join()).toMatch(/114 surahs/);
    expect(verifyPageMap({ ...good, juzStartPages: [...JUZ_START_PAGES.slice(0, 29), 581] }).join()).toMatch(/juz 30 must start on page 582/);
    const swapped = SURAHS.map((s, i) => (i === 10 ? { ...s, startPage: 1 } : s));
    expect(verifyPageMap({ ...good, surahs: swapped }).join()).toMatch(/starts before/);
    const brokenPages = [...PAGE_FIRST_SURAH];
    brokenPages[300] = 1;
    expect(verifyPageMap({ ...good, pageFirstSurah: brokenPages }).join()).toMatch(/earlier surah/);
  });
});
