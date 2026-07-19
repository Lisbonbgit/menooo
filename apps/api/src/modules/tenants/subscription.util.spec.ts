import { computeSubscription, isSubscriptionUsable } from './subscription.util';

const past = new Date(Date.now() - 86_400_000); // ontem
const future = new Date(Date.now() + 86_400_000); // amanhã

describe('subscription.util — acesso vitalício', () => {
  it('lifetimeAccess → estado LIFETIME mesmo sem datas', () => {
    const s = computeSubscription({ lifetimeAccess: true, trialEndsAt: null, paidUntil: null });
    expect(s.state).toBe('LIFETIME');
    expect(s.daysLeft).toBeNull();
  });

  it('lifetimeAccess → usável mesmo com teste e pagamento expirados', () => {
    const acc = { lifetimeAccess: true, trialEndsAt: past, paidUntil: past };
    expect(computeSubscription(acc).state).toBe('LIFETIME');
    expect(isSubscriptionUsable(acc)).toBe(true);
  });

  it('lifetimeAccess mas BANIDA → NÃO usável (a banição ganha)', () => {
    const acc = { lifetimeAccess: true, status: 'BANNED' as const, trialEndsAt: null, paidUntil: null };
    expect(isSubscriptionUsable(acc)).toBe(false);
  });

  it('sem lifetimeAccess → comportamento de sempre (PAID/EXPIRED)', () => {
    expect(computeSubscription({ trialEndsAt: null, paidUntil: future }).state).toBe('PAID');
    expect(computeSubscription({ trialEndsAt: past, paidUntil: past }).state).toBe('EXPIRED');
    expect(isSubscriptionUsable({ trialEndsAt: null, paidUntil: past })).toBe(false);
  });
});
