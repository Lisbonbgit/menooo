import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OrderStatus, OrderType, PaymentMethod, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePublicOrderDto } from './dto/create-order.dto';
import { OrdersGateway } from './orders.gateway';
import { computeOpenNow } from '../tenants/open-now.util';
import { isSubscriptionUsable } from '../tenants/subscription.util';
import { PromotionsService } from '../promotions/promotions.service';
import { MailService, OrderMailInfo } from '../mail/mail.service';
import { toCents, fromCents } from './money.util';
import { buildOrderItems } from './order-items.util';

// métodos de pagamento permitidos na Fase 2 (sem pagamento online)
const OFFLINE_METHODS: PaymentMethod[] = [PaymentMethod.CASH, PaymentMethod.CARD_ON_DELIVERY];

// transições de estado permitidas (máquina de estados da encomenda)
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: [OrderStatus.ACCEPTED, OrderStatus.REJECTED],
  ACCEPTED: [OrderStatus.PREPARING, OrderStatus.CANCELLED],
  PREPARING: [OrderStatus.READY, OrderStatus.CANCELLED],
  READY: [OrderStatus.OUT_FOR_DELIVERY, OrderStatus.COMPLETED],
  OUT_FOR_DELIVERY: [OrderStatus.COMPLETED],
  COMPLETED: [],
  REJECTED: [],
  CANCELLED: [],
};

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: OrdersGateway,
    private readonly promotions: PromotionsService,
    private readonly mail: MailService,
  ) {}

  // ==========================================================================
  // Criação pública (storefront)
  // ==========================================================================

  async createPublicOrder(slug: string, dto: CreatePublicOrderDto) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      include: { openingHours: true, deliveryZones: true, account: true },
    });
    if (!tenant || tenant.status !== 'ACTIVE' || !isSubscriptionUsable(tenant.account)) {
      throw new NotFoundException('Loja não encontrada.');
    }
    if (!computeOpenNow(tenant, tenant.openingHours)) {
      throw new BadRequestException('A loja está fechada de momento.');
    }

    // resolve a taxa de entrega e o mínimo aplicável (por zona, se houver)
    const delivery = this.promotions.resolveDelivery(
      tenant,
      tenant.deliveryZones,
      dto.type,
      dto.deliveryZipCode,
    );

    // tipo de serviço permitido?
    if (dto.type === OrderType.DELIVERY && !tenant.acceptsDelivery) {
      throw new BadRequestException('Esta loja não faz entregas.');
    }
    if (dto.type === OrderType.PICKUP && !tenant.acceptsPickup) {
      throw new BadRequestException('Esta loja não faz take-away.');
    }
    if (dto.type === OrderType.DELIVERY && !dto.deliveryAddress) {
      throw new BadRequestException('Indica a morada de entrega.');
    }
    if (!OFFLINE_METHODS.includes(dto.paymentMethod)) {
      throw new BadRequestException('Método de pagamento indisponível.');
    }

    // carregar produtos pedidos (do tenant, ativos, do menu Delivery — isola os produtos
    // de Sala/dine-in, que não fazem parte do checkout de entrega/levantamento) com as opções
    const productIds = [...new Set(dto.items.map((i) => i.productId))];
    const products = await this.prisma.product.findMany({
      where: {
        id: { in: productIds },
        tenantId: tenant.id,
        active: true,
        category: { menu: { type: 'DELIVERY' } },
      },
      include: { modifierGroupLinks: { include: { group: { include: { modifiers: true } } } } },
    });

    // construir as linhas da encomenda com preços do servidor
    const { itemsData, subtotalCents, vatLines } = buildOrderItems(products, dto.items);

    // valor mínimo de encomenda (da zona, se aplicável)
    if (delivery.minOrderCents > 0 && subtotalCents < delivery.minOrderCents) {
      throw new BadRequestException(
        `Encomenda mínima de ${fromCents(delivery.minOrderCents).toFixed(2)} €.`,
      );
    }

    // cupão de desconto (opcional) — validado e calculado no servidor
    let discountCents = 0;
    let couponId: string | undefined;
    let couponCode: string | undefined;
    if (dto.couponCode) {
      const ev = await this.promotions.evaluateCoupon(tenant.id, dto.couponCode, subtotalCents);
      if (!ev.valid) throw new BadRequestException(ev.reason ?? 'Cupão inválido.');
      discountCents = ev.discountCents;
      couponId = ev.couponId;
      couponCode = ev.code;
    }

    const deliveryCents = delivery.feeCents;
    const totalCents = subtotalCents - discountCents + deliveryCents;

    // IVA incluído nos preços. O desconto reparte-se proporcionalmente pelas linhas.
    const netSubtotalCents = subtotalCents - discountCents;
    let vatCents = 0;
    for (const l of vatLines) {
      const lineNet =
        subtotalCents > 0 ? Math.round((l.lineCents * netSubtotalCents) / subtotalCents) : 0;
      vatCents += Math.round((lineNet * l.vatRate) / (100 + l.vatRate));
    }
    vatCents += Math.round((deliveryCents * 23) / 123); // IVA da entrega (23%)

    // dinheiro: "troco para" tem de cobrir o total (senão o restaurante não sabe o troco)
    const isCash = dto.paymentMethod === PaymentMethod.CASH;
    if (isCash && dto.changeFor != null && toCents(dto.changeFor) < totalCents) {
      throw new BadRequestException(
        `O valor para troco (${dto.changeFor.toFixed(2)} €) tem de ser igual ou superior ao total (${fromCents(totalCents).toFixed(2)} €).`,
      );
    }

    // criar a encomenda com número sequencial por tenant (transação)
    const order = await this.prisma.$transaction(async (tx) => {
      const last = await tx.order.findFirst({
        where: { tenantId: tenant.id },
        orderBy: { number: 'desc' },
        select: { number: true },
      });
      const number = (last?.number ?? 0) + 1;

      // consumir uma utilização do cupão (atomicamente com a encomenda)
      if (couponId) {
        await tx.coupon.update({
          where: { id: couponId },
          data: { usedCount: { increment: 1 } },
        });
      }

      return tx.order.create({
        data: {
          tenantId: tenant.id,
          number,
          type: dto.type,
          customerName: dto.customerName,
          customerPhone: dto.customerPhone,
          customerEmail: dto.customerEmail,
          marketingConsent: dto.marketingConsent ?? false,
          deliveryAddress: dto.deliveryAddress,
          deliveryCity: dto.deliveryCity,
          deliveryZipCode: dto.deliveryZipCode,
          notes: dto.notes,
          scheduledFor: dto.scheduledFor ? new Date(dto.scheduledFor) : null,
          paymentMethod: dto.paymentMethod,
          changeFor: isCash && dto.changeFor != null ? dto.changeFor : null,
          subtotal: fromCents(subtotalCents),
          deliveryFee: fromCents(deliveryCents),
          discount: fromCents(discountCents),
          couponCode,
          total: fromCents(totalCents),
          vatTotal: fromCents(vatCents),
          items: { create: itemsData },
        },
        include: { items: { include: { modifiers: true } } },
      });
    });

    // notificar o painel do restaurante em tempo real
    this.gateway.emitNewOrder(tenant.id, order);
    return order;
  }

  // ==========================================================================
  // Mudança de estado (dashboard)
  // ==========================================================================

  async updateStatus(tenantId: string, id: string, status: OrderStatus) {
    const order = await this.prisma.order.findFirst({ where: { id, tenantId } });
    if (!order) throw new NotFoundException('Encomenda não encontrada.');

    if (order.status === status) return this.getForTenant(tenantId, id);

    if (!TRANSITIONS[order.status].includes(status)) {
      throw new BadRequestException(
        `Transição inválida: ${order.status} → ${status}.`,
      );
    }

    await this.prisma.order.update({ where: { id }, data: { status } });
    const updated = await this.getForTenant(tenantId, id);
    this.gateway.emitOrderUpdated(tenantId, updated);
    void this.afterStatusChange(updated, status).catch((e) =>
      this.logger.error(`email de encomenda (${status}) falhou: ${e?.message ?? e}`),
    );
    return updated;
  }

  /**
   * Pós-transição: avisa o cliente por email. Fire-and-forget — o chamador faz `.catch`, aqui
   * nunca lançamos por causa de um email. Só 4 transições enviam (ACCEPTED/READY/COMPLETED e
   * REJECTED|CANCELLED); PREPARING e OUT_FOR_DELIVERY são silenciosas (o «em preparação» é dito
   * no email de aceite). Sem customerEmail (encomendas manuais) → não envia.
   */
  private async afterStatusChange(
    order: Prisma.OrderGetPayload<{ include: { items: { include: { modifiers: true } } } }>,
    status: OrderStatus,
  ) {
    if (!order.customerEmail) return;
    const dispara =
      status === OrderStatus.ACCEPTED ||
      status === OrderStatus.READY ||
      status === OrderStatus.COMPLETED ||
      status === OrderStatus.REJECTED ||
      status === OrderStatus.CANCELLED;
    if (!dispara) return;

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: order.tenantId },
      select: { name: true, slug: true, phone: true, address: true, city: true },
    });
    if (!tenant) return;

    const info: OrderMailInfo = {
      number: order.number,
      type: order.type,
      restaurantName: tenant.name,
      slug: tenant.slug,
      storePhone: tenant.phone,
      storeAddress: [tenant.address, tenant.city].filter(Boolean).join(', ') || null,
      items: order.items.map((i) => ({
        name: i.name,
        quantity: i.quantity,
        lineTotal: Number(i.total),
      })),
      total: Number(order.total),
      trackUrl: `${process.env.STORE_URL ?? 'https://menooo.com'}/${tenant.slug}/pedido/${order.trackToken}`,
    };

    switch (status) {
      case OrderStatus.ACCEPTED:
        return this.mail.sendOrderAccepted(order.customerEmail, order.customerName, info);
      case OrderStatus.READY:
        return this.mail.sendOrderReady(order.customerEmail, order.customerName, info);
      case OrderStatus.COMPLETED:
        return this.mail.sendOrderCompleted(order.customerEmail, order.customerName, info);
      case OrderStatus.REJECTED:
      case OrderStatus.CANCELLED:
        return this.mail.sendOrderCancelled(order.customerEmail, order.customerName, info);
    }
  }

  // ==========================================================================
  // Resumo para a visão geral do painel
  // ==========================================================================

  async summaryForTenant(tenantId: string) {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const sevenDaysAgo = new Date(startOfToday);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

    const ACTIVE: OrderStatus[] = [
      OrderStatus.PENDING,
      OrderStatus.ACCEPTED,
      OrderStatus.PREPARING,
      OrderStatus.READY,
      OrderStatus.OUT_FOR_DELIVERY,
    ];

    const [recent, activeCount] = await Promise.all([
      this.prisma.order.findMany({
        where: { tenantId, createdAt: { gte: sevenDaysAgo } },
        select: { createdAt: true, total: true, status: true },
      }),
      this.prisma.order.count({ where: { tenantId, status: { in: ACTIVE } } }),
    ]);

    // encomendas recusadas/canceladas não contam para receita
    const counted = recent.filter(
      (o) => o.status !== OrderStatus.REJECTED && o.status !== OrderStatus.CANCELLED,
    );

    const series: { date: string; count: number; revenueCents: number }[] = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(sevenDaysAgo);
      day.setDate(day.getDate() + i);
      const next = new Date(day);
      next.setDate(next.getDate() + 1);
      const ofDay = counted.filter((o) => o.createdAt >= day && o.createdAt < next);
      series.push({
        date: day.toISOString().slice(0, 10),
        count: ofDay.length,
        revenueCents: ofDay.reduce((s, o) => s + toCents(o.total), 0),
      });
    }

    const today = series[series.length - 1];
    const count7 = series.reduce((s, d) => s + d.count, 0);
    const revenue7 = series.reduce((s, d) => s + d.revenueCents, 0);

    return {
      todayCount: today.count,
      todayRevenue: fromCents(today.revenueCents),
      activeCount,
      avgTicket7d: count7 > 0 ? fromCents(Math.round(revenue7 / count7)) : 0,
      series: series.map((d) => ({ date: d.date, count: d.count, revenue: fromCents(d.revenueCents) })),
    };
  }

  // ==========================================================================
  // Leitura (dashboard)
  // ==========================================================================

  listForTenant(tenantId: string) {
    return this.prisma.order.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: { items: { include: { modifiers: true } }, dineTable: { select: { name: true } } },
    });
  }

  async getForTenant(tenantId: string, id: string) {
    const order = await this.prisma.order.findFirst({
      where: { id, tenantId },
      include: { items: { include: { modifiers: true } }, dineTable: { select: { name: true } } },
    });
    if (!order) throw new NotFoundException('Encomenda não encontrada.');
    return order;
  }

  /** Projeção pública mínima para a página de acompanhamento (sem telefone/morada/nome). */
  async getPublicTracking(token: string) {
    const order = await this.prisma.order.findUnique({
      where: { trackToken: token },
      select: {
        number: true,
        status: true,
        type: true,
        createdAt: true,
        total: true,
        tenant: { select: { name: true, slug: true } },
        items: { select: { name: true, quantity: true } },
      },
    });
    if (!order) throw new NotFoundException('Pedido não encontrado.');
    return {
      number: order.number,
      status: order.status,
      type: order.type,
      createdAt: order.createdAt,
      total: Number(order.total),
      restaurantName: order.tenant.name,
      slug: order.tenant.slug,
      items: order.items.map((i) => ({ name: i.name, quantity: i.quantity })),
    };
  }
}
