import { useQueryClient } from "@tanstack/react-query";
import { Camera, CameraOff, Pause, Play, RotateCcw, Square } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CameraPreview } from "@/components/CameraPreview";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, ApiError, tzOffset } from "@/lib/api";
import { useFocus } from "@/lib/focus-store";
import { mmss } from "@/lib/format";
import { notify, requestNotifyPermission, vibrate } from "@/lib/notify";
import { navigate } from "@/lib/router";
import { useAuth, usePreferences } from "@/lib/store";
import type { StatsSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

/** 每 250ms 触发一次重渲染，用于倒计时插值。 */
function useTick(active: boolean) {
  const [, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setN((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [active]);
}

function StartCard() {
  const start = useFocus((s) => s.start);
  const settings = useAuth((s) => s.user?.settings);
  const privacyAccepted = usePreferences((s) => s.privacyAccepted);
  const acceptPrivacy = usePreferences((s) => s.acceptPrivacy);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setBusy(true);
    try {
      requestNotifyPermission();
      const s = await start();
      if (s.camera_status !== "recording") toast.warning("摄像头不可用，本次番茄没有视频记录");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "无法开始番茄");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-6 py-16 text-center appear">
      <div className="timer-digits text-7xl font-light">{mmss((settings?.focus_minutes ?? 25) * 60)}</div>
      <p className="max-w-sm text-sm text-muted-foreground">开始后会打开摄像头持续录制，页面上的大按钮用来记录走神。</p>
      <Button size="lg" className="h-16 px-12 text-lg" disabled={busy} onClick={() => (privacyAccepted ? void go() : setShowPrivacy(true))}>
        <Play className="mr-2 h-5 w-5" /> {busy ? "正在开始…" : "开始番茄"}
      </Button>
      <Dialog open={showPrivacy} onOpenChange={setShowPrivacy}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>关于摄像头录制</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>每个番茄进行期间，浏览器会打开摄像头持续录制，并把视频分片上传到你自己部署的这台服务器。</p>
                <p>视频只保存在这台服务器上，不会发送给任何第三方。你可以随时在历史页删除某次番茄的视频，或在设置页删除整个账号。</p>
                <p>如果拒绝摄像头授权，番茄照常进行，只是没有视频记录。</p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => { acceptPrivacy(); setShowPrivacy(false); void go(); }}>知道了，开始</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BreakCard({ seconds, onNext }: { seconds: number; onNext: () => void }) {
  const [endAt] = useState(() => Date.now() + seconds * 1000);
  useTick(true);
  const left = Math.max(0, (endAt - Date.now()) / 1000);
  useEffect(() => {
    if (left <= 0) notify("休息结束", "开始下一个番茄吧");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left <= 0]);
  return (
    <div className="flex flex-col items-center gap-6 py-16 text-center appear">
      <div className="eyebrow">休息一下</div>
      <div className="timer-digits text-7xl font-light text-primary">{mmss(left)}</div>
      <Button size="lg" variant={left <= 0 ? "default" : "outline"} onClick={onNext}>
        {left <= 0 ? "开始下一个番茄" : "跳过休息"}
      </Button>
    </div>
  );
}

export default function Focus() {
  const session = useFocus((s) => s.session);
  const stream = useFocus((s) => s.stream);
  const cameraStatus = useFocus((s) => s.cameraStatus);
  const recorder = useFocus((s) => s.recorder);
  const upload = useFocus((s) => s.upload);
  const busy = useFocus((s) => s.busy);
  const lastDistraction = useFocus((s) => s.lastDistraction);
  const pending = useFocus((s) => s.pendingDistractions);
  const { loadCurrent, pause, resume, finish, distract, undoLast, flushQueue, attachCamera, elapsed, remaining } = useFocus();
  const settings = useAuth((s) => s.user?.settings);
  const qc = useQueryClient();

  const [pressed, setPressed] = useState(false);
  const [breakSeconds, setBreakSeconds] = useState<number | null>(null);
  const active = !!session && (session.status === "running" || session.status === "paused");
  useTick(active);

  // 首次进入：拉当前会话；刷新页面后如果会话还在且原本有摄像头，重新接上
  useEffect(() => {
    void loadCurrent().then((s) => {
      if (s && s.camera_status === "recording" && !useFocus.getState().recorder) void attachCamera();
    });
    void flushQueue();
  }, [loadCurrent, attachCamera, flushQueue]);

  // 切回标签页重新校准
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && useFocus.getState().session) void loadCurrent();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loadCurrent]);

  const onDistract = useCallback(() => {
    if (!active) return;
    setPressed(true);
    vibrate(40);
    setTimeout(() => setPressed(false), 180);
    void distract();
  }, [active, distract]);

  // 空格 = 走神
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.code === "Space" && tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "BUTTON") {
        e.preventDefault();
        onDistract();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDistract]);

  const complete = useCallback(async () => {
    try {
      const done = await finish("complete");
      notify("番茄完成", `走神 ${done.distraction_count} 次，休息一下`);
      void qc.invalidateQueries();
      const today = await api<StatsSummary>("/stats/summary", { query: { days: 1, tz_offset: tzOffset() } }).catch(() => null);
      const every = settings?.long_break_every ?? 4;
      const long = !!today && today.completed_sessions > 0 && today.completed_sessions % every === 0;
      setBreakSeconds((long ? settings?.long_break_minutes ?? 15 : settings?.short_break_minutes ?? 5) * 60);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "结束失败");
    }
  }, [finish, qc, settings]);

  // 时间到自动完成
  const left = active ? remaining() : 0;
  useEffect(() => {
    if (active && session?.status === "running" && left <= 0 && !busy) void complete();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, session?.status, left <= 0, busy]);

  if (session === undefined) return <div className="p-8 text-center text-muted-foreground">加载中…</div>;

  if (!active) {
    if (breakSeconds !== null) return <BreakCard seconds={breakSeconds} onNext={() => setBreakSeconds(null)} />;
    return <StartCard />;
  }

  const progress = Math.min(1, elapsed() / session.planned_seconds);
  const paused = session.status === "paused";

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-4 sm:p-8 appear">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          {session.camera_status === "recording" && recorder ? (
            <><span className="live-dot" /> 录制中 · 已传 {upload.uploaded} 片{upload.uploading ? `，上传中 ${upload.uploading}` : ""}{upload.failed ? `，失败 ${upload.failed}` : ""}</>
          ) : (
            <><CameraOff className="h-3.5 w-3.5" /> 本次无视频记录
              <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => void attachCamera().then(() => useFocus.getState().stream && toast.success("摄像头已接上"))}>
                <Camera className="mr-1 h-3 w-3" /> {cameraStatus === "denied" ? "重新授权" : "重试摄像头"}
              </Button>
            </>
          )}
        </span>
        {pending > 0 && <span>{pending} 次走神待同步</span>}
      </div>

      <div className="text-center">
        <div className={cn("timer-digits text-7xl font-light sm:text-8xl", paused && "text-muted-foreground")}>{mmss(left)}</div>
        <div className="mx-auto mt-4 h-1.5 w-full max-w-md overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary transition-[width] duration-300" style={{ width: `${progress * 100}%` }} />
        </div>
        {paused && <div className="mt-2 text-sm text-muted-foreground">已暂停</div>}
      </div>

      <button className={cn("distract-btn", pressed && "pressed")} onClick={onDistract} disabled={busy} aria-label="我走神了">
        <div className="text-3xl font-medium tracking-[0.3em] sm:text-4xl">我走神了</div>
        <div className="mt-3 text-sm opacity-80">本次已走神 {session.distraction_count} 次 · 空格键也可以</div>
      </button>

      <div className="flex flex-wrap items-center justify-center gap-2">
        {paused ? (
          <Button variant="outline" onClick={() => void resume()}><Play className="mr-1 h-4 w-4" /> 继续</Button>
        ) : (
          <Button variant="outline" onClick={() => void pause()}><Pause className="mr-1 h-4 w-4" /> 暂停</Button>
        )}
        <Button variant="outline" disabled={!lastDistraction} onClick={() => void undoLast()}><RotateCcw className="mr-1 h-4 w-4" /> 撤销上次</Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" className="text-destructive" disabled={busy}><Square className="mr-1 h-4 w-4" /> 放弃</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>放弃这个番茄？</AlertDialogTitle>
              <AlertDialogDescription>会话会标记为已放弃，已录的视频和走神记录会保留。</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>继续专注</AlertDialogCancel>
              <AlertDialogAction onClick={() => void finish("abandon").then(() => { void qc.invalidateQueries(); navigate({ page: "home" }); }).catch(() => toast.error("操作失败"))}>放弃</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Button variant="ghost" disabled={busy} onClick={() => void complete()}>提前完成</Button>
      </div>

      <CameraPreview stream={stream} />
    </div>
  );
}
