import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { api, ApiError } from "@/lib/api";
import { useAuth, usePreferences } from "@/lib/store";
import type { UserSettings } from "@/lib/types";

const FIELDS: { key: keyof UserSettings; label: string; hint?: string; min: number; max: number }[] = [
  { key: "focus_minutes", label: "专注时长（分钟）", min: 1, max: 180 },
  { key: "short_break_minutes", label: "短休息（分钟）", min: 1, max: 60 },
  { key: "long_break_minutes", label: "长休息（分钟）", min: 1, max: 120 },
  { key: "long_break_every", label: "每几个番茄一次长休息", min: 1, max: 12 },
  { key: "video_chunk_seconds", label: "视频分片长度（秒）", hint: "越短越不容易丢数据，请求也越多", min: 3, max: 60 },
  { key: "video_width", label: "视频宽度（像素）", min: 160, max: 1920 },
  { key: "video_height", label: "视频高度（像素）", min: 120, max: 1080 },
];

export default function Settings() {
  const user = useAuth((s) => s.user)!;
  const patchSettings = useAuth((s) => s.patchSettings);
  const setUser = useAuth((s) => s.setUser);
  const sound = usePreferences((s) => s.sound);
  const toggleSound = usePreferences((s) => s.toggleSound);
  const [form, setForm] = useState<UserSettings>(user.settings);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState("");

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await patchSettings(form);
      toast.success("已保存");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const deleteAccount = async () => {
    try {
      await api("/auth/me", { method: "DELETE" });
      setUser(null);
    } catch {
      toast.error("删除失败");
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-6 p-4 sm:p-8 appear">
      <Card>
        <CardHeader>
          <CardTitle>番茄设置</CardTitle>
          <CardDescription>保存到账号，换设备也生效。</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={save} className="space-y-4">
            {FIELDS.map((f) => (
              <div key={f.key} className="grid gap-1.5 sm:grid-cols-[1fr_140px] sm:items-center">
                <Label htmlFor={f.key}>
                  {f.label}
                  {f.hint && <span className="block text-xs font-normal text-muted-foreground">{f.hint}</span>}
                </Label>
                <Input id={f.key} type="number" min={f.min} max={f.max} value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: Number(e.target.value) })} required />
              </div>
            ))}
            <div className="flex justify-end pt-2"><Button type="submit" disabled={busy}>保存</Button></div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>本机偏好</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between text-sm">
          <span>番茄结束时播放提示音</span>
          <Button variant="outline" size="sm" onClick={toggleSound}>{sound ? "已开启" : "已关闭"}</Button>
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-destructive">删除账号</CardTitle>
          <CardDescription>所有番茄记录、走神事件和视频文件都会被永久删除。</CardDescription>
        </CardHeader>
        <CardContent>
          <Separator className="mb-4" />
          <AlertDialog onOpenChange={() => setConfirm("")}>
            <AlertDialogTrigger asChild><Button variant="destructive">删除我的账号</Button></AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>确认删除账号</AlertDialogTitle>
                <AlertDialogDescription>请输入用户名 <b>{user.username}</b> 确认。此操作不可恢复。</AlertDialogDescription>
              </AlertDialogHeader>
              <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={user.username} />
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction disabled={confirm !== user.username} onClick={() => void deleteAccount()}>永久删除</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  );
}
