'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/auth-store';

export default function HomePage() {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);

  useEffect(() => {
    router.replace(token ? '/tenants' : '/login');
  }, [token, router]);

  return <main className="flex min-h-screen items-center justify-center text-gray-400">…</main>;
}
