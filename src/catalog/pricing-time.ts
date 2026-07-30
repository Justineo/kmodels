import { publishedTimePrecisions } from "./pricing-vocabulary.ts";

export type PublishedTimePrecision = (typeof publishedTimePrecisions)[number];

export interface PublishedTimeBoundaryLike {
  value: string;
  precision: PublishedTimePrecision;
  inclusive?: boolean | undefined;
}

interface PublishedValidityLike {
  from?: PublishedTimeBoundaryLike | undefined;
  until?: PublishedTimeBoundaryLike | undefined;
}

export function canonicalizeInstant(value: string): string {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (match === null) throw new Error("Invalid RFC 3339 instant");
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, digits = "", zone] =
    match;
  if (
    yearText === undefined ||
    monthText === undefined ||
    dayText === undefined ||
    hourText === undefined ||
    minuteText === undefined ||
    secondText === undefined ||
    zone === undefined
  )
    throw new Error("Invalid RFC 3339 instant");

  let date = {
    year: Number(yearText),
    month: Number(monthText),
    day: Number(dayText),
  };
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (!isCalendarDate(date.year, date.month, date.day) || hour > 23 || minute > 59 || second > 59)
    throw new Error("Invalid RFC 3339 instant");

  let utcMinutes = hour * 60 + minute;
  if (zone !== "Z") {
    if (zone === "-00:00") throw new Error("Unknown local offset is not canonicalizable");
    const offsetHour = Number(zone.slice(1, 3));
    const offsetMinute = Number(zone.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) throw new Error("Invalid RFC 3339 offset");
    const offset = offsetHour * 60 + offsetMinute;
    utcMinutes += zone[0] === "+" ? -offset : offset;
  }
  if (utcMinutes < 0) {
    utcMinutes += 24 * 60;
    date = shiftDate(date, -1);
  } else if (utcMinutes >= 24 * 60) {
    utcMinutes -= 24 * 60;
    date = shiftDate(date, 1);
  }
  const fraction = digits.replace(/0+$/, "").padEnd(3, "0");
  return `${pad(date.year, 4)}-${pad(date.month)}-${pad(date.day)}T${pad(
    Math.floor(utcMinutes / 60),
  )}:${pad(utcMinutes % 60)}:${pad(second)}.${fraction}Z`;
}

export function isCanonicalInstant(value: string): boolean {
  try {
    return canonicalizeInstant(value) === value;
  } catch {
    return false;
  }
}

export function isPublishedTime(value: string, precision: PublishedTimePrecision): boolean {
  if (precision === "datetime") return isCanonicalInstant(value);
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(value);
  if (match === null) return false;
  const [, yearText, monthText, dayText] = match;
  if (
    yearText === undefined ||
    (precision === "year" && monthText !== undefined) ||
    (precision === "month" && (monthText === undefined || dayText !== undefined)) ||
    (precision === "date" && dayText === undefined)
  )
    return false;
  const year = Number(yearText);
  if (year < 1) return false;
  if (monthText === undefined) return true;
  const month = Number(monthText);
  if (month < 1 || month > 12) return false;
  return dayText === undefined || isCalendarDate(year, month, Number(dayText));
}

export function publishedValidityIsCoherent(
  from: PublishedTimeBoundaryLike | undefined,
  until: PublishedTimeBoundaryLike | undefined,
): boolean {
  if (from === undefined || until === undefined) return true;
  const comparison = comparePublishedTimes(from, until);
  return !(
    comparison > 0 ||
    (comparison === 0 &&
      from.precision === until.precision &&
      from.value === until.value &&
      (from.inclusive === false || until.inclusive === false))
  );
}

export function publishedValiditiesOverlap(
  left: PublishedValidityLike | undefined,
  right: PublishedValidityLike | undefined,
): boolean {
  return !(endsBefore(left?.until, right?.from) || endsBefore(right?.until, left?.from));
}

function endsBefore(
  until: PublishedTimeBoundaryLike | undefined,
  from: PublishedTimeBoundaryLike | undefined,
): boolean {
  if (until === undefined || from === undefined) return false;
  const comparison = comparePublishedTimes(until, from);
  if (comparison !== 0) return comparison < 0;
  return (
    until.precision === from.precision &&
    until.value === from.value &&
    (until.inclusive === false || from.inclusive === false)
  );
}

function comparePublishedTimes(
  from: PublishedTimeBoundaryLike,
  until: PublishedTimeBoundaryLike,
): number {
  const precision =
    publishedTimePrecisions[
      Math.min(
        publishedTimePrecisions.indexOf(from.precision),
        publishedTimePrecisions.indexOf(until.precision),
      )
    ]!;
  if (precision !== "datetime") {
    const length = precision === "year" ? 4 : precision === "month" ? 7 : 10;
    return compareAscii(from.value.slice(0, length), until.value.slice(0, length));
  }
  const [fromWhole, fromFraction = ""] = from.value.slice(0, -1).split(".");
  const [untilWhole, untilFraction = ""] = until.value.slice(0, -1).split(".");
  const whole = compareAscii(fromWhole!, untilWhole!);
  if (whole !== 0) return whole;
  const width = Math.max(fromFraction.length, untilFraction.length);
  return compareAscii(fromFraction.padEnd(width, "0"), untilFraction.padEnd(width, "0"));
}

function shiftDate(
  date: { year: number; month: number; day: number },
  direction: -1 | 1,
): { year: number; month: number; day: number } {
  let { year, month, day } = date;
  day += direction;
  if (direction === 1 && day > daysInMonth(year, month)) {
    day = 1;
    month += 1;
    if (month === 13) {
      month = 1;
      year += 1;
    }
  } else if (direction === -1 && day === 0) {
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
    day = daysInMonth(year, month);
  }
  if (year < 1 || year > 9_999) throw new Error("UTC instant is outside the supported year range");
  return { year, month, day };
}

function isCalendarDate(year: number, month: number, day: number): boolean {
  return (
    year >= 1 &&
    year <= 9_999 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month)
  );
}

function daysInMonth(year: number, month: number): number {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
