import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Coupon, CouponType, DeliveryZone, OrderType, Prisma, Tenant } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isSubscriptionUsable } from '../tenants/subscription.util';
import { CreateDeliveryZoneDto, UpdateDeliveryZoneDto } from './dto/delivery-zone.dto';
import { CreateCouponDto, UpdateCouponDto } from './dto/coupon.dto';

const toCents = (v: Prisma.Decimal | number | string) => Math.round(Number(v) * 100);
const fromCents = (c: number) => c / 100;

export interface DeliveryResolution {
  feeCents: number;
  minOrderCents: number;
  zoneId?: string;
}

export interface CouponEvaluation {
  valid: boolean;
  reason?: string;
  discountCents: number;
  couponId?: string;
  code?: string;
}

@Injectable()
export class PromotionsService {
  constructor(private readonly prisma: PrismaService) {}

  // ==========================================================================
  // Zonas de entrega (dashboard)
  // ==========================================================================

  listZones(tenantId: string) {
    return this.prisma.deliveryZone.findMany({
      where: { tenantId },
      orderBy: { postalPrefix: 'asc' },
    });
  }

  createZone(tenantId: string, dto: CreateDeliveryZoneDto) {
    return this.prisma.deliveryZone.create({
      data: {
        tenantId,
        name: dto.name,
        postalPrefix: dto.postalPrefix,
        fee: dto.fee,
        minOrder: dto.minOrder ?? 0,
      },
    });
  }

  async updateZone(tenantId: string, id: string, dto: UpdateDeliveryZoneDto) {
    await this.ensureZone(tenantId, id);
    return this.prisma.deliveryZone.update({ where: { id }, data: dto });
  }

  async deleteZone(tenantId: string, id: string) {
    await this.ensureZone(tenantId, id);
    await this.prisma.deliveryZone.delete({ where: { id } });
    return { deleted: true };
  }

  // ==========================================================================
  // Cupões (dashboard)
  // ==========================================================================

