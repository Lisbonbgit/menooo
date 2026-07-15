'use client';

import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from './auth-store';

const baseURL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001') + '/api';

export const api = axios.create({ baseURL });

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// --- renovação automática da sessão no 401 (single-flight) ---
// Sem isto, o access token de 15 min expirava e o pedido seguinte caía logo no
// login. Agora, ao primeiro 401 tentamos renovar com o refresh token e repetimos
// o pedido; só terminamos a sessão se a renovação falhar.
let refreshPromise: Promise<string | null> | null = null;

async function refreshSession(): Promise<string | null> {
  const refreshToken = useAuthStore.getState().refreshToken;
  if (!refreshToken) return null;
  try {
    // instância crua (sem interceptors) para não entrar em recursão
    const { data } = await axios.post(`${baseURL}/auth/refresh`, { refreshToken });
    useAuthStore.getState().setSession(data.accessToken, data.refreshToken);
    return data.accessToken as string;
  } catch {
    return null;
  }
}

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as
      | (InternalAxiosRequestConfig & { _retry?: boolean })
      | undefined;
    const status = error.response?.status;
    const isAuthCall = (original?.url ?? '').includes('/auth/');

    if (status === 401 && original && !original._retry && !isAuthCall) {
      original._retry = true;
      refreshPromise = refreshPromise ?? refreshSession();
      const newToken = await refreshPromise;
      refreshPromise = null;
      if (newToken) {
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      }
    }

    if (status === 401 && typeof window !== 'undefined') {
      useAuthStore.getState().logout();
      if (window.location.pathname !== '/login') window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);
