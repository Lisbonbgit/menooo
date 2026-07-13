/**
 * Refaz o menu da loja de demonstração (pizzaria-demo) — a montra do Menooo.
 * Substitui categorias/produtos/opções por um menu rico com fotos, tamanhos,
 * extras e um cupão de exemplo. Corre UMA vez por ambiente:
 *
 *   DATABASE_URL=... node scripts/refresh-demo.mjs
 *
 * Idempotente: apaga o menu atual da demo e recria-o do zero.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const SLUG = 'pizzaria-demo';

// foto do Unsplash (licença livre) em tamanho de cartão
const img = (id) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=800&q=70`;

const CATEGORIES = [
  {
    name: 'Entradas',
    products: [
      ['Bruschetta', 'Pão tostado, tomate, alho e manjericão fresco', 4.5, '1572695157366-5e585ab2b69f'],
      ['Pão de Alho', 'Fatias de pão com manteiga de alho e ervas', 3.5, '1572695157360-1153aaad020b'],
      ['Salada Caprese', 'Tomate, mozzarella fresca, manjericão e azeite', 6.5, '1506280754576-f6fa8a873550'],
    ],
  },
  {
    name: 'Pizzas',
    // as pizzas ganham os grupos Tamanho + Extras
    withOptions: true,
    products: [
      ['Margherita', 'Tomate, mozzarella e manjericão', 8.5, '1604382354936-07c5d9983bd3'],
      ['Diavola', 'Salame picante, mozzarella e tomate', 10.5, '1534308983496-4fabb1a015ee'],
      ['Quatro Queijos', 'Mozzarella, gorgonzola, parmesão e provolone', 11.0, '1593504049359-74330189a345'],
      ['Prosciutto e Rúcula', 'Presunto, rúcula, parmesão e tomate', 11.5, '1593560708920-61dd98c46a4e'],
      ['Vegetariana', 'Curgete, beringela, pimento, cogumelos e tomate', 10.0, '1571066811602-716837d681de'],
      ['Napolitana', 'Tomate, mozzarella, anchovas, alcaparras e orégãos', 10.5, '1579751626657-72bc17010498'],
      ['Calabresa', 'Chouriço calabresa, cebola e mozzarella', 10.5, '1565299624946-b28f40a0ae38'],
      ['Quatro Estações', 'Fiambre, cogumelos, alcachofra, azeitonas e tomate', 12.0, '1513104890138-7c749659a591'],
    ],
  },
  {
    name: 'Bebidas',
    products: [
      ['Água 0,5 L', 'Água mineral natural', 1.5, '1534616042650-80f5c9b61f09'],
      ['Coca-Cola', 'Copo com gelo, 33 cl', 1.8, '1629654613528-5d0a2e4166de'],
      ['Fanta Laranja', 'Copo, 33 cl', 1.8, '1600271886742-f049cd451bba'],
      ['Sprite', 'Copo com gelo e limão, 33 cl', 1.8, '1607690506833-498e04ab3ffa'],
    ],
  },
  {
    name: 'Sobremesas',
    products: [
      ['Tiramisù', 'Clássico italiano com café e mascarpone', 4.5, '1517400415121-f913b6f87532'],
      ['Bolo de Chocolate', 'Fatia de bolo de chocolate com ganache', 4.0, '1662230786065-154eafffa3e6'],
      ['Cheesecake', 'Cheesecake com calda de frutos vermelhos', 4.5, '1714385905983-6f8e06fffae1'],
    ],
  },
];

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG } });
  if (!tenant) throw new Error(`Loja demo "${SLUG}" não encontrada.`);
  const tenantId = tenant.id;

  // capa da montra (hero + preview OG quando a demo é partilhada)
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { coverUrl: img('1513104890138-7c749659a591') },
  });

  // limpar o menu atual (categorias→produtos→links em cascata; grupos e cupões à parte)
  await prisma.category.deleteMany({ where: { tenantId } });
  await prisma.modifierGroup.deleteMany({ where: { tenantId } });

  // grupos de opções reutilizáveis (nível loja)
  const tamanho = await prisma.modifierGroup.create({
    data: {
      tenantId,
      name: 'Tamanho',
      required: true,
      minSelect: 1,
      maxSelect: 1,
      modifiers: {
        create: [
          { name: 'Média (30 cm)', priceDelta: 0, sortOrder: 0 },
          { name: 'Grande (40 cm)', priceDelta: 3.5, sortOrder: 1 },
          { name: 'Família (50 cm)', priceDelta: 6.0, sortOrder: 2 },
        ],
      },
    },
  });
  const extras = await prisma.modifierGroup.create({
    data: {
      tenantId,
      name: 'Extras',
      required: false,
      minSelect: 0,
      maxSelect: 4,
      modifiers: {
        create: [
          { name: 'Extra mozzarella', priceDelta: 1.5, sortOrder: 0 },
          { name: 'Cogumelos', priceDelta: 1.0, sortOrder: 1 },
          { name: 'Fiambre', priceDelta: 1.5, sortOrder: 2 },
          { name: 'Rúcula', priceDelta: 1.0, sortOrder: 3 },
          { name: 'Azeitonas', priceDelta: 0.8, sortOrder: 4 },
        ],
      },
    },
  });

  // categorias + produtos
  let catOrder = 0;
  for (const cat of CATEGORIES) {
    const category = await prisma.category.create({
      data: { tenantId, name: cat.name, sortOrder: catOrder++ },
    });
    let prodOrder = 0;
    for (const [name, description, price, photoId] of cat.products) {
      const product = await prisma.product.create({
        data: {
          tenantId,
          categoryId: category.id,
          name,
          description,
          price,
          vatRate: 23,
          imageUrl: img(photoId),
          sortOrder: prodOrder++,
        },
      });
      if (cat.withOptions) {
        await prisma.productModifierGroup.createMany({
          data: [
            { productId: product.id, groupId: tamanho.id, sortOrder: 0 },
            { productId: product.id, groupId: extras.id, sortOrder: 1 },
          ],
        });
      }
    }
  }

  // cupão de exemplo (10% de desconto)
  await prisma.coupon.deleteMany({ where: { tenantId, code: 'BEMVINDO10' } });
  await prisma.coupon.create({
    data: {
      tenantId,
      code: 'BEMVINDO10',
      type: 'PERCENT',
      value: 10,
      active: true,
    },
  });

  const counts = {
    categorias: CATEGORIES.length,
    produtos: CATEGORIES.reduce((n, c) => n + c.products.length, 0),
    grupos: 2,
    cupao: 'BEMVINDO10 (10%)',
  };
  console.log('✅ Demo refeita:', JSON.stringify(counts));
}

main()
  .catch((e) => {
    console.error('❌ Erro a refazer a demo:', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