  listCoupons(tenantId: string) {
    return this.prisma.coupon.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } });
  }

  async createCoupon(tenantId: string, dto: CreateCouponDto) {
    if (dto.type === CouponType.PERCENT && dto.value > 100) {
      throw new BadRequestException('Percentagem não pode exceder 100%.');
    }
    const code = dto.code.trim().toUpperCase();
    const exists = await this.prisma.coupon.findUnique({
      where: { tenantId_code: { tenantId, code } },
    });
    if (exists) throw new BadRequestException('Já existe um cupão com esse código.');

    return this.prisma.coupon.create({
      data: {
        tenantId,
        code,
        type: dto.type,
        value: dto.value,
        minOrder: dto.minOrder ?? 0,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        maxUses: dto.maxUses ?? null,
      },
    });
  }

  async updateCoupon(tenantId: string, id: string, dto: UpdateCouponDto) {
    await this.ensureCoupon(tenantId, id);
    const data: Prisma.CouponUpdateInput = { ...dto } as Prisma.CouponUpdateInput;
    if (dto.expiresAt !== undefined) {
      data.expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    }
    return this.prisma.coupon.update({ where: { id }, data });
  }

  async deleteCoupon(tenantId: string, id: string) {
    await this.ensureCoupon(tenantId, id);
    await this.prisma.coupon.delete({ where: { id } });
    return { deleted: true };
  }

  // ==========================================================================
  // Cálculo para o checkout (usado por OrdersService e endpoints públicos)
  // ==========================================================================

  /** Resolve a taxa de entrega e o mínimo aplicável (por zona, se houver). */
  resolveDelivery(
    tenant: Tenant,
    zones: DeliveryZone[],
    type: OrderType,
    zip?: string,
  ): DeliveryResolution {
    if (type === OrderType.PICKUP) {
      return { feeCents: 0, minOrderCents: toCents(tenant.minOrderValue) };
    }

    const active = zones.filter((z) => z.active);
    if (active.length === 0) {
      // sem zonas definidas => taxa/mínimo gerais da loja
      return {
        feeCents: toCents(tenant.deliveryFee),
        minOrderCents: toCents(tenant.minOrderValue),
      };
    }

    const digits = (zip ?? '').replace(/\D/g, '');
    if (!digits) throw new BadRequestException('Indica o código postal de entrega.');

    const matches = active
      .filter((z) => digits.startsWith(z.postalPrefix))
      .sort((a, b) => b.postalPrefix.length - a.postalPrefix.length); // mais específico primeiro

    if (matches.length === 0) {
      throw new BadRequestException('Sem entrega para esse código postal.');
    }
    const zone = matches[0];
    return { feeCents: toCents(zone.fee), minOrderCents: toCents(zone.minOrder), zoneId: zone.id };
  }

  /** Avalia um cupão sem lançar exceção (para pré-validação pública). */
  async evaluateCoupon(
    tenantId: string,
    codeRaw: string,
    subtotalCents: number,
  ): Promise<CouponEvaluation> {
    const code = codeRaw.trim().toUpperCase();
    const coupon = await this.prisma.coupon.findUnique({
      where: { tenantId_code: { tenantId, code } },
    });
    if (!coupon || !coupon.active) return { valid: false, reason: 'Cupão inválido.', discountCents: 0 };
    if (coupon.expiresAt && coupon.expiresAt.getTime() < Date.now()) {
      return { valid: false, reason: 'Cupão expirado.', discountCents: 0 };
    }
    if (coupon.maxUses != null && coupon.usedCount >= coupon.maxUses) {
      return { valid: false, reason: 'Cupão esgotado.', discountCents: 0 };
    }
    if (subtotalCents < toCents(coupon.minOrder)) {
      return {
        valid: false,
        reason: `Cupão requer mínimo de ${Number(coupon.minOrder).toFixed(2)} €.`,
        discountCents: 0,
      };
    }
    return {
      valid: true,
      discountCents: this.discountCents(coupon, subtotalCents),
      couponId: coupon.id,
      code: coupon.code,
    };
  }

  // ==========================================================================
  // Endpoints públicos (storefront) — por slug
  // ==========================================================================

  /** Quanto custa entregar num código postal (mostrado no checkout). */
  async publicDeliveryQuote(slug: string, zip: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      include: { deliveryZones: true },
    });
    if (!tenant || tenant.status !== 'ACTIVE' || !isSubscriptionUsable(tenant)) {
      throw new NotFoundException('Loja não encontrada.');
    }
    try {
      const r = this.resolveDelivery(tenant, tenant.deliveryZones, OrderType.DELIVERY, zip);
      return {
        delivered: true,
        fee: fromCents(r.feeCents),
        minOrder: fromCents(r.minOrderCents),
      };
    } catch {
      return { delivered: false, fee: 0, minOrder: 0 };
    }
  }

  /** Pré-valida um cupão e devolve o desconto estimado para um subtotal. */
  async publicValidateCoupon(slug: string, code: string, subtotal: number) {
    const tenant = await this.prisma.tenant.findUnique({ where: { slug } });
    if (!tenant || tenant.status !== 'ACTIVE' || !isSubscriptionUsable(tenant)) {
      throw new NotFoundException('Loja não encontrada.');
    }
    const ev = await this.evaluateCoupon(tenant.id, code, toCents(subtotal));
    return {
      valid: ev.valid,
      discount: fromCents(ev.discountCents),
      message: ev.reason,
      code: ev.code,
    };
  }

  private discountCents(coupon: Coupon, subtotalCents: number): number {
    const raw =
      coupon.type === CouponType.PERCENT
        ? Math.round((subtotalCents * Number(coupon.value)) / 100)
        : toCents(coupon.value);
    return Math.min(raw, subtotalCents); // nunca desconta mais do que o subtotal
  }

  // --------------------------------------------------------------------------

  private async ensureZone(tenantId: string, id: string) {
    const z = await this.prisma.deliveryZone.findFirst({ where: { id, tenantId } });
    if (!z) throw new NotFoundException('Zona de entrega não encontrada.');
    return z;
  }

  private async ensureCoupon(tenantId: string, id: string) {
    const c = await this.prisma.coupon.findFirst({ where: { id, tenantId } });
    if (!c) throw new NotFoundException('Cupão não encontrado.');
    return c;
  }
}
