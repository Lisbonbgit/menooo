import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, TenantStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { computeSubscription } from '../tenants/subscription.util';

const TRIAL_DAYS = 7;

// encomendas que contam para vendas/clientes (exclui recusadas/canceladas)
const COUNTED: OrderStatus[] = [
  OrderStatus.PENDING,
  OrderStatus.ACCEPTED,
  OrderStatus.PREPARING,
  OrderStatus.READY,
  OrderStatus.OUT_FOR_DELIVERY,
  OrderStatus.COMPLETED,
];

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  /** Números da plataforma para o topo do painel. */
  async stats() {
    const d30 = daysAgo(30);
    const [total, active, pending, gmvAll, gmv30, newTenants30, subsAll, subs30] =
      await Promise.all([
        this.prisma.tenant.count(),
        this.prisma.tenant.count({ where: { status: 'ACTIVE' } }),
        this.prisma.tenant.count({ where: { status: 'PENDING' } }),
        this.prisma.order.aggregate({
          where: { status: { in: COUNTED } },
          _count: { _all: true },
          _sum: { total: true },
        }),
        this.prisma.order.aggregate({
          where: { status: { in: COUNTED }, createdAt: { gte: d30 } },
          _count: { _all: true },
          _sum: { total: true },
        }),
        this.prisma.tenant.count({ where: { createdAt: { gte: d30 } } }),
        this.prisma.subscriptionPayment.aggregate({ _sum: { amount: true } }),
        this.prisma.subscriptionPayment.aggregate({
          where: { createdAt: { gte: d30 } },
          _sum: { amount: true },
        }),
      ]);

    // de onde nos conhecem (respostas do registo)
    const referrals = await this.prisma.tenant.groupBy({
      by: ['referralSource'],
      _count: { _all: true },
    });

    return {
      total,
      active,
      pending,
      orders: gmvAll._count._all,
      gmvTotal: Number(gmvAll._sum.total ?? 0),
      orders30d: gmv30._count._all,
      gmv30d: Number(gmv30._sum.total ?? 0),
      newTenants30d: newTenants30,
      // receita da PLATAFORMA (subscrições cobradas aos restaurantes)
      subsRevenueTotal: Number(subsAll._sum.amount ?? 0),
      subsRevenue30d: Number(subs30._sum.amount ?? 0),
      referralSources: referrals
        .map((r) => ({ source: r.referralSource, count: r._count._all }))
        .sort((a, b) => b.count - a.count),
    };
  }

  /** Lista de restaurantes com métricas de negócio. */
  async listTenants() {
    const [tenants, orderAgg, customerPairs] = await Promise.all([
      this.prisma.tenant.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { products: true } },
          users: { where: { role: 'OWNER' }, select: { name: true, email: true }, take: 1 },
        },
      }),
      this.prisma.order.groupBy({
        by: ['tenantId'],
        where: { status: { in: COUNTED } },
        _count: { _all: true },
        _sum: { total: true },
        _max: { createdAt: true },
      }),
      // pares (tenant, telefone) distintos => clientes únicos por restaurante
      this.prisma.order.groupBy({
        by: ['tenantId', 'customerPhone'],
        where: { status: { in: COUNTED } },
      }),
    ]);

    const agg = new Map(orderAgg.map((a) => [a.tenantId, a]));
    const customers = new Map<string, number>();
    for (const p of customerPairs) {
      customers.set(p.tenantId, (customers.get(p.tenantId) ?? 0) + 1);
    }

    return tenants.map((t) => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      status: t.status,
      plan: t.plan,
      city: t.city,
      owner: t.users[0] ?? null,
      products: t._count.products,
      orders: agg.get(t.id)?._count._all ?? 0,
      revenue: Number(agg.get(t.id)?._sum.total ?? 0),
      customers: customers.get(t.id) ?? 0,
      lastOrderAt: agg.get(t.id)?._max.createdAt ?? null,
      createdAt: t.createdAt,
      activatedAt: t.activatedAt,
      referralSource: t.referralSource,
      subscription: computeSubscription(t),
    }));
  }

  /** Ficha completa de um restaurante (para o painel de detalhe). */
  async getTenantDetail(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: {
        _count: { select: { products: true, categories: true } },
        users: { where: { role: 'OWNER' }, select: { name: true, email: true }, take: 1 },
      },
    });
    if (!tenant) throw new NotFoundException('Restaurante não encontrado.');

    // início do mês, 5 meses atrás, em UTC (as chaves YYYY-MM vêm de toISOString)
    const now = new Date();
    const since6m = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));

    const [allAgg, customerPairs, recent6m, topProducts, recentOrders, payments] = await Promise.all([
      this.prisma.order.aggregate({
        where: { tenantId: id, status: { in: COUNTED } },
        _count: { _all: true },
        _sum: { total: true },
        _max: { createdAt: true },
        _min: { createdAt: true },
      }),
      this.prisma.order.groupBy({
        by: ['customerPhone'],
        where: { tenantId: id, status: { in: COUNTED } },
      }),
      this.prisma.order.findMany({
        where: { tenantId: id, status: { in: COUNTED }, createdAt: { gte: since6m } },
        select: { createdAt: true, total: true },
      }),
      this.prisma.orderItem.groupBy({
        by: ['name'],
        where: { order: { tenantId: id, status: { in: COUNTED } } },
        _sum: { quantity: true, total: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: 5,
      }),
      this.prisma.order.findMany({
        where: { tenantId: id },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, number: true, status: true, total: true, createdAt: true },
      }),
      this.prisma.subscriptionPayment.findMany({
        where: { tenantId: id },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    // série mensal (6 meses) construída em memória
    const months: { month: string; orders: number; revenue: number }[] = [];
    for (let i = 0; i < 6; i++) {
      const d = new Date(Date.UTC(since6m.getUTCFullYear(), since6m.getUTCMonth() + i, 1));
      months.push({ month: d.toISOString().slice(0, 7), orders: 0, revenue: 0 });
    }
    const byMonth = new Map(months.map((m) => [m.month, m]));
    for (const o of recent6m) {
      const key = o.createdAt.toISOString().slice(0, 7);
      const m = byMonth.get(key);
      if (m) {
        m.orders += 1;
        m.revenue += Number(o.total);
      }
    }

    const orders = allAgg._count._all;
    const revenue = Number(allAgg._sum.total ?? 0);

    return {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      status: tenant.status,
      plan: tenant.plan,
      city: tenant.city,
      phone: tenant.phone,
      email: tenant.email,
      owner: tenant.users[0] ?? null,
      products: tenant._count.products,
      categories: tenant._count.categories,
      createdAt: tenant.createdAt,
      activatedAt: tenant.activatedAt,
      referralSource: tenant.referralSource,
      isOpen: tenant.isOpen,
      subscription: computeSubscription(tenant),
      payments: payments.map((p) => ({
        id: p.id,
        amount: Number(p.amount),
        months: p.months,
        note: p.note,
        createdAt: p.createdAt,
      })),
      totalPaid: payments.reduce((s, p) => s + Number(p.amount), 0),
      metrics: {
        orders,
        revenue,
        customers: customerPairs.length,
        avgTicket: orders > 0 ? revenue / orders : 0,
        firstOrderAt: allAgg._min.createdAt,
        lastOrderAt: allAgg._max.createdAt,
      },
      monthly: months,
      topProducts: topProducts.map((p) => ({
        name: p.name,
        quantity: p._sum.quantity ?? 0,
        revenue: Number(p._sum.total ?? 0),
      })),
      recentOrders: recentOrders.map((o) => ({
        ...o,
        total: Number(o.total),
      })),
    };
  }

  async setTenantStatus(id: string, status: TenantStatus) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: { users: { where: { role: 'OWNER' }, select: { email: true }, take: 1 } },
    });
    if (!tenant) throw new NotFoundException('Restaurante não encontrado.');

    const firstActivation = status === TenantStatus.ACTIVE && !tenant.activatedAt;
    const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 86_400_000);
    const updated = await this.prisma.tenant.update({
      where: { id },
      data: {
        status,
        // 1ª ativação: regista a data e arranca os 7 dias de teste
        ...(firstActivation ? { activatedAt: new Date(), trialEndsAt } : {}),
      },
    });

    // email "a tua loja está no ar" na primeira aprovação
    if (firstActivation) {
      const to = tenant.users[0]?.email ?? tenant.email;
      if (to) void this.mail.sendActivated(to, tenant.name, tenant.slug, trialEndsAt);
    }
    return updated;
  }

  /**
   * Regista um pagamento de subscrição (recebido por fora: transferência,
   * MB WAY…) e estende o prazo. Base: o que acabar mais tarde entre hoje,
   * o fim do teste e a subscrição atual — pagar cedo nunca desconta tempo.
   */
  async recordPayment(id: string, dto: { amount: number; months: number; note?: string }) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: { users: { where: { role: 'OWNER' }, select: { email: true }, take: 1 } },
    });
    if (!tenant) throw new NotFoundException('Restaurante não encontrado.');
    if (dto.months < 1 || dto.months > 24) {
      throw new BadRequestException('Meses: entre 1 e 24.');
    }

    const base = new Date(
      Math.max(
        Date.now(),
        tenant.paidUntil?.getTime() ?? 0,
        tenant.trialEndsAt?.getTime() ?? 0,
      ),
    );
    const paidUntil = new Date(base);
    paidUntil.setMonth(paidUntil.getMonth() + dto.months);

    const [payment, updated] = await this.prisma.$transaction([
      this.prisma.subscriptionPayment.create({
        data: { tenantId: id, amount: dto.amount, months: dto.months, note: dto.note },
      }),
      this.prisma.tenant.update({ where: { id }, data: { paidUntil } }),
    ]);

    const to = tenant.users[0]?.email ?? tenant.email;
    if (to) void this.mail.sendSubscriptionActive(to, tenant.name, paidUntil);

    return {
      payment: { ...payment, amount: Number(payment.amount) },
      paidUntil: updated.paidUntil,
      subscription: computeSubscription(updated),
    };
  }
}
