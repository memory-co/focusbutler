import { create } from "zustand";
import { persist } from "zustand/middleware";
import { api } from "./api";
import type { User, UserSettings } from "./types";

/** 登录态。user 为 null 表示未登录，undefined 表示还没查过。 */
interface AuthState {
  user: User | null | undefined;
  load: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  patchSettings: (patch: Partial<UserSettings>) => Promise<void>;
  setUser: (user: User | null) => void;
}

export const useAuth = create<AuthState>()((set) => ({
  user: undefined,
  setUser: (user) => set({ user }),
  load: async () => {
    try {
      set({ user: await api<User>("/auth/me") });
    } catch {
      set({ user: null });
    }
  },
  login: async (username, password) => set({ user: await api<User>("/auth/login", { method: "POST", body: { username, password } }) }),
  register: async (username, password) =>
    set({ user: await api<User>("/auth/register", { method: "POST", body: { username, password } }) }),
  logout: async () => {
    await api("/auth/logout", { method: "POST" });
    set({ user: null });
  },
  patchSettings: async (patch) => set({ user: await api<User>("/auth/me/settings", { method: "PATCH", body: patch }) }),
}));

/** 本地偏好，不进后端。 */
interface Preferences {
  privacyAccepted: boolean;
  previewCollapsed: boolean;
  sound: boolean;
  acceptPrivacy: () => void;
  togglePreview: () => void;
  toggleSound: () => void;
}

export const usePreferences = create<Preferences>()(
  persist(
    (set) => ({
      privacyAccepted: false,
      previewCollapsed: false,
      sound: true,
      acceptPrivacy: () => set({ privacyAccepted: true }),
      togglePreview: () => set((s) => ({ previewCollapsed: !s.previewCollapsed })),
      toggleSound: () => set((s) => ({ sound: !s.sound })),
    }),
    { name: "focusbutler.preferences.v1" },
  ),
);
