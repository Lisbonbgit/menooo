import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { isSubscriptionUsable } from '../tenants/subscription.util';
import { BulkDineTableDto, CreateDineTableDto, UpdateDineTableDto } from './dto/dine-table.dto';
import { CreateDineOrderDto } from './dto/dine-order.dto';
import { OrdersGateway } from '../orders/orders.gateway';
import { buildOrderItems } from '../orders/order-items.util';
import { fromCents } from '../orders/money.util';

@Injectable()
export class DineTablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: OrdersGateway,
  ) {}

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

  // ==========================================================================
  // Pedido na mesa (dine-in QR) + sessão da conta (Fase 2b, Task 2)
  // ==========================================================================

  /**
   * Cria um pedido feito à mesa. Resolve a mesa por slug+qrToken JUNTOS (isolamento de QR:
   * mesmo padrão do `resolvePublic`), exige `dineInOrderingEnabled`, e só aceita produtos do
   * menu de Sala (isolamento de menu — `buildOrderItems` já lança "Produto indisponível" para
   * o resto). Abre (ou reutiliza) a sessão OPEN da mesa dentro de uma transação serializada por
   * `pg_advisory_xact_lock(hashtext(tableId))` (mesmo padrão do `reservations.service.ts`) —
   * o índice único parcial (`TableSession_one_open_per_table`) é o backstop da BD.
   */
  async createDineInOrder(slug: string, qrToken: string, dto: CreateDineOrderDto) {
    const table = await this.prisma.dineTable.findFirst({
      where: { qrToken, active: true, tenant: { slug, status: 'ACTIVE' } },
      select: {
        id: true,
        name: true,
        tenantId: true,
        tenant: { select: { account: true, dineInOrderingEnabled: true } },
      },
    });
    if (!table || !isSubscriptionUsable(table.tenant.account)) {
      throw new NotFoundException('Mesa não encontrada.');
    }
    if (!table.tenant.dineInOrderingEnabled) {
      throw new BadRequestException('Esta loja ainda não aceita pedidos na mesa.');
    }

    // só produtos do menu de Sala (dine-in) — isola do menu de Delivery
    const productIds = [...new Set(dto.items.map((i) => i.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, tenantId: table.tenantId, active: true, category: { menu: { type: 'DINE_IN' } } },
      include: { modifierGroupLinks: { include: { group: { include: { modifiers: true } } } } },
    });
    const { itemsData, subtotalCents, vatLines } = buildOrderItems(products, dto.items);
    // IVA incluído no preço; sem desconto/entrega na mesa — cálculo direto por linha.
    let vatCents = 0;
    for (const l of vatLines) vatCents += Math.round((l.lineCents * l.vatRate) / (100 + l.vatRate));

    const order = await this.prisma.$transaction(async (tx) => {
      // uma sessão OPEN por mesa: serializar por mesa (evita duas sessões abertas em corrida)
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${table.id}))`;
      let session = await tx.tableSession.findFirst({ where: { dineTableId: table.id, status: 'OPEN' } });
      if (!session) session = await tx.tableSession.create({ data: { tenantId: table.tenantId, dineTableId: table.id } });

      const last = await tx.order.findFirst({
        where: { tenantId: table.tenantId },
        orderBy: { number: 'desc' },
        select: { number: true },
      });
      const number = (last?.number ?? 0) + 1;

      return tx.order.create({
        data: {
          tenantId: table.tenantId,
          number,
          type: 'DINE_IN',
          customerName: table.name,
          customerPhone: '',
          dineTableId: table.id,
          tableSessionId: session.id,
          paymentMethod: 'CASH',
          subtotal: fromCents(subtotalCents),
          deliveryFee: 0,
          discount: 0,
          total: fromCents(subtotalCents),
          vatTotal: fromCents(vatCents),
          notes: dto.notes,
          items: { create: itemsData },
        },
        include: { items: { include: { modifiers: true } } },
      });
    });
    this.gateway.emitNewOrder(table.tenantId, order);
    return order;
  }

  /** Sessões (contas) abertas de todas as mesas do tenant, com os pedidos e o total acumulado. */
  async listOpenSessions(tenantId: string) {
    const sessions = await this.prisma.tableSession.findMany({
      where: { tenantId, status: 'OPEN' },
      orderBy: { openedAt: 'asc' },
      include: {
        dineTable: { select: { name: true } },
        orders: { select: { id: true, number: true, status: true, total: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
      },
    });
    return sessions.map((s) => ({
      id: s.id,
      table: s.dineTable.name,
      openedAt: s.openedAt,
      orders: s.orders.map((o) => ({ ...o, total: Number(o.total) })),
      total: s.orders.reduce((a, o) => a + Number(o.total), 0),
    }));
  }

  /** Fecha a conta da mesa (staff). Uma sessão já fechada ou inexistente → 404. */
  async closeSession(tenantId: string, id: string) {
    const r = await this.prisma.tableSession.updateMany({
      where: { id, tenantId, status: 'OPEN' },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
    if (r.count === 0) throw new NotFoundException('Conta não encontrada ou já fechada.');
    return { ok: true };
  }
}
