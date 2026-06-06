import type { RoutineSchedule } from '@open-design/contracts';

import type { Dict } from '../i18n/types';

type TranslateFn = (key: keyof Dict, vars?: Record<string, string | number>) => string;

function formatTime12h(time: string, t: TranslateFn): string {
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m) return time;
  const h = Number(m[1]);
  const mm = m[2];
  const suffix = h >= 12 ? t('routines.timePm') : t('routines.timeAm');
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${mm} ${suffix}`;
}

function gmtLabel(timezone: string, at: Date): string {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'shortOffset',
    });
    const part = dtf.formatToParts(at).find((p) => p.type === 'timeZoneName');
    return part?.value ?? 'GMT';
  } catch {
    return 'GMT';
  }
}

function tzCityLabel(timezone: string): string {
  if (timezone === 'UTC') return 'UTC';
  const last = timezone.split('/').pop() ?? timezone;
  return last.replace(/_/g, ' ');
}

function scheduleTimezoneLabel(timezone: string, nextRunAt?: number | null): string {
  if (nextRunAt) return gmtLabel(timezone, new Date(nextRunAt));
  return tzCityLabel(timezone);
}

export function describeRoutineSchedule(
  schedule: RoutineSchedule,
  t: TranslateFn,
  nextRunAt?: number | null,
): string {
  if (schedule.kind === 'hourly') {
    return t('routines.describe.hourly', { minute: String(schedule.minute).padStart(2, '0') });
  }

  const time = formatTime12h(schedule.time, t);
  const tz = scheduleTimezoneLabel(schedule.timezone, nextRunAt);

  if (schedule.kind === 'daily') {
    return t('routines.describe.daily', { time, tz });
  }
  if (schedule.kind === 'weekdays') {
    return t('routines.describe.weekdays', { time, tz });
  }
  return t('routines.describe.weekly', {
    day: t(`routines.weekday.long.${schedule.weekday}` as keyof Dict),
    time,
    tz,
  });
}
