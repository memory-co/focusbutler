export const pad = (n: number) => String(n).padStart(2, "0");

export function mmss(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

export function minutes(seconds: number) {
  return Math.round(seconds / 60);
}

/** 后端存的是 UTC naive 时间，字符串没有 Z 后缀，这里补上再解析。 */
export function parseUtc(iso: string) {
  return new Date(/[zZ]|[+-]\d\d:\d\d$/.test(iso) ? iso : iso + "Z");
}

export function fmtDateTime(iso: string) {
  const d = parseUtc(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtTime(iso: string) {
  const d = parseUtc(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
