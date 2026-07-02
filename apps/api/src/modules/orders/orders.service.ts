import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, OrderType, PaymentMethod, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePublicOrderDto } from './dto/create-order.dto';
import { OrdersGateway } from './orders.gateway';
import { computeOpenNow } from '../tenants/open-now.util';
import { isSubscriptionUsable } from '../tenants/subscription.util';
import { PromotionsService } from '../promotions/promotions.service';

// trabalhar em cêntimos evita erros de vírgula flutuante
const toCents = (v: Prisma.Decimal | number | string) => Math.round(Number(v) * 100);
const fromCents = (c: number) => c / 100;

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: OrdersGateway,
    private readonly promotions: PromotionsService,
  ) {}

  // ==========================================================================
  // Criação pública (storefront)
  // ==========================================================================

  async createPublicOrder(slug: string, dto: CreatePublicOrderDto) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      include: { openingHours: true, deliveryZones: true },
    });
    if (!tenant || tenant.status !== 'ACTIVE' || !isSubscriptionUsable(tenant)) {
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

    // carregar produtos pedidos (do tenant, ativos) com as suas opções
    const productIds = [...new Set(dto.items.map((i) => i.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, tenantId: tenant.id, active: true },
      include: { modifierGroups: { include: { modifiers: true } } },
    });
    const productMap = new Map(products.map((p) => [p.id, p]));

    // construir as linhas da encomenda com preços do servidor
    let subtotalCents = 0;
    const itemsData: Prisma.OrderItemCreateWithoutOrderInput[] = [];

    for (const item of dto.items) {
      const product = productMap.get(item.productId);
      if (!product) {
        throw new BadRequestException(`Produto indisponível: ${item.productId}`);
      }

      // opções válidas para este produto
      const validModifiers = new Map(
        product.modifierGroups.flatMap((g) => g.modifiers).map((m) => [m.id, m]),
      );

      let unitCents = toCents(product.price);
      const chosenModifiers: Prisma.OrderItemModifierCreateWithoutOrderItemInput[] = [];

      for (const modId of item.modifierIds ?? []) {
        const mod = validModifiers.get(modId);
        if (!mod) {
          throw new BadRequestException(`Opção inválida para "${product.name}".`);
        }
        unitCents += toCents(mod.priceDelta);
        chosenModifiers.push({ name: mod.name, priceDelta: mod.priceDelta });
      }

      const lineCents = unitCents * item.quantity;
      subtotalCents += lineCents;

      itemsData.push({
        productId: product.id,
        name: product.name,
        quantity: item.quantity,
        unitPrice: fromCents(unitCents),
        total: fromCents(lineCents),
        modifiers: chosenModifiers.length ? { create: chosenModifiers } : undefined,
      });
    }

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
          deliveryAddress: dto.deliveryAddress,
          deliveryCity: dto.deliveryCity,
          deliveryZipCode: dto.deliveryZipCode,
          notes: dto.notes,
          paymentMethod: dto.paymentMethod,
          subtotal: fromCents(subtotalCents),
          deliveryFee: fromCents(deliveryCents),
          discount: fromCents(discountCents),
          couponCode,
          total: fromCents(totalCents),
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
    return updated;
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
      include: { items: { include: { modifiers: true } } },
    });
  }

  async getForTenant(tenantId: string, id: string) {
    const order = await this.prisma.order.findFirst({
      where: { id, tenantId },
      include: { items: { include: { modifiers: true } } },
    });
    if (!order) throw new NotFoundException('Encomenda não encontrada.');
    return order;
  }
}
