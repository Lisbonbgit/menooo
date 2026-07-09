import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { OpeningHourDto } from './dto/opening-hours.dto';
import { computeOpenNow } from './open-now.util';
import { computeSubscription, isSubscriptionUsable } from './subscription.util';

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
    return this.prisma.tenant.update({ where: { id: tenantId }, data: dto });
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
