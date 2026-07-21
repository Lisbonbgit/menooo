import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { isSubscriptionUsable } from '../tenants/subscription.util';
import { BulkDineTableDto, CreateDineTableDto, UpdateDineTableDto } from './dto/dine-table.dto';

@Injectable()
export class DineTablesService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string) {
    return this.prisma.dineTable.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  create(tenantId: string, dto: CreateDineTableDto) {
    return this.prisma.dineTable.create({ data: { tenantId, name: dto.name.trim() } });
  }

  async bulk(tenantId: string, dto: BulkDineTableDto) {
    const prefix = (dto.prefix ?? 'Mesa').trim();
    const base = await this.prisma.dineTable.count({ where: { tenantId } });
    const data = Array.from({ length: dto.count }, (_, i) => ({
      tenantId,
      name: `${prefix} ${base + i + 1}`,
      sortOrder: base + i,
    }));
    // createMany não devolve as linhas; criar e devolver a lista atualizada
    await this.prisma.dineTable.createMany({ data });
    return this.list(tenantId);
  }

  async update(tenantId: string, id: string, dto: UpdateDineTableDto) {
    const data: { name?: string; active?: boolean } = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.active !== undefined) data.active = dto.active;
    const r = await this.prisma.dineTable.updateMany({ where: { id, tenantId }, data });
    if (r.count === 0) throw new NotFoundException('Mesa não encontrada.');
    return this.prisma.dineTable.findFirst({ where: { id, tenantId } });
  }

  async remove(tenantId: string, id: string) {
    const r = await this.prisma.dineTable.deleteMany({ where: { id, tenantId } });
    if (r.count === 0) throw new NotFoundException('Mesa não encontrada.');
    return { ok: true };
  }

  /**
   * Resolve o QR SEMPRE por slug+token juntos: um token só serve o seu restaurante. 404 caso
   * contrário. Mesmo gating de acesso público do `getPublicMenu` (catalog.service.ts): a loja tem
   * de estar ACTIVE e a conta com subscrição utilizável (isSubscriptionUsable), senão 404 neutro —
   * não confirmar nem negar existência do token para quem não devia lá chegar.
   */
  async resolvePublic(slug: string, qrToken: string) {
    const table = await this.prisma.dineTable.findFirst({
      where: {
        qrToken,
        active: true,
        tenant: { slug, status: 'ACTIVE' },
      },
      select: { id: true, name: true, tenant: { select: { account: true } } },
    });
    if (!table || !isSubscriptionUsable(table.tenant.account)) {
      throw new NotFoundException('Mesa não encontrada.');
    }
    return { id: table.id, name: table.name };
  }
}
