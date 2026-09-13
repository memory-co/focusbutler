import { Clock, History, LogOut, Settings as SettingsIcon, Timer } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { navigate, type Route } from "@/lib/router";
import { useAuth } from "@/lib/store";
import { cn } from "@/lib/utils";

const NAV: { page: Route["page"]; label: string; icon: typeof Clock }[] = [
  { page: "home", label: "今日", icon: Clock },
  { page: "focus", label: "专注", icon: Timer },
  { page: "history", label: "历史", icon: History },
  { page: "settings", label: "设置", icon: SettingsIcon },
];

export function Shell({ page, children }: { page: Route["page"]; children: ReactNode }) {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-14 items-center justify-between border-b px-4 sm:px-8">
        <button className="flex items-center gap-2 text-sm font-medium" onClick={() => navigate({ page: "home" })}>
          <span aria-hidden>🍅</span> FocusButler
        </button>
        <nav className="hidden items-center gap-1 sm:flex">
          {NAV.map(({ page: p, label, icon: Icon }) => (
            <Button key={p} variant={page === p ? "secondary" : "ghost"} size="sm" onClick={() => navigate({ page: p } as Route)}>
              <Icon className="mr-1 h-4 w-4" /> {label}
            </Button>
          ))}
        </nav>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="hidden sm:inline">{user?.username}</span>
          <Button variant="ghost" size="icon" title="退出登录" onClick={() => void logout()}>
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>
      <main className="flex-1 pb-20 sm:pb-0">{children}</main>
      {/* 移动端底部导航 */}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t bg-background sm:hidden">
        {NAV.map(({ page: p, label, icon: Icon }) => (
          <button
            key={p}
            className={cn("flex flex-col items-center gap-1 py-2 text-[11px]", page === p ? "text-primary" : "text-muted-foreground")}
            onClick={() => navigate({ page: p } as Route)}
          >
            <Icon className="h-5 w-5" />
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
