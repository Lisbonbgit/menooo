import { Tenant } from '@prisma/client';

export type SubscriptionState = 'NONE' | 'TRIAL' | 'PAID' | 'EXPIRED';

export interface SubscriptionInfo {
  state: SubscriptionState;
  trialEndsAt: Date | null;
  paidUntil: Date | null;
  daysLeft: number | null; // dias até acabar o teste/subscrição
}

/**
 * Estado da subscrição:
 * - NONE: nunca ativada (pendente/suspensa sem datas)
 * - TRIAL: dentro dos 7 dias de teste
 * - PAID: subscrição paga em dia
 * - EXPIRED: teste terminado e sem pagamento válido → loja offline
 */
export function computeSubscription(
  tenant: Pick<Tenant, 'trialEndsAt' | 'paidUntil'>,
): SubscriptionInfo {
  const now = Date.now();
  const trial = tenant.trialEndsAt?.getTime() ?? null;
  const paid = tenant.paidUntil?.getTime() ?? null;

  const days = (t: number) => Math.max(0, Math.ceil((t - now) / 86_400_000));

  if (paid && paid > now) {
    return {
      state: 'PAID',
      trialEndsAt: tenant.trialEndsAt,
      paidUntil: tenant.paidUntil,
      daysLeft: days(paid),
    };
  }
  if (trial && trial > now) {
    return {
      state: 'TRIAL',
      trialEndsAt: tenant.trialEndsAt,
      paidUntil: tenant.paidUntil,
      daysLeft: days(trial),
    };
  }
  if (trial || paid) {
    return { state: 'EXPIRED', trialEndsAt: tenant.trialEndsAt, paidUntil: tenant.paidUntil, daysLeft: 0 };
  }
  return { state: 'NONE', trialEndsAt: null, paidUntil: null, daysLeft: null };
}

/** A loja pode estar visível/vender ao público? (ACTIVE + teste ou paga) */
export function isSubscriptionUsable(tenant: Pick<Tenant, 'trialEndsAt' | 'paidUntil'>): boolean {
  const s = computeSubscription(tenant).state;
  return s === 'TRIAL' || s === 'PAID';
}
