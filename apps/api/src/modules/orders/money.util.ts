import { Prisma } from '@prisma/client';

// trabalhar em cêntimos evita erros de vírgula flutuante
export const toCents = (v: Prisma.Decimal | number | string) => Math.round(Number(v) * 100);
export const fromCents = (c: number) => c / 100;
