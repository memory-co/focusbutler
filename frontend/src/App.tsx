import { useEffect } from "react";
import { Shell } from "@/components/Shell";
import { setUnauthorizedHandler } from "@/lib/api";
import { navigate, useRoute } from "@/lib/router";
import { useAuth } from "@/lib/store";
import Focus from "@/pages/Focus";
import History from "@/pages/History";
import Home from "@/pages/Home";
import Login from "@/pages/Login";
import Settings from "@/pages/Settings";

export default function App() {
  const route = useRoute();
  const user = useAuth((s) => s.user);
  const load = useAuth((s) => s.load);
  const setUser = useAuth((s) => s.setUser);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    void load();
  }, [load, setUser]);

  useEffect(() => {
    if (user === null && route.page !== "login") navigate({ page: "login" });
    if (user && route.page === "login") navigate({ page: "home" });
  }, [user, route.page]);

  if (user === undefined) return <div className="flex h-screen items-center justify-center text-muted-foreground">加载中…</div>;
  if (!user) return <Login />;

  const page =
    route.page === "focus" ? <Focus /> :
    route.page === "history" ? <History session={route.session} /> :
    route.page === "settings" ? <Settings /> :
    <Home />;
  return <Shell page={route.page}>{page}</Shell>;
}
