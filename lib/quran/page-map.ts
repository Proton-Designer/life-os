// QURAN-01: the Madani Mushaf (604 pages) page map: where every surah and juz starts. STATIC DATA, verified.
//
// SOURCE: Tanzil.info Quran metadata (tanzil.net/res/text/metadata/quran-data.js, "Quran Metadata ver 1.0", Creative
// Commons Attribution 3.0): its Page table gives the (surah, ayah) each of the 604 Madani pages STARTS at, its Juz table
// the 30 juz starts, its Sura table the names and ayah counts. A surah's start page = the page whose range contains
// (surah, 1); PAGE_FIRST_SURAH[p-1] = the surah of page p's first ayah (a surah that starts mid-page still shares the
// page with the end of the previous one, which is why both are available). Cross-checked against the juz start pages in
// the approved design (QURAN-DESIGN.md) and by verifyPageMap() below, which the tests run (with a corrupted copy as the
// positive control).
//
// Pure data + pure helpers: client-safe, no server-only.

export const TOTAL_PAGES = 604;

export type SurahInfo = { number: number; startPage: number; ayahs: number; arabic: string; transliteration: string; english: string };

// [number, startPage, ayahs, arabic, transliteration, english]
const SURAH_ROWS: ReadonlyArray<readonly [number, number, number, string, string, string]> = [
  [1, 1, 7, "الفاتحة", "Al-Faatiha", "The Opening"],
  [2, 2, 286, "البقرة", "Al-Baqara", "The Cow"],
  [3, 50, 200, "آل عمران", "Aal-i-Imraan", "The Family of Imraan"],
  [4, 77, 176, "النساء", "An-Nisaa", "The Women"],
  [5, 106, 120, "المائدة", "Al-Maaida", "The Table"],
  [6, 128, 165, "الأنعام", "Al-An'aam", "The Cattle"],
  [7, 151, 206, "الأعراف", "Al-A'raaf", "The Heights"],
  [8, 177, 75, "الأنفال", "Al-Anfaal", "The Spoils of War"],
  [9, 187, 129, "التوبة", "At-Tawba", "The Repentance"],
  [10, 208, 109, "يونس", "Yunus", "Jonas"],
  [11, 221, 123, "هود", "Hud", "Hud"],
  [12, 235, 111, "يوسف", "Yusuf", "Joseph"],
  [13, 249, 43, "الرعد", "Ar-Ra'd", "The Thunder"],
  [14, 255, 52, "ابراهيم", "Ibrahim", "Abraham"],
  [15, 262, 99, "الحجر", "Al-Hijr", "The Rock"],
  [16, 267, 128, "النحل", "An-Nahl", "The Bee"],
  [17, 282, 111, "الإسراء", "Al-Israa", "The Night Journey"],
  [18, 293, 110, "الكهف", "Al-Kahf", "The Cave"],
  [19, 305, 98, "مريم", "Maryam", "Mary"],
  [20, 312, 135, "طه", "Taa-Haa", "Taa-Haa"],
  [21, 322, 112, "الأنبياء", "Al-Anbiyaa", "The Prophets"],
  [22, 332, 78, "الحج", "Al-Hajj", "The Pilgrimage"],
  [23, 342, 118, "المؤمنون", "Al-Muminoon", "The Believers"],
  [24, 350, 64, "النور", "An-Noor", "The Light"],
  [25, 359, 77, "الفرقان", "Al-Furqaan", "The Criterion"],
  [26, 367, 227, "الشعراء", "Ash-Shu'araa", "The Poets"],
  [27, 377, 93, "النمل", "An-Naml", "The Ant"],
  [28, 385, 88, "القصص", "Al-Qasas", "The Stories"],
  [29, 396, 69, "العنكبوت", "Al-Ankaboot", "The Spider"],
  [30, 404, 60, "الروم", "Ar-Room", "The Romans"],
  [31, 411, 34, "لقمان", "Luqman", "Luqman"],
  [32, 415, 30, "السجدة", "As-Sajda", "The Prostration"],
  [33, 418, 73, "الأحزاب", "Al-Ahzaab", "The Clans"],
  [34, 428, 54, "سبإ", "Saba", "Sheba"],
  [35, 434, 45, "فاطر", "Faatir", "The Originator"],
  [36, 440, 83, "يس", "Yaseen", "Yaseen"],
  [37, 446, 182, "الصافات", "As-Saaffaat", "Those drawn up in Ranks"],
  [38, 453, 88, "ص", "Saad", "The letter Saad"],
  [39, 458, 75, "الزمر", "Az-Zumar", "The Groups"],
  [40, 467, 85, "غافر", "Al-Ghaafir", "The Forgiver"],
  [41, 477, 54, "فصلت", "Fussilat", "Explained in detail"],
  [42, 483, 53, "الشورى", "Ash-Shura", "Consultation"],
  [43, 489, 89, "الزخرف", "Az-Zukhruf", "Ornaments of gold"],
  [44, 496, 59, "الدخان", "Ad-Dukhaan", "The Smoke"],
  [45, 499, 37, "الجاثية", "Al-Jaathiya", "Crouching"],
  [46, 502, 35, "الأحقاف", "Al-Ahqaf", "The Dunes"],
  [47, 507, 38, "محمد", "Muhammad", "Muhammad"],
  [48, 511, 29, "الفتح", "Al-Fath", "The Victory"],
  [49, 515, 18, "الحجرات", "Al-Hujuraat", "The Inner Apartments"],
  [50, 518, 45, "ق", "Qaaf", "The letter Qaaf"],
  [51, 520, 60, "الذاريات", "Adh-Dhaariyat", "The Winnowing Winds"],
  [52, 523, 49, "الطور", "At-Tur", "The Mount"],
  [53, 526, 62, "النجم", "An-Najm", "The Star"],
  [54, 528, 55, "القمر", "Al-Qamar", "The Moon"],
  [55, 531, 78, "الرحمن", "Ar-Rahmaan", "The Beneficent"],
  [56, 534, 96, "الواقعة", "Al-Waaqia", "The Inevitable"],
  [57, 537, 29, "الحديد", "Al-Hadid", "The Iron"],
  [58, 542, 22, "المجادلة", "Al-Mujaadila", "The Pleading Woman"],
  [59, 545, 24, "الحشر", "Al-Hashr", "The Exile"],
  [60, 549, 13, "الممتحنة", "Al-Mumtahana", "She that is to be examined"],
  [61, 551, 14, "الصف", "As-Saff", "The Ranks"],
  [62, 553, 11, "الجمعة", "Al-Jumu'a", "Friday"],
  [63, 554, 11, "المنافقون", "Al-Munaafiqoon", "The Hypocrites"],
  [64, 556, 18, "التغابن", "At-Taghaabun", "Mutual Disillusion"],
  [65, 558, 12, "الطلاق", "At-Talaaq", "Divorce"],
  [66, 560, 12, "التحريم", "At-Tahrim", "The Prohibition"],
  [67, 562, 30, "الملك", "Al-Mulk", "The Sovereignty"],
  [68, 564, 52, "القلم", "Al-Qalam", "The Pen"],
  [69, 566, 52, "الحاقة", "Al-Haaqqa", "The Reality"],
  [70, 568, 44, "المعارج", "Al-Ma'aarij", "The Ascending Stairways"],
  [71, 570, 28, "نوح", "Nooh", "Noah"],
  [72, 572, 28, "الجن", "Al-Jinn", "The Jinn"],
  [73, 574, 20, "المزمل", "Al-Muzzammil", "The Enshrouded One"],
  [74, 575, 56, "المدثر", "Al-Muddaththir", "The Cloaked One"],
  [75, 577, 40, "القيامة", "Al-Qiyaama", "The Resurrection"],
  [76, 578, 31, "الانسان", "Al-Insaan", "Man"],
  [77, 580, 50, "المرسلات", "Al-Mursalaat", "The Emissaries"],
  [78, 582, 40, "النبإ", "An-Naba", "The Announcement"],
  [79, 583, 46, "النازعات", "An-Naazi'aat", "Those who drag forth"],
  [80, 585, 42, "عبس", "Abasa", "He frowned"],
  [81, 586, 29, "التكوير", "At-Takwir", "The Overthrowing"],
  [82, 587, 19, "الإنفطار", "Al-Infitaar", "The Cleaving"],
  [83, 587, 36, "المطففين", "Al-Mutaffifin", "Defrauding"],
  [84, 589, 25, "الإنشقاق", "Al-Inshiqaaq", "The Splitting Open"],
  [85, 590, 22, "البروج", "Al-Burooj", "The Constellations"],
  [86, 591, 17, "الطارق", "At-Taariq", "The Morning Star"],
  [87, 591, 19, "الأعلى", "Al-A'laa", "The Most High"],
  [88, 592, 26, "الغاشية", "Al-Ghaashiya", "The Overwhelming"],
  [89, 593, 30, "الفجر", "Al-Fajr", "The Dawn"],
  [90, 594, 20, "البلد", "Al-Balad", "The City"],
  [91, 595, 15, "الشمس", "Ash-Shams", "The Sun"],
  [92, 595, 21, "الليل", "Al-Lail", "The Night"],
  [93, 596, 11, "الضحى", "Ad-Dhuhaa", "The Morning Hours"],
  [94, 596, 8, "الشرح", "Ash-Sharh", "The Consolation"],
  [95, 597, 8, "التين", "At-Tin", "The Fig"],
  [96, 597, 19, "العلق", "Al-Alaq", "The Clot"],
  [97, 598, 5, "القدر", "Al-Qadr", "The Power, Fate"],
  [98, 598, 8, "البينة", "Al-Bayyina", "The Evidence"],
  [99, 599, 8, "الزلزلة", "Az-Zalzala", "The Earthquake"],
  [100, 599, 11, "العاديات", "Al-Aadiyaat", "The Chargers"],
  [101, 600, 11, "القارعة", "Al-Qaari'a", "The Calamity"],
  [102, 600, 8, "التكاثر", "At-Takaathur", "Competition"],
  [103, 601, 3, "العصر", "Al-Asr", "The Declining Day, Epoch"],
  [104, 601, 9, "الهمزة", "Al-Humaza", "The Traducer"],
  [105, 601, 5, "الفيل", "Al-Fil", "The Elephant"],
  [106, 602, 4, "قريش", "Quraish", "Quraysh"],
  [107, 602, 7, "الماعون", "Al-Maa'un", "Almsgiving"],
  [108, 602, 3, "الكوثر", "Al-Kawthar", "Abundance"],
  [109, 603, 6, "الكافرون", "Al-Kaafiroon", "The Disbelievers"],
  [110, 603, 3, "النصر", "An-Nasr", "Divine Support"],
  [111, 603, 5, "المسد", "Al-Masad", "The Palm Fibre"],
  [112, 604, 4, "الإخلاص", "Al-Ikhlaas", "Sincerity"],
  [113, 604, 5, "الفلق", "Al-Falaq", "The Dawn"],
  [114, 604, 6, "الناس", "An-Naas", "Mankind"],
];

