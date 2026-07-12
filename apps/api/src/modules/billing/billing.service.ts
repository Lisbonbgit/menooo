import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

// URLs de retorno do checkout/portal (painel do restaurante)
const DASHBOARD_URL = () => process.env.DASHBOARD_URL ?? 'http://187.124.4.163:8081';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly stripe: Stripe | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {
    const key = process.env.STRIPE_SECRET_KEY;
    this.stripe = key ? new Stripe(key) : null;
  }

  /** Email do dono (OWNER) de uma conta, para notificações. */
  private async ownerEmail(accountId: string): Promise<string | null> {
    const user = await this.prisma.user.findFirst({
      where: { accountId, role: 'OWNER' },
      select: { email: true },
    });
    return user?.email ?? null;
  }

  /** Stripe configurado? (chave + preço) — sem isto a UI mostra o modo manual. */
  isEnabled(): boolean {
    return !!this.stripe && !!process.env.STRIPE_PRICE_ID;
  }

  config() {
    return { enabled: this.isEnabled() };
  }

  private ensureEnabled(): Stripe {
    if (!this.stripe || !process.env.STRIPE_PRICE_ID) {
      throw new ServiceUnavailableException(
        'Pagamento automático indisponível de momento. Contacta a equipa Menooo.',
      );
    }
    return this.stripe;
  }

  /** Cria a sessão de checkout do Stripe (subscrição mensal da CONTA). Devolve o URL. */
  async createCheckout(accountId: string) {
    const stripe = this.ensureEnabled();
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      include: { users: { where: { role: 'OWNER' }, take: 1 } },
    });
    if (!account) throw new NotFoundException('Conta não encontrada.');

    // cliente Stripe 1:1 com a conta do dono
    let customerId = account.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        name: account.name,
        email: account.users[0]?.email ?? undefined,
        metadata: { accountId: account.id },
      });
      customerId = customer.id;
      await this.prisma.account.update({
        where: { id: account.id },
        data: { stripeCustomerId: customerId },
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: process.env.STRIPE_PRICE_ID!, quantity: 1 }],
      subscription_data: { metadata: { accountId: account.id } },
      metadata: { accountId: account.id },
      success_url: `${DASHBOARD_URL()}/settings?billing=success`,
      cancel_url: `${DASHBOARD_URL()}/settings?billing=cancelled`,
      locale: 'pt',
    });

    return { url: session.url };
  }

  /** Portal do Stripe para gerir cartão / cancelar a subscrição. */
  async createPortal(accountId: string) {
    const stripe = this.ensureEnabled();
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account) throw new NotFoundException('Conta não encontrada.');
    if (!account.stripeCustomerId) {
      throw new BadRequestException('Ainda não existe uma subscrição automática.');
    }
    const session = await stripe.billingPortal.sessions.create({
      customer: account.stripeCustomerId,
      return_url: `${DASHBOARD_URL()}/settings`,
    });
    return { url: session.url };
  }

  /** Webhook do Stripe: valida a assinatura e processa os eventos de cobrança. */
  async handleWebhook(rawBody: Buffer, signature: string) {
    if (!this.stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
      throw new ServiceUnavailableException('Webhook não configurado.');
    }

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET,
      );
    } catch {
      throw new BadRequestException('Assinatura do webhook inválida.');
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object as Stripe.Checkout.Session;
        const accountId = s.metadata?.accountId;
        if (accountId) {
          await this.prisma.account.update({
            where: { id: accountId },
            data: {
              stripeCustomerId: (s.customer as string) ?? undefined,
              stripeSubscriptionId: (s.subscription as string) ?? undefined,
            },
          });
          this.logger.log(`checkout concluído: conta ${accountId}`);
        }
        break;
      }

      case 'invoice.paid': {
        const inv = event.data.object as Stripe.Invoice;
        await this.applyInvoice(inv);
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const account = await this.prisma.account.findFirst({
          where: { stripeSubscriptionId: sub.id },
        });
        await this.prisma.account.updateMany({
          where: { stripeSubscriptionId: sub.id },
          data: { stripeSubscriptionId: null },
        });
        if (account) {
          const to = await this.ownerEmail(account.id);
          if (to) void this.mail.sendSubscriptionCancelled(to, account.name, account.paidUntil);
        }
        this.logger.log(`subscrição cancelada no Stripe: ${sub.id} (acesso mantém-se até paidUntil)`);
        break;
      }

      default:
        break; // outros eventos: confirmar receção sem ação
    }

    return { received: true };
  }

  /** Fatura paga → estende paidUntil da CONTA e regista a receita. */
  private async applyInvoice(inv: Stripe.Invoice) {
    const customerId = typeof inv.customer === 'string' ? inv.customer : inv.customer?.id;
    if (!customerId) return;

    const account = await this.prisma.account.findUnique({
      where: { stripeCustomerId: customerId },
    });
    if (!account) {
      this.logger.warn(`invoice.paid para cliente Stripe desconhecido: ${customerId}`);
      return;
    }

    // idempotência: cada fatura só conta uma vez (webhooks podem repetir-se)
    const marker = `Stripe · ${inv.id}`;
    const existing = await this.prisma.subscriptionPayment.findFirst({
      where: { accountId: account.id, note: marker },
    });
    if (existing) return;

    // fim do período coberto pela fatura (linha da subscrição)
    const periodEnd = inv.lines?.data?.reduce(
      (max, l) => Math.max(max, l.period?.end ?? 0),
      0,
    );
    const paidUntilCandidate = periodEnd
      ? new Date(periodEnd * 1000)
      : new Date(Date.now() + 31 * 86_400_000);

    const paidUntil =
      !account.paidUntil || paidUntilCandidate > account.paidUntil
        ? paidUntilCandidate
        : account.paidUntil;

    await this.prisma.$transaction([
      this.prisma.subscriptionPayment.create({
        data: {
          accountId: account.id,
          accountName: account.name,
          amount: (inv.amount_paid ?? 0) / 100,
          months: 1,
          note: marker,
        },
      }),
      this.prisma.account.update({ where: { id: account.id }, data: { paidUntil } }),
    ]);

    // email de subscrição ativa (apenas na 1ª fatura, para não repetir na renovação)
    const wasFirst = !account.paidUntil;
    if (wasFirst) {
      const to = await this.ownerEmail(account.id);
      if (to) void this.mail.sendSubscriptionActive(to, account.name, paidUntil);
    }

    this.logger.log(
      `fatura ${inv.id} aplicada: conta ${account.id} paga até ${paidUntil.toISOString()}`,
    );
  }
}
