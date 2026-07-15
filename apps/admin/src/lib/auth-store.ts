'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthState {
  token: string | null;
  refreshToken: string | null;
  name: string | null;
  setAuth: (token: string, refreshToken: string, name: string) => void;
  setSession: (token: string, refreshToken: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      refreshToken: null,
      name: null,
      setAuth: (token, refreshToken, name) => set({ token, refreshToken, name }),
      setSession: (token, refreshToken) => set({ token, refreshToken }),
      logout: () => set({ token: null, refreshToken: null, name: null }),
    }),
    { name: 'menoo-admin-auth' },
  ),
);