export const SURAHS: readonly SurahInfo[] = SURAH_ROWS.map(([number, startPage, ayahs, arabic, transliteration, english]) => ({ number, startPage, ayahs, arabic, transliteration, english }));

/** The page each juz (1..30) starts on. */
export const JUZ_START_PAGES: readonly number[] = [1,22,42,62,82,102,121,142,162,182,201,222,242,262,282,302,322,342,362,382,402,422,442,462,482,502,522,542,562,582];

/** For page p (1-based) the surah number of its FIRST ayah. */
export const PAGE_FIRST_SURAH: readonly number[] = [1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,8,8,8,8,8,8,8,8,8,8,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,10,10,10,10,10,10,10,10,10,10,10,10,10,10,11,11,11,11,11,11,11,11,11,11,11,11,11,11,12,12,12,12,12,12,12,12,12,12,12,12,12,13,13,13,13,13,13,13,14,14,14,14,14,14,15,15,15,15,15,15,16,16,16,16,16,16,16,16,16,16,16,16,16,16,17,17,17,17,17,17,17,17,17,17,17,17,18,18,18,18,18,18,18,18,18,18,18,19,19,19,19,19,19,19,19,20,20,20,20,20,20,20,20,20,21,21,21,21,21,21,21,21,21,21,22,22,22,22,22,22,22,22,22,22,23,23,23,23,23,23,23,23,24,24,24,24,24,24,24,24,24,24,25,25,25,25,25,25,25,26,26,26,26,26,26,26,26,26,26,27,27,27,27,27,27,27,27,27,28,28,28,28,28,28,28,28,28,28,28,29,29,29,29,29,29,29,29,30,30,30,30,30,30,31,31,31,31,32,32,32,33,33,33,33,33,33,33,33,33,33,34,34,34,34,34,34,34,35,35,35,35,35,35,36,36,36,36,36,37,37,37,37,37,37,37,38,38,38,38,38,38,39,39,39,39,39,39,39,39,39,40,40,40,40,40,40,40,40,40,41,41,41,41,41,41,42,42,42,42,42,42,42,43,43,43,43,43,43,44,44,44,45,45,45,45,46,46,46,46,47,47,47,47,48,48,48,48,48,49,49,50,50,50,51,51,51,52,52,53,53,53,54,54,54,55,55,55,56,56,56,57,57,57,57,58,58,58,58,59,59,59,60,60,60,61,62,62,63,64,64,65,65,66,66,67,67,67,68,68,69,69,70,70,71,72,72,73,73,74,74,75,76,76,77,78,78,79,80,81,82,83,83,85,86,87,89,89,91,92,95,97,98,100,103,106,109,112];

