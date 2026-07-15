'use client';

import { useEffect, useState } from 'react';
import { useAuthStore } from './auth-store';

/**
 * `true` quando o `persist` do zustand terminou de restaurar o estado do
 * localStorage. Os guards de sessão TÊM de esperar por isto: se decidirem antes,
 * veem `token === null` no primeiro render e expulsam para /login mesmo com uma
 * sessão válida (a corrida de hidratação em que um refresh caía sempre no login).
 * Arranca em `false` para bater certo com o render do servidor e não dar erro de
 * hidratação; passa a `true` no efeito, quando o persist confirma que restaurou.
 */
export function useAuthHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (useAuthStore.persist.hasHydrated()) setHydrated(true);
    return useAuthStore.persist.onFinishHydration(() => setHydrated(true));
  }, []);
  return hydrated;
}
