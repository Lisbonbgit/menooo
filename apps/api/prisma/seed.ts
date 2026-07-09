import { PrismaClient, TenantStatus, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  // --- Super admin da plataforma (sem conta) ---
  const adminEmail = 'admin@menooo.pt';
  const adminPass = await argon2.hash('admin1234');
  await prisma.user.upsert({
    where: { id: 'seed-super-admin' },
    update: {},
    create: {
      id: 'seed-super-admin',
      accountId: null,
      name: 'Super Admin',
      email: adminEmail,
      passwordHash: adminPass,
      role: UserRole.SUPER_ADMIN,
    },
  });

  // --- Conta demo + restaurante (ativo) + dono ---
  let tenant = await prisma.tenant.findUnique({ where: { slug: 'pizzaria-demo' } });
  if (!tenant) {
    const ownerPass = await argon2.hash('demo1234');
    const account = await prisma.account.create({
      data: {
        name: 'Pizzaria Demo',
        // subscrição paga (só para o demo ficar visível em desenvolvimento)
        paidUntil: new Date(Date.now() + 3650 * 86_400_000),
        activatedAt: new Date(),
        tenants: {
          create: {
            slug: 'pizzaria-demo',
            name: 'Pizzaria Demo',
            status: TenantStatus.ACTIVE,
            isOpen: true,
            city: 'Lisboa',
            deliveryFee: 2.5,
            minOrderValue: 10,
          },
        },
        users: {
          create: {
            name: 'Dono Demo',
            email: 'dono@pizzaria-demo.pt',
            passwordHash: ownerPass,
            role: UserRole.OWNER,
          },
        },
      },
      include: { tenants: true },
    });
    tenant = account.tenants[0];
  }

  // --- Menu demo (idempotente: só cria se vazio) ---
  const catCount = await prisma.category.count({ where: { tenantId: tenant.id } });
  if (catCount === 0) {
    const pizzas = await prisma.category.create({
      data: { tenantId: tenant.id, name: 'Pizzas', sortOrder: 1 },
    });
    const bebidas = await prisma.category.create({
      data: { tenantId: tenant.id, name: 'Bebidas', sortOrder: 2 },
    });

    await prisma.product.create({
      data: {
        tenantId: tenant.id,
        categoryId: pizzas.id,
        name: 'Margherita',
        description: 'Molho de tomate, mozzarella e manjericão',
        price: 8.5,
        modifierGroups: {
          create: {
            name: 'Tamanho',
            required: true,
            minSelect: 1,
            maxSelect: 1,
            modifiers: {
              create: [
                { name: 'Média', priceDelta: 0 },
                { name: 'Grande', priceDelta: 3 },
              ],
            },
          },
        },
      },
    });
    await prisma.product.create({
      data: {
        tenantId: tenant.id,
        categoryId: bebidas.id,
        name: 'Água 0.5L',
        price: 1.2,
      },
    });
  }

  // eslint-disable-next-line no-console
  console.log('✅ Seed concluído.');
  // eslint-disable-next-line no-console
  console.log(`   Super admin: ${adminEmail} / admin1234`);
  console.log(`   Restaurante: dono@pizzaria-demo.pt / demo1234  (loja: /pizzaria-demo)`);
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