export function clampPage(page: number): number {
  return Math.min(TOTAL_PAGES, Math.max(1, Math.floor(page)));
}

/** The juz (1..30) a page belongs to. */
export function juzForPage(page: number): number {
  const p = clampPage(page);
  let juz = 1;
  for (let j = 0; j < JUZ_START_PAGES.length; j++) if (JUZ_START_PAGES[j] <= p) juz = j + 1;
  return juz;
}

/** The surah containing page p's first ayah. */
export function surahAtPage(page: number): SurahInfo {
  return SURAHS[PAGE_FIRST_SURAH[clampPage(page) - 1] - 1];
}

/** Every surah touched by pages from..to, in order (the first page's opening surah, then any that START on a later page of the span). */
export function surahsInSpan(from: number, to: number): SurahInfo[] {
  const a = clampPage(from);
  const b = clampPage(Math.max(from, to));
  const first = PAGE_FIRST_SURAH[a - 1];
  const out: SurahInfo[] = [SURAHS[first - 1]];
  for (const s of SURAHS) if (s.number > first && s.startPage <= b) out.push(s);
  return out;
}

/** "Al-Baqara" for one surah, "first – last" for a span across several ("Al-Baqara – At-Tawba"). */
export function surahLabelForSpan(from: number, to: number): string {
  const list = surahsInSpan(from, to);
  if (list.length === 1) return list[0].transliteration;
  return `${list[0].transliteration} – ${list[list.length - 1].transliteration}`;
}

