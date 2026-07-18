import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { UserRole, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { OrdersGateway } from '../orders/orders.gateway';
import { generatePairCode, PAIR_CODE_TTL_MS } from '../../common/kitchen-pair.util';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly ordersGateway: OrdersGateway,
  ) {}

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
      reservationsEnabled: rest.reservationsEnabled,
      // Contacto e morada SÓ para quem ligou as reservas. O campo "Morada" das Definições nunca
      // foi publicado até aqui — há donos que lá terão posto a morada de faturação, e publicá-la
      // para toda a gente por causa de uma funcionalidade que não usam seria uma fuga a sério.
      // Quem liga o interruptor está a pedir para ser encontrado: aí é intencional (e a página
      // de reserva precisa — é o cliente que se desloca) . A página de gestão não depende disto:
      // recebe o `restaurantPhone` do próprio GET /public/reservations/:code.
      ...(rest.reservationsEnabled
        ? {
            phone: rest.phone,
            address: rest.address,
            zipCode: rest.zipCode,
            reservationMaxPartySize: rest.reservationMaxPartySize,
            reservationMaxAdvanceDays: rest.reservationMaxAdvanceDays,
            // Tolerância de atraso: é o que a loja promete ao cliente («a tua mesa fica guardada
            // X minutos»). Vai aqui dentro, com o resto — a API não publica dados de quem não
            // usa reservas.
            reservationGraceMin: rest.reservationGraceMin,
          }
        : {}),
    };
  }

  /** Lojas publicamente visíveis (para o sitemap): slug + data de atualização + flag de reservas. */
  async listPublicStores() {
    const tenants = await this.prisma.tenant.findMany({
      where: { status: 'ACTIVE' },
      include: { account: true },
      orderBy: { updatedAt: 'desc' },
    });
    return tenants
      .filter((t) => isSubscriptionUsable(t.account))
      .map((t) => ({
        slug: t.slug,
        updatedAt: t.updatedAt,
        reservationsEnabled: t.reservationsEnabled,
      }));
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
  async getMine(tenantId: string, minimal = false) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { openingHours: { orderBy: { weekday: 'asc' } }, account: true },
    });
    if (!tenant) throw new NotFoundException('Restaurante não encontrado.');
    // payload mínimo para a cozinha: nome para o talão e pouco mais —
    // sem subscrição/estado, os banners de dono nem sequer têm dados para disparar
    if (minimal) {
      return { id: tenant.id, name: tenant.name, slug: tenant.slug, isOpen: tenant.isOpen };
    }
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

    // ligar reservas sem mesas publica uma loja partida (30 dias vazios) — spec §11
    if (dto.reservationsEnabled === true) {
      const bookable = await this.prisma.table.count({
        where: { tenantId, active: true, bookableOnline: true },
      });
      if (bookable === 0) {
        throw new BadRequestException(
          'Cria pelo menos uma mesa reservável online antes de ligar as reservas.',
        );
      }
    }

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

  /** Gera um código de emparelhamento de uso-único para o tablet de cozinha. */
  async generateKitchenPairCode(tenantId: string) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { id, secret, display } = generatePairCode();
      const expiresAt = new Date(Date.now() + PAIR_CODE_TTL_MS);
      try {
        await this.prisma.tenant.update({
          where: { id: tenantId },
          data: {
            kitchenPairId: id,
            kitchenPairHash: await argon2.hash(secret),
            kitchenPairExpiresAt: expiresAt,
            kitchenPairAttempts: 0,
          },
        });
        return { code: display, expiresAt: expiresAt.toISOString() };
      } catch (e) {
        // colisão do id público (unique) — tenta outro
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue;
        throw e;
      }
    }
    throw new Error('Não foi possível gerar o código. Tenta novamente.');
  }

  /** Estado do emparelhamento da cozinha desta unidade. */
  async kitchenStatus(tenantId: string) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const kitchenUser = await this.prisma.user.findFirst({
      where: { kitchenTenantId: tenantId, role: UserRole.KITCHEN },
    });
    const activeSessions = kitchenUser
      ? await this.prisma.refreshToken.count({
          where: { userId: kitchenUser.id, revokedAt: null, expiresAt: { gt: new Date() } },
        })
      : 0;
    return {
      paired: activeSessions > 0,
      pairedAt: tenant.kitchenPairedAt?.toISOString() ?? null,
      activeSessions,
      pendingCode:
        !!tenant.kitchenPairHash &&
        !!tenant.kitchenPairExpiresAt &&
        tenant.kitchenPairExpiresAt.getTime() > Date.now(),
    };
  }

  /** Desemparelha a cozinha: revoga sessões, limpa código pendente, desliga sockets. */
  async unpairKitchen(tenantId: string) {
    const kitchenUsers = await this.prisma.user.findMany({
      where: { kitchenTenantId: tenantId, role: UserRole.KITCHEN },
      select: { id: true },
    });
    await this.prisma.$transaction([
      this.prisma.refreshToken.deleteMany({
        where: { userId: { in: kitchenUsers.map((u) => u.id) } },
      }),
      this.prisma.tenant.update({
        where: { id: tenantId },
        data: {
          kitchenPairId: null,
          kitchenPairHash: null,
          kitchenPairExpiresAt: null,
          kitchenPairAttempts: 0,
        },
      }),
    ]);
    await this.ordersGateway.disconnectKitchen(tenantId);
    return { ok: true };
  }

  // --------------------------------------------------------------------------

  private async ensure(tenantId: string) {
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!t) throw new NotFoundException('Restaurante não encontrado.');
    return t;
  }
}
