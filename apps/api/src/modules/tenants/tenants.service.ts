import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { OpeningHourDto } from './dto/opening-hours.dto';
import { computeOpenNow } from './open-now.util';

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Dados públicos da loja (storefront) — só restaurantes ativos. */
  async getPublicBySlug(slug: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      include: { openingHours: true },
    });
    if (!tenant || tenant.status !== 'ACTIVE') {
      throw new NotFoundException('Loja não encontrada.');
    }

    const { openingHours, ...rest } = tenant;
    return {
      id: rest.id,
      slug: rest.slug,
      name: rest.name,
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
      include: { openingHours: true },
    });
    if (!tenant || tenant.status !== 'ACTIVE') return false;
    return computeOpenNow(tenant, tenant.openingHours);
  }

  /** Dados completos do restaurante autenticado. */
  async getMine(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { openingHours: { orderBy: { weekday: 'asc' } } },
    });
    if (!tenant) throw new NotFoundException('Restaurante não encontrado.');
    return tenant;
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
