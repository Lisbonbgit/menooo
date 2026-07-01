import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  /** Lista todos os restaurantes com contagens, para o painel da plataforma. */
  async listTenants() {
    const tenants = await this.prisma.tenant.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { orders: true, products: true } },
        users: {
          where: { role: 'OWNER' },
          select: { name: true, email: true },
          take: 1,
        },
      },
    });
    return tenants.map((t) => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      status: t.status,
      plan: t.plan,
      city: t.city,
      owner: t.users[0] ?? null,
      orders: t._count.orders,
      products: t._count.products,
      createdAt: t.createdAt,
    }));
  }

  async setTenantStatus(id: string, status: TenantStatus) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('Restaurante não encontrado.');
    return this.prisma.tenant.update({ where: { id }, data: { status } });
  }

  async stats() {
    const [total, active, pending, orders] = await Promise.all([
      this.prisma.tenant.count(),
      this.prisma.tenant.count({ where: { status: 'ACTIVE' } }),
      this.prisma.tenant.count({ where: { status: 'PENDING' } }),
      this.prisma.order.count(),
    ]);
    return { total, active, pending, orders };
  }
}
