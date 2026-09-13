import { useSyncExternalStore } from "react";

export type Route =
  | { page: "home" }
  | { page: "login" }
  | { page: "focus" }
  | { page: "history"; session?: string }
  | { page: "settings" };

const subscribe = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, "");
  if (path === "/login") return { page: "login" };
  if (path === "/focus") return { page: "focus" };
  if (path.startsWith("/history")) {
    const id = path.split("/")[2];
    return id ? { page: "history", session: id } : { page: "history" };
  }
  if (path === "/settings") return { page: "settings" };
  return { page: "home" };
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  return parseRoute(hash);
}

export function navigate(route: Route) {
  window.location.hash =
    route.page === "home" ? "/" : route.page === "history" && route.session ? `/history/${route.session}` : `/${route.page}`;
}
