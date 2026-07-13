import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** Luminância relativa (WCAG) de uma cor #rrggbb — 0 = preto, 1 = branco. */
function relativeLuminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { OpeningHourDto } from './dto/opening-hours.dto';
import { computeOpenNow } from './open-now.util';
import { computeSubscription, isSubscriptionUsable } from './subscription.util';
import { isReservedSlug } from '../../common/reserved-slugs';

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Dados públicos da loja (storefront) — só restaurantes ativos. */
  async getPublicBySlug(slug: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      include: { openingHours: true, account: true },
    });
    if (!tenant || tenant.status !== 'ACTIVE' || !isSubscriptionUsable(tenant.account)) {
      throw new NotFoundException('Loja não encontrada.');
    }

    const { openingHours, ...rest } = tenant;
    return {
      id: rest.id,
      slug: rest.slug,
      name: rest.name,
      logoUrl: rest.logoUrl,
      coverUrl: rest.coverUrl,
      brandColor: rest.brandColor,
      heroColor: rest.heroColor,
      city: rest.city,
      currency: rest.currency,
      acceptsDelivery: rest.acceptsDelivery,
      acceptsPickup: rest.acceptsPickup,
      deliveryFee: rest.deliveryFee,
      minOrderValue: rest.minOrderValue,
      // "aberto" efetivo = toggle manual E dentro do horário
      isOpen: computeOpenNow(tenant, openingHours),
    };
  }

  /** Indica se a loja aceita encomendas neste momento (usado no checkout). */
  async isAcceptingOrders(slug: string): Promise<boolean> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      include: { openingHours: true, account: true },
    });
    if (!tenant || tenant.status !== 'ACTIVE' || !isSubscriptionUsable(tenant.account)) return false;
    return computeOpenNow(tenant, tenant.openingHours);
  }

  /** Dados completos do restaurante autenticado (inclui estado da subscrição da conta). */
  async getMine(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { openingHours: { orderBy: { weekday: 'asc' } }, account: true },
    });
    if (!tenant) throw new NotFoundException('Restaurante não encontrado.');
    const { account, ...rest } = tenant;
    return {
      ...rest,
      // subscrição é da CONTA (partilhada por todas as unidades)
      subscription: computeSubscription(account),
      stripeSubscriptionId: account.stripeSubscriptionId,
    };
  }

  /** Todas as unidades da conta do dono (para o seletor de loja). */
  async listMine(accountId: string) {
    return this.prisma.tenant.findMany({
      where: { accountId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, slug: true, name: true, status: true, logoUrl: true, city: true },
    });
  }

  /** Cria uma nova unidade na conta do dono (fica PENDING até o admin ativar). */
  async createTenant(accountId: string, dto: CreateTenantDto) {
    if (isReservedSlug(dto.slug)) {
      throw new BadRequestException('Esse endereço de loja (slug) não está disponível.');
    }
    const existingSlug = await this.prisma.tenant.findUnique({ where: { slug: dto.slug } });
    if (existingSlug) {
      throw new BadRequestException('Esse endereço de loja (slug) já está em uso.');
    }
    return this.prisma.tenant.create({
      data: { accountId, slug: dto.slug, name: dto.name },
      select: { id: true, slug: true, name: true, status: true, logoUrl: true, city: true },
    });
  }

  async updateMine(tenantId: string, dto: UpdateTenantDto) {
    await this.ensure(tenantId);
    const data: Record<string, unknown> = { ...dto };

    // cores da montra: normaliza, valida legibilidade; vazio repõe o tema
    for (const field of ['brandColor', 'heroColor'] as const) {
      if (dto[field] === undefined) continue;
      const hex = dto[field]!.trim().toLowerCase();
      if (!hex) {
        data[field] = null;
        continue;
      }
      const lum = relativeLuminance(hex);
      if (field === 'brandColor' && lum > 0.65) {
        throw new BadRequestException(
          'A cor da marca é demasiado clara — o texto dos botões ficaria ilegível. Escolhe um tom mais escuro.',
        );
      }
      if (field === 'heroColor' && lum > 0.45) {
        throw new BadRequestException(
          'A cor do topo é demasiado clara — o nome da loja ficaria ilegível. Escolhe um tom escuro.',
        );
      }
      data[field] = hex;
    }

    return this.prisma.tenant.update({ where: { id: tenantId }, data });
  }

  async getMyHours(tenantId: string) {
    await this.ensure(tenantId);
    return this.prisma.openingHour.findMany({
      where: { tenantId },
      orderBy: { weekday: 'asc' },
    });
  }

  /** Substitui o horário completo (transação: apaga e recria). */
  async setMyHours(tenantId: string, hours: OpeningHourDto[]) {
    await this.ensure(tenantId);
    for (const h of hours) {
      if (h.closeMinute <= h.openMinute) {
        throw new BadRequestException(
          `Horário inválido no dia ${h.weekday}: fecho tem de ser depois da abertura.`,
        );
      }
    }
    await this.prisma.$transaction([
      this.prisma.openingHour.deleteMany({ where: { tenantId } }),
      this.prisma.openingHour.createMany({
        data: hours.map((h) => ({
          tenantId,
          weekday: h.weekday,
          openMinute: h.openMinute,
          closeMinute: h.closeMinute,
        })),
      }),
    ]);
    return this.getMyHours(tenantId);
  }

  // --------------------------------------------------------------------------

  private async ensure(tenantId: string) {
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!t) throw new NotFoundException('Restaurante não encontrado.');
    return t;
  }
}
