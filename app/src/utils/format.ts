import { t } from "../i18n";

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} km`;
}

export function formatDuration(seconds: number): string {
  const totalMin = Math.round(seconds / 60);
  if (totalMin < 60) return t("format.minutes", { minutes: totalMin });
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  return minutes ? t("format.hoursMinutes", { hours, minutes }) : t("format.hours", { hours });
}
