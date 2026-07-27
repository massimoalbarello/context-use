/**
 * Diary days are materialised on write, never in advance.
 *
 * Writing anything into about/diary/<YYYY>/<MM>/<DD>/ creates that day's
 * directories and its `log` entry point. A day when nothing happened has no
 * folder at all, so an empty log never becomes a page whose only content is
 * that it exists.
 *
 * Directory titles are a pure function of the date, which is the sort of rule
 * that belongs in code rather than in a convention every writer has to
 * remember.
 */

export const DIARY_ROOT = "about/diary";

const WEEKDAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
] as const;
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

export type DiaryDay = {
  year: string;
  month: string;
  day: string;
  path: string;
  logPath: string;
};

export type MaterializedDirectory = {
  path: string;
  title: string;
  summary: string;
};

const DAY_SEGMENT = /^\d{2}$/;
const YEAR_SEGMENT = /^\d{4}$/;

/**
 * Returns the diary day a page path sits inside, or null when the path is not
 * a page within a day folder. The day folder itself and the month above it are
 * not days.
 */
export function diaryDayForPage(pagePath: string): DiaryDay | null {
  const segments = pagePath.split("/");
  if (segments.length < 6) return null;
  if (segments[0] !== "about" || segments[1] !== "diary") return null;
  const [year, month, day] = [segments[2]!, segments[3]!, segments[4]!];
  if (!YEAR_SEGMENT.test(year) || !DAY_SEGMENT.test(month) || !DAY_SEGMENT.test(day)) return null;
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  if (monthNumber < 1 || monthNumber > 12 || dayNumber < 1 || dayNumber > 31) return null;
  const path = `${DIARY_ROOT}/${year}/${month}/${day}`;
  return { year, month, day, path, logPath: `${path}/log` };
}

export function diaryDayTitle(day: DiaryDay): string {
  const date = new Date(Date.UTC(Number(day.year), Number(day.month) - 1, Number(day.day)));
  const weekday = WEEKDAYS[date.getUTCDay()]!;
  const month = MONTHS[Number(day.month) - 1]!;
  return `${weekday}, ${Number(day.day)} ${month} ${day.year}`;
}

export function diaryDirectories(day: DiaryDay): MaterializedDirectory[] {
  const month = MONTHS[Number(day.month) - 1]!;
  const dayTitle = diaryDayTitle(day);
  return [
    {
      path: `${DIARY_ROOT}/${day.year}`,
      title: day.year,
      summary: `Diary entries for ${day.year}, grouped by month.`,
    },
    {
      path: `${DIARY_ROOT}/${day.year}/${day.month}`,
      title: `${month} ${day.year}`,
      summary: `Diary entries for ${month} ${day.year}, one folder per day.`,
    },
    {
      path: day.path,
      title: dayTitle,
      summary: `Diary for ${dayTitle}.`,
    },
  ];
}

/**
 * The stub is never empty in practice: it is only created because something
 * else was written into the day, and that page's link is what it carries.
 */
export function diaryLogStub(day: DiaryDay): {
  path: string;
  title: string;
  summary: string;
  body_markdown: string;
} {
  const dayTitle = diaryDayTitle(day);
  return {
    path: day.logPath,
    title: `Log — ${dayTitle}`,
    summary: `Diary log for ${dayTitle}, awaiting the day's entry.`,
    body_markdown: `# Log — ${dayTitle}\n\n## Companion pages\n`,
  };
}
