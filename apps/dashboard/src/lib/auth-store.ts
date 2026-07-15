'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  tenantId: string | null;
}

interface AuthState {
  token: string | null;
  refreshToken: string | null;
  user: AuthUser | null;
  kitchenDevice: boolean;
  setAuth: (token: string, refreshToken: string, user: AuthUser) => void;
  setSession: (token: string, refreshToken: string) => void;
  setKitchenDevice: (v: boolean) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      refreshToken: null,
      user: null,
      kitchenDevice: false,
      setAuth: (token, refreshToken, user) => set({ token, refreshToken, user }),
      // renova o par de tokens (ao mudar de unidade ativa ou ao renovar a sessão)
      setSession: (token, refreshToken) => set({ token, refreshToken }),
      setKitchenDevice: (kitchenDevice) => set({ kitchenDevice }),
      // logout NÃO limpa kitchenDevice: um tablet de cozinha desemparelhado
      // volta ao ecrã /pair, não ao /login de email+password
      logout: () => set({ token: null, refreshToken: null, user: null }),
    }),
    { name: 'menoo-auth' },
  ),
);
