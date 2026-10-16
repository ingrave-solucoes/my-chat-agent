/* Business hours for the human team, e.g. BUSINESS_HOURS="1-5 09:00-18:00" (Monday to Friday)
   or "1-5 09:00-18:00, 6 09:00-12:00". Days: 0 = Sunday ... 6 = Saturday. */

type Window = { days: Set<number>; start: number; end: number };

export function parseHours(spec: string): Window[] {
  return spec
    .split(",")
    .map((part) => part.trim().match(/^(\d)(?:-(\d))?\s+(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map(([, from, to, h1, m1, h2, m2]) => {
      const days = new Set<number>();
      for (let day = Number(from); day <= Number(to ?? from); day++) days.add(day);
      return { days, start: Number(h1) * 60 + Number(m1), end: Number(h2) * 60 + Number(m2) };
    });
}

/** Day of week and minutes since midnight in the given IANA time zone. */
function localTime(date: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(date)
      .map((part) => [part.type, part.value])
  );
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  return { day, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

export function isOpen(spec: string, timeZone: string, date = new Date()) {
  const windows = parseHours(spec);
  if (!windows.length) return true;
  const { day, minutes } = localTime(date, timeZone);
  return windows.some((window) => window.days.has(day) && minutes >= window.start && minutes < window.end);
}

const DAY_NAMES = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/** "segunda a sexta, das 09:00 às 18:00" for prompts and messages. */
export function describeHours(spec: string) {
  const windows = parseHours(spec);
  if (!windows.length) return "todos os dias";
  const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  return windows
    .map((window) => {
      const days = [...window.days];
      const label = days.length > 1 ? `${DAY_NAMES[days[0]]} a ${DAY_NAMES[days[days.length - 1]]}` : DAY_NAMES[days[0]];
      return `${label}, das ${hhmm(window.start)} às ${hhmm(window.end)}`;
    })
    .join("; ");
}

/** The moment `minutes` of business time have passed after `from` (checked in 15-minute steps,
    up to 14 days ahead). With no hours configured, plain minutes are added. */
export function afterBusinessMinutes(spec: string, timeZone: string, from: Date, minutes: number) {
  if (!parseHours(spec).length) return new Date(from.getTime() + minutes * 60_000);
  const step = 15;
  let left = minutes;
  let at = from.getTime();
  const limit = at + 14 * 24 * 60 * 60_000;
  while (left > 0 && at < limit) {
    if (isOpen(spec, timeZone, new Date(at))) left -= step;
    at += step * 60_000;
  }
  return new Date(at);
}
