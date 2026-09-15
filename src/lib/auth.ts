import { create } from "zustand";

export interface AuthUser {
  id: number;
  username: string;
  fullName: string;
  role: string;
  isActive: boolean;
  mustChangePwd: boolean;
  initials: string;
}

interface AuthState {
  user: AuthUser | null;
  setUser: (u: AuthUser | null) => void;
  logout: () => Promise<void>;
}

// NO persist — user must log in every time the app starts (security requirement).
// The user state is in-memory only, cleared on app restart.
export const useAuth = create<AuthState>()((set) => ({
  user: null,
  setUser: (u) => set({ user: u }),
  logout: async () => {
    try {
      await window.mms.auth.logout();
    } catch (e) {
      console.error("Logout failed:", e);
    }
    set({ user: null });
  },
}));
