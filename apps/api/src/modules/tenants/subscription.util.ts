import { Account } from '@prisma/client';

export type SubscriptionState = 'NONE' | 'TRIAL' | 'PAID' | 'EXPIRED' | 'LIFETIME';

/** Objeto com a subscrição (a conta do dono, ou algo com os mesmos campos).
 *  `status` é opcional para quem só tem as datas; quando presente, uma conta
 *  banida nunca é utilizável. */
type WithSubscription = Pick<Account, 'trialEndsAt' | 'paidUntil'> &
  Partial<Pick<Account, 'status' | 'lifetimeAccess'>>;

export interface SubscriptionInfo {
  state: SubscriptionState;
  trialEndsAt: Date | null;
  paidUntil: Date | null;
  daysLeft: number | null; // dias até acabar o teste/subscrição
}

/**
 * Estado da subscrição:
 * - LIFETIME: acesso permanente dado pelo super-admin (a banição continua a ganhar)
 * - NONE: nunca ativada (pendente/suspensa sem datas)
 * - TRIAL: dentro dos 7 dias de teste
 * - PAID: subscrição paga em dia
 * - EXPIRED: teste terminado e sem pagamento válido → loja offline
 */
export function computeSubscription(account: WithSubscription): SubscriptionInfo {
  const now = Date.now();
  if (account.lifetimeAccess) {
    return {
      state: 'LIFETIME',
      trialEndsAt: account.trialEndsAt ?? null,
      paidUntil: account.paidUntil ?? null,
      daysLeft: null,
    };
  }
  const trial = account.trialEndsAt?.getTime() ?? null;
  const paid = account.paidUntil?.getTime() ?? null;

  const days = (t: number) => Math.max(0, Math.ceil((t - now) / 86_400_000));

  if (paid && paid > now) {
    return {
      state: 'PAID',
      trialEndsAt: account.trialEndsAt,
      paidUntil: account.paidUntil,
      daysLeft: days(paid),
    };
  }
  if (trial && trial > now) {
    return {
      state: 'TRIAL',
      trialEndsAt: account.trialEndsAt,
      paidUntil: account.paidUntil,
      daysLeft: days(trial),
    };
  }
  if (trial || paid) {
    return { state: 'EXPIRED', trialEndsAt: account.trialEndsAt, paidUntil: account.paidUntil, daysLeft: 0 };
  }
  return { state: 'NONE', trialEndsAt: null, paidUntil: null, daysLeft: null };
}

/** A conta pode ter lojas visíveis/a vender? (não banida + teste ativo, paga, ou vitalícia) */
export function isSubscriptionUsable(account: WithSubscription): boolean {
  if (account.status === 'BANNED') return false;
  const s = computeSubscription(account).state;
  return s === 'TRIAL' || s === 'PAID' || s === 'LIFETIME';
}
