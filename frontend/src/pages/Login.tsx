import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/store";

function Form({ mode }: { mode: "login" | "register" }) {
  const login = useAuth((s) => s.login);
  const register = useAuth((s) => s.register);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await (mode === "login" ? login(username, password) : register(username, password));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor={`${mode}-u`}>用户名</Label>
        <Input id={`${mode}-u`} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" placeholder="3-32 位字母、数字或下划线" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${mode}-p`}>密码</Label>
        <Input id={`${mode}-p`} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder="至少 8 位" required minLength={8} />
      </div>
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? "请稍候…" : mode === "login" ? "登录" : "注册并登录"}
      </Button>
    </form>
  );
}

export default function Login() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm appear">
        <CardHeader className="text-center">
          <div className="text-4xl" aria-hidden>🍅</div>
          <CardTitle>FocusButler</CardTitle>
          <CardDescription>带摄像头记录和走神按钮的番茄钟</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="login">
            <TabsList className="mb-4 grid w-full grid-cols-2">
              <TabsTrigger value="login">登录</TabsTrigger>
              <TabsTrigger value="register">注册</TabsTrigger>
            </TabsList>
            <TabsContent value="login"><Form mode="login" /></TabsContent>
            <TabsContent value="register"><Form mode="register" /></TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
