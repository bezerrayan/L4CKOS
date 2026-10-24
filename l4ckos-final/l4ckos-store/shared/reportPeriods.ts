export const REPORT_TIME_ZONE = "America/Sao_Paulo" as const;

export type ReportPeriodMode = "today" | "7days" | "30days" | "thisMonth" | "previousMonth" | "custom" | "month" | "year";

export function isValidDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const dateParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: REPORT_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function localDateKey(date: Date) {
  const parts = Object.fromEntries(dateParts.formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function addDateDays(dateKey: string, amount: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + amount));
  return date.toISOString().slice(0, 10);
}

export function addDateMonths(dateKey: string, amount: number) {
  const [year, month] = dateKey.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1 + amount, 1));
  return `${first.getUTCFullYear()}-${String(first.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/** Convert a São Paulo local midnight to UTC without changing stored timestamps. */
export function saoPauloMidnightUtc(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const target = Date.UTC(year, month - 1, day);
  let guess = target;
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: REPORT_TIME_ZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(guess)).map(part => [part.type, part.value]));
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    const adjustment = target - represented;
    guess += adjustment;
    if (adjustment === 0) break;
  }
  return new Date(guess);
}

export function localDateRange(from: string, to: string, now?: Date) {
  const start = saoPauloMidnightUtc(from);
  const nextDay = saoPauloMidnightUtc(addDateDays(to, 1));
  const dayEnd = new Date(nextDay.getTime() - 1);
  const rangeEnd = now && to >= localDateKey(now) ? new Date(Math.min(dayEnd.getTime(), now.getTime())) : dayEnd;
  return { from: start.toISOString(), to: rangeEnd.toISOString() };
}

export function monthDateRange(year: number, month: number) {
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const next = addDateMonths(from, 1);
  const last = addDateDays(next, -1);
  return { from, to: last };
}

export function previousEquivalentRange(from: string, to: string) {
  const start = new Date(`${from}T00:00:00.000Z`).getTime();
  const end = new Date(`${to}T00:00:00.000Z`).getTime();
  const inclusiveSpan = end - start + 86_400_000;
  const previousEnd = new Date(start - 1).toISOString().slice(0, 10);
  const previousStart = new Date(start - inclusiveSpan).toISOString().slice(0, 10);
  return { from: previousStart, to: previousEnd };
}

export function reportComparisonRange(input: {
  period: ReportPeriodMode;
  from: string;
  to: string;
  selectedYear?: number;
  today: string;
}) {
  const { period, from, to, today } = input;
  if (!isValidDateKey(from) || !isValidDateKey(to) || from > to || !isValidDateKey(today)) return null;

  if (["month", "thisMonth", "previousMonth"].includes(period)) {
    const previousMonthStart = addDateMonths(`${from.slice(0, 7)}-01`, -1);
    const previousMonthEnd = addDateDays(`${from.slice(0, 7)}-01`, -1);
    if (period === "previousMonth") return { from: previousMonthStart, to: previousMonthEnd };

    const selectedMonthEnd = monthDateRange(Number(from.slice(0, 4)), Number(from.slice(5, 7))).to;
    if (period === "month" && to >= selectedMonthEnd) return { from: previousMonthStart, to: previousMonthEnd };

    const elapsedDays = Number(to.slice(8, 10));
    const previousLastDay = Number(previousMonthEnd.slice(8, 10));
    return { from: previousMonthStart, to: addDateDays(previousMonthStart, Math.min(elapsedDays, previousLastDay) - 1) };
  }

  if (period === "year") {
    const year = input.selectedYear ?? Number(from.slice(0, 4));
    if (year < Number(today.slice(0, 4))) return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` };
    const previousYear = year - 1;
    const monthDay = to.slice(5);
    const previousYearEnd = monthDateRange(previousYear, Number(monthDay.slice(0, 2))).to;
    return { from: `${previousYear}-01-01`, to: `${previousYear}-${monthDay}` <= previousYearEnd ? `${previousYear}-${monthDay}` : previousYearEnd };
  }

  return previousEquivalentRange(from, to);
}

export function reportComparisonDescription(input: {
  period: ReportPeriodMode;
  from: string;
  to: string;
  selectedYear?: number;
  today: string;
}) {
  const { period, from, to, today } = input;
  if (["previousMonth"].includes(period) || (period === "month" && isValidDateKey(from) && to >= monthDateRange(Number(from.slice(0, 4)), Number(from.slice(5, 7))).to)) {
    return "mês completo versus mês completo anterior";
  }
  if (period === "thisMonth" || period === "month") return "mesmo intervalo transcorrido no mês anterior";
  if (period === "year") return Number(input.selectedYear ?? from.slice(0, 4)) < Number(today.slice(0, 4))
    ? "ano completo versus ano completo anterior"
    : "mesmas datas do ano anterior";
  return "intervalos consecutivos de igual duração";
}

export function formatLocalDate(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", dateStyle: "short" }).format(new Date(Date.UTC(year, month - 1, day)));
}