export type PageMapData = { surahs: readonly SurahInfo[]; juzStartPages: readonly number[]; pageFirstSurah: readonly number[] };

/** Returns a list of problems (empty = the table is internally consistent and matches the known anchors). Exported so a test can feed it a corrupted copy. */
export function verifyPageMap(data: PageMapData = { surahs: SURAHS, juzStartPages: JUZ_START_PAGES, pageFirstSurah: PAGE_FIRST_SURAH }): string[] {
  const problems: string[] = [];
  const { surahs, juzStartPages, pageFirstSurah } = data;
  if (surahs.length !== 114) problems.push(`expected 114 surahs, found ${surahs.length}`);
  surahs.forEach((s, i) => {
    if (s.number !== i + 1) problems.push(`surah #${i + 1} is numbered ${s.number}`);
    if (i > 0 && s.startPage < surahs[i - 1].startPage) problems.push(`surah ${s.number} starts before surah ${s.number - 1}`);
    if (s.startPage < 1 || s.startPage > TOTAL_PAGES) problems.push(`surah ${s.number} start page ${s.startPage} out of range`);
  });
  if (surahs[0]?.startPage !== 1) problems.push("Al-Fatiha must start on page 1");
  if (surahs[1]?.startPage !== 2) problems.push("Al-Baqara must start on page 2");
  if (surahs.reduce((n, s) => n + s.ayahs, 0) !== 6236) problems.push("ayah counts do not sum to 6236");
  if (juzStartPages.length !== 30) problems.push(`expected 30 juz starts, found ${juzStartPages.length}`);
  juzStartPages.forEach((p, i) => {
    if (i > 0 && p <= juzStartPages[i - 1]) problems.push(`juz ${i + 1} does not start after juz ${i}`);
  });
  if (juzStartPages[0] !== 1) problems.push("juz 1 must start on page 1");
  if (juzStartPages[29] !== 582) problems.push("juz 30 must start on page 582");
  if (surahs[77]?.startPage !== 582) problems.push("An-Naba (78) must start on page 582 (juz 30)");
  if (pageFirstSurah.length !== TOTAL_PAGES) problems.push(`expected ${TOTAL_PAGES} page entries, found ${pageFirstSurah.length}`);
  pageFirstSurah.forEach((n, i) => {
    if (i > 0 && n < pageFirstSurah[i - 1]) problems.push(`page ${i + 1} opens in an earlier surah than page ${i}`);
  });
  if (pageFirstSurah[0] !== 1) problems.push("page 1 must open in Al-Fatiha");
  if (pageFirstSurah[1] !== 2) problems.push("page 2 must open in Al-Baqara");
  if (pageFirstSurah[TOTAL_PAGES - 1] !== 112 && pageFirstSurah[TOTAL_PAGES - 1] !== 113 && pageFirstSurah[TOTAL_PAGES - 1] !== 114) {
    problems.push("page 604 must open in Al-Ikhlas, Al-Falaq or An-Nas");
  }
  for (const n of [112, 113, 114]) if (surahs[n - 1]?.startPage !== 604) problems.push(`surah ${n} must start on page 604`);
  return problems;
}
