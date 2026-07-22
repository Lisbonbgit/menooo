import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { toCents, fromCents } from './money.util';

type ProdWithMods = Prisma.ProductGetPayload<{
  include: { modifierGroupLinks: { include: { group: { include: { modifiers: true } } } } };
}>;
export interface OrderItemInput {
  productId: string;
  quantity: number;
  modifierIds?: string[];
}

/**
 * Constrói as linhas da encomenda com preços do servidor (nunca confia no preço do cliente).
 * Extraído de `createPublicOrder` — puro, sem I/O, para ser reutilizado pelo checkout dine-in
 * (Fase 2b, Task 2) sem duplicar o cálculo.
 */
export function buildOrderItems(products: ProdWithMods[], items: OrderItemInput[]) {
  const productMap = new Map(products.map((p) => [p.id, p]));
  let subtotalCents = 0;
  const itemsData: Prisma.OrderItemCreateWithoutOrderInput[] = [];
  const vatLines: { lineCents: number; vatRate: number }[] = [];
  for (const item of items) {
    const product = productMap.get(item.productId);
    if (!product) throw new BadRequestException(`Produto indisponível: ${item.productId}`);
    const validModifiers = new Map(
      product.modifierGroupLinks.flatMap((l) => l.group.modifiers).map((m) => [m.id, m]),
    );
    let unitCents = toCents(product.price);
    const chosenModifiers: Prisma.OrderItemModifierCreateWithoutOrderItemInput[] = [];
    for (const modId of item.modifierIds ?? []) {
      const mod = validModifiers.get(modId);
      if (!mod) throw new BadRequestException(`Opção inválida para "${product.name}".`);
      unitCents += toCents(mod.priceDelta);
      chosenModifiers.push({ name: mod.name, priceDelta: mod.priceDelta });
    }
    const lineCents = unitCents * item.quantity;
    subtotalCents += lineCents;
    vatLines.push({ lineCents, vatRate: product.vatRate });
    itemsData.push({
      productId: product.id,
      name: product.name,
      quantity: item.quantity,
      unitPrice: fromCents(unitCents),
      total: fromCents(lineCents),
      vatRate: product.vatRate,
      modifiers: chosenModifiers.length ? { create: chosenModifiers } : undefined,
    });
  }
  return { itemsData, subtotalCents, vatLines };
}
