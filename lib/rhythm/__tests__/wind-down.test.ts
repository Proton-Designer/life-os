import { describe, expect, it } from "vitest";
import { deriveWindDown, eveningWindDownStart, validateWindDownInputs } from "../wind-down";

describe("deriveWindDown", () => {
  it("wake 07:00, need 8h, wind-down 45 → bed 23:00, wind-down 22:15", () => {
    expect(deriveWindDown({ wakeTime: "07:00", sleepNeedMinutes: 480, windDownMinutes: 45 })).toEqual({ bedtime: "23:00", windDownStart: "22:15", windDownMinutes: 45 });
  });
  it("defaults the wind-down to 45 when unset", () => {
    expect(deriveWindDown({ wakeTime: "07:00", sleepNeedMinutes: 480, windDownMinutes: null })?.windDownStart).toBe("22:15");
  });
  it("wraps past midnight backwards: wake 05:30, need 8h → bed 21:30, wind-down 20:45", () => {
    expect(deriveWindDown({ wakeTime: "05:30", sleepNeedMinutes: 480, windDownMinutes: 45 })).toMatchObject({ bedtime: "21:30", windDownStart: "20:45" });
  });
  it("wraps when the wind-down start crosses midnight: wake 09:00, need 9h → bed 24:00=00:00, wind-down 23:15", () => {
    expect(deriveWindDown({ wakeTime: "09:00", sleepNeedMinutes: 540, windDownMinutes: 45 })).toMatchObject({ bedtime: "00:00", windDownStart: "23:15" });
  });
  it("is null (use the default) when anything is unset or out of range", () => {
    expect(deriveWindDown({ wakeTime: null, sleepNeedMinutes: 480, windDownMinutes: 45 })).toBeNull();
    expect(deriveWindDown({ wakeTime: "07:00", sleepNeedMinutes: null, windDownMinutes: 45 })).toBeNull();
    expect(deriveWindDown({ wakeTime: "7:00", sleepNeedMinutes: 480, windDownMinutes: 45 })).toBeNull();
    expect(deriveWindDown({ wakeTime: "07:00", sleepNeedMinutes: 100, windDownMinutes: 45 })).toBeNull();
    expect(deriveWindDown({ wakeTime: "07:00", sleepNeedMinutes: 480, windDownMinutes: 5 })).toBeNull();
  });
});

describe("eveningWindDownStart", () => {
  it("returns only evening starts (>= 15:00); a small-hours start is ignored so Home/reminder keep their defaults", () => {
    expect(eveningWindDownStart(deriveWindDown({ wakeTime: "07:00", sleepNeedMinutes: 480, windDownMinutes: 45 }))).toBe("22:15");
    expect(eveningWindDownStart(deriveWindDown({ wakeTime: "13:00", sleepNeedMinutes: 480, windDownMinutes: 45 }))).toBeNull(); // bed 05:00
    expect(eveningWindDownStart(null)).toBeNull();
  });
});

describe("validateWindDownInputs", () => {
  it("accepts a good plan and names the bad field otherwise", () => {
    expect(validateWindDownInputs({ wakeTime: "07:00", sleepNeedMinutes: 480, windDownMinutes: 45 })).toBeNull();
    expect(validateWindDownInputs({ wakeTime: "25:00", sleepNeedMinutes: 480, windDownMinutes: 45 })).toMatch(/wake time/i);
    expect(validateWindDownInputs({ wakeTime: "07:00", sleepNeedMinutes: 300, windDownMinutes: 45 })).toMatch(/6 and 10/);
    expect(validateWindDownInputs({ wakeTime: "07:00", sleepNeedMinutes: 480, windDownMinutes: 200 })).toMatch(/15 to 120/);
  });
});
