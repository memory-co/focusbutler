import { usePreferences } from "./store";

export function requestNotifyPermission() {
  if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission();
}

export function notify(title: string, body: string) {
  if ("Notification" in window && Notification.permission === "granted") {
    try {
      new Notification(title, { body });
    } catch {
      /* ignore */
    }
  }
  if (usePreferences.getState().sound) beep();
}

/** 用 WebAudio 合成一段提示音，省一个音频文件。 */
export function beep() {
  try {
    const ctx = new AudioContext();
    [0, 0.18, 0.36].forEach((t) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.15);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + t);
      osc.stop(ctx.currentTime + t + 0.16);
    });
    setTimeout(() => void ctx.close(), 800);
  } catch {
    /* ignore */
  }
}

export function vibrate(ms: number) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* ignore */
  }
}
