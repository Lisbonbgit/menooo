'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthState {
  token: string | null;
  name: string | null;
  setAuth: (token: string, name: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      name: null,
      setAuth: (token, name) => set({ token, name }),
      logout: () => set({ token: null, name: null }),
    }),
    { name: 'comanda-admin-auth' },
  ),
);
