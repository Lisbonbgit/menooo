import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MenuType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isSubscriptionUsable } from '../tenants/subscription.util';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';
import {
  CreateModifierDto,
  CreateModifierGroupDto,
  UpdateModifierDto,
  UpdateModifierGroupDto,
} from './dto/modifier.dto';

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  // ==========================================================================
  // Categorias
  // ==========================================================================

  async listCategories(tenantId: string, menuType: MenuType) {
    const menuId = await this.resolveMenuId(tenantId, menuType);
    return this.prisma.category.findMany({
      where: { tenantId, menuId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async createCategory(tenantId: string, menuType: MenuType, dto: CreateCategoryDto) {
    const menuId = await this.resolveMenuId(tenantId, menuType);
    return this.prisma.category.create({
      data: { tenantId, menuId, name: dto.name, sortOrder: dto.sortOrder ?? 0 },
    });
  }

  async updateCategory(tenantId: string, id: string, dto: UpdateCategoryDto) {
    await this.ensureCategory(tenantId, id);
    return this.prisma.category.update({ where: { id }, data: dto });
  }

  async deleteCategory(tenantId: string, id: string) {
    await this.ensureCategory(tenantId, id);
    await this.prisma.category.delete({ where: { id } });
    return { deleted: true };
  }

  /**
   * Reordena TODAS as categorias do tenant em lote (transação). Espelha o `setLayout` da R4:
   * count + updates DENTRO da mesma transação, `updateMany({ id, tenantId })` como barreira de
   * tenant (não há unique composto), e exige a lista COMPLETA — um subconjunto deixaria as
   * omitidas com o sortOrder antigo, a colidir com os índices 0..n-1 → ordem baralhada, sem erro.
   */
  async reorderCategories(tenantId: string, menuType: MenuType, ids: string[]) {
    if (new Set(ids).size !== ids.length) throw new BadRequestException('IDs repetidos.');
    const menuId = await this.resolveMenuId(tenantId, menuType);
    return this.prisma.$transaction(async (tx) => {
      const total = await tx.category.count({ where: { tenantId, menuId } });
      const owned = await tx.category.count({ where: { id: { in: ids }, tenantId, menuId } });
      if (owned !== ids.length || owned !== total) {
        throw new BadRequestException('A lista tem de conter todas as categorias do menu, sem repetidos.');
      }
      for (const [i, id] of ids.entries()) {
        await tx.category.updateMany({ where: { id, tenantId, menuId }, data: { sortOrder: i } });
      }
      return { reordered: ids.length };
    });
  }

  // ==========================================================================
  // Produtos
  // ==========================================================================

  listProducts(tenantId: string, menuType: MenuType, categoryId?: string) {
    return this.prisma.product.findMany({
      where: {
        tenantId,
        category: { menu: { tenantId, type: menuType } },
        ...(categoryId ? { categoryId } : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  /** include partilhado: grupos do produto via junção, já ordenados. */
  private static readonly GROUP_LINKS_INCLUDE = {
    modifierGroupLinks: {
      // desempate por id: sortOrder pode empatar (anexações concorrentes)
      orderBy: [{ sortOrder: 'asc' as const }, { id: 'asc' as const }],
      include: {
        group: { include: { modifiers: { orderBy: { sortOrder: 'asc' as const } } } },
      },
    },
  };

  /** achata a junção para o formato público `modifierGroups` (storefront/checkout). */
  private static flattenGroups<
    T extends { modifierGroupLinks: { group: unknown }[] },
  >(product: T) {
    const { modifierGroupLinks, ...rest } = product;
    return { ...rest, modifierGroups: modifierGroupLinks.map((l) => l.group) };
  }

  async getProduct(tenantId: string, id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, tenantId },
      include: CatalogService.GROUP_LINKS_INCLUDE,
    });
    if (!product) throw new NotFoundException('Produto não encontrado.');
    return CatalogService.flattenGroups(product);
  }

  async createProduct(tenantId: string, dto: CreateProductDto) {
    await this.ensureCategory(tenantId, dto.categoryId);
    return this.prisma.product.create({
      data: {
        tenantId,
        categoryId: dto.categoryId,
        name: dto.name,
        description: dto.description,
        price: dto.price,
        vatRate: dto.vatRate ?? 23,
        imageUrl: dto.imageUrl,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async updateProduct(tenantId: string, id: string, dto: UpdateProductDto) {
    const current = await this.ensureProduct(tenantId, id);
    const data: Prisma.ProductUncheckedUpdateInput = { ...dto };
    if (dto.categoryId && dto.categoryId !== current.categoryId) {
      const [newCat, curCat] = await Promise.all([
        this.ensureCategory(tenantId, dto.categoryId),
        this.prisma.category.findUnique({ where: { id: current.categoryId } }),
      ]);
      if (newCat.menuId !== curCat?.menuId) {
        throw new BadRequestException('Não podes mover um produto para uma categoria de outro menu.');
      }
      const last = await this.prisma.product.aggregate({
        where: { tenantId, categoryId: dto.categoryId },
        _max: { sortOrder: true },
      });
      data.sortOrder = (last._max.sortOrder ?? -1) + 1;
    } else if (dto.categoryId) {
      await this.ensureCategory(tenantId, dto.categoryId);
    }
    return this.prisma.product.update({ where: { id }, data });
  }

  /**
   * Reordena TODOS os produtos de UMA categoria em lote (transação). Igual ao reorderCategories,
   * mas o total/owned filtram por categoryId: impede reordenar para uma categoria de outro tenant,
   * misturar ids de categorias diferentes, ou deixar produtos de fora.
   */
  async reorderProducts(tenantId: string, categoryId: string, ids: string[]) {
    if (new Set(ids).size !== ids.length) throw new BadRequestException('IDs repetidos.');
    return this.prisma.$transaction(async (tx) => {
      const total = await tx.product.count({ where: { tenantId, categoryId } });
      const owned = await tx.product.count({ where: { id: { in: ids }, tenantId, categoryId } });
      if (owned !== ids.length || owned !== total) {
        throw new BadRequestException(
          'A lista tem de conter todos os produtos da categoria, sem repetidos.',
        );
      }
      for (const [i, id] of ids.entries()) {
        await tx.product.updateMany({
          where: { id, tenantId, categoryId },
          data: { sortOrder: i },
        });
      }
      return { reordered: ids.length };
    });
  }

  async deleteProduct(tenantId: string, id: string) {
    await this.ensureProduct(tenantId, id);
    await this.prisma.product.delete({ where: { id } });
    return { deleted: true };
  }

  // ==========================================================================
  // Grupos de modificadores (biblioteca do restaurante)
  // ==========================================================================

  async listModifierGroups(tenantId: string, menuType: MenuType) {
    const menuId = await this.resolveMenuId(tenantId, menuType);
    const groups = await this.prisma.modifierGroup.findMany({
      where: { tenantId, menuId },
      orderBy: { name: 'asc' },
      include: {
        modifiers: { orderBy: { sortOrder: 'asc' } },
        _count: { select: { productLinks: true } },
      },
    });
    return groups.map(({ _count, ...g }) => ({ ...g, usedIn: _count.productLinks }));
  }

  /** um grupo incoerente (min > max, max 0) bloquearia o carrinho em todos
   *  os produtos anexados — validar sempre os valores efetivos. */
  private assertGroupLimits(minSelect: number, maxSelect: number) {
    if (maxSelect < 1) {
      throw new BadRequestException('O máximo de escolhas tem de ser pelo menos 1.');
    }
    if (minSelect > maxSelect) {
      throw new BadRequestException('O mínimo de escolhas não pode exceder o máximo.');
    }
  }

  async createModifierGroup(tenantId: string, menuType: MenuType, dto: CreateModifierGroupDto) {
    const minSelect = dto.minSelect ?? 0;
    const maxSelect = dto.maxSelect ?? 1;
    this.assertGroupLimits(minSelect, maxSelect);
    const menuId = await this.resolveMenuId(tenantId, menuType);
    return this.prisma.modifierGroup.create({
      data: { tenantId, menuId, name: dto.name, required: dto.required ?? false, minSelect, maxSelect },
    });
  }

  async updateModifierGroup(tenantId: string, id: string, dto: UpdateModifierGroupDto) {
    const current = await this.ensureModifierGroup(tenantId, id);
    this.assertGroupLimits(dto.minSelect ?? current.minSelect, dto.maxSelect ?? current.maxSelect);
    return this.prisma.modifierGroup.update({ where: { id }, data: dto });
  }

  async deleteModifierGroup(tenantId: string, id: string) {
    await this.ensureModifierGroup(tenantId, id);
    await this.prisma.modifierGroup.delete({ where: { id } });
    return { deleted: true };
  }

  /** anexa um grupo da biblioteca a um produto (no fim da lista). */
  async attachModifierGroup(tenantId: string, productId: string, groupId: string) {
    await this.ensureProduct(tenantId, productId);
    const group = await this.ensureModifierGroup(tenantId, groupId);
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: { category: true },
    });
    if (product!.category.menuId !== group.menuId) {
      throw new BadRequestException('Esse grupo de opções é de outro menu.');
    }
    const last = await this.prisma.productModifierGroup.aggregate({
      where: { productId },
      _max: { sortOrder: true },
    });
    try {
      return await this.prisma.productModifierGroup.create({
        data: { productId, groupId, sortOrder: (last._max.sortOrder ?? -1) + 1 },
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        throw new ConflictException('Este grupo já está anexado ao produto.');
      }
      throw e;
    }
  }

  /** desanexa sem apagar o grupo da biblioteca. */
  async detachModifierGroup(tenantId: string, productId: string, groupId: string) {
    await this.ensureProduct(tenantId, productId);
    const { count } = await this.prisma.productModifierGroup.deleteMany({
      where: { productId, groupId },
    });
    if (count === 0) throw new NotFoundException('Grupo não está anexado a este produto.');
    return { detached: true };
  }

  // ==========================================================================
  // Modificadores (opções)
  // ==========================================================================

  async createModifier(tenantId: string, groupId: string, dto: CreateModifierDto) {
    await this.ensureModifierGroup(tenantId, groupId);
    return this.prisma.modifier.create({
      data: {
        groupId,
        name: dto.name,
        priceDelta: dto.priceDelta ?? 0,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async updateModifier(tenantId: string, id: string, dto: UpdateModifierDto) {
    await this.ensureModifier(tenantId, id);
    return this.prisma.modifier.update({ where: { id }, data: dto });
  }

  async deleteModifier(tenantId: string, id: string) {
    await this.ensureModifier(tenantId, id);
    await this.prisma.modifier.delete({ where: { id } });
    return { deleted: true };
  }

  // ==========================================================================
  // Menu público (storefront)
  // ==========================================================================

  async getPublicMenu(slug: string, menuType: MenuType) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      include: { account: true },
    });
    if (!tenant || tenant.status !== 'ACTIVE' || !isSubscriptionUsable(tenant.account)) {
      throw new NotFoundException('Loja não encontrada.');
    }
    const menu = await this.prisma.menu.findUnique({
      where: { tenantId_type: { tenantId: tenant.id, type: menuType } },
    });
    if (!menu) return []; // loja nova sem este menu ainda → vazio
    const categories = await this.prisma.category.findMany({
      where: { tenantId: tenant.id, menuId: menu.id, active: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        products: {
          where: { active: true },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          include: CatalogService.GROUP_LINKS_INCLUDE,
        },
      },
    });
    return categories.map((cat) => ({
      ...cat,
      products: cat.products.map((p) => CatalogService.flattenGroups(p)),
    }));
  }

  // ==========================================================================
  // Verificações de propriedade (multi-tenant)
  // ==========================================================================

  /** Resolve (e cria se faltar) o menu da loja para um tipo. Idempotente pelo unique (tenantId,type). */
  private async resolveMenuId(tenantId: string, type: MenuType): Promise<string> {
    const menu = await this.prisma.menu.upsert({
      where: { tenantId_type: { tenantId, type } },
      create: { tenantId, type },
      update: {},
    });
    return menu.id;
  }

  private async ensureCategory(tenantId: string, id: string) {
    const found = await this.prisma.category.findFirst({ where: { id, tenantId } });
    if (!found) throw new NotFoundException('Categoria não encontrada.');
    return found;
  }

  private async ensureProduct(tenantId: string, id: string) {
    const found = await this.prisma.product.findFirst({ where: { id, tenantId } });
    if (!found) throw new NotFoundException('Produto não encontrado.');
    return found;
  }

  private async ensureModifierGroup(tenantId: string, id: string) {
    const found = await this.prisma.modifierGroup.findFirst({
      where: { id, tenantId },
    });
    if (!found) throw new NotFoundException('Grupo de opções não encontrado.');
    return found;
  }

  private async ensureModifier(tenantId: string, id: string) {
    const found = await this.prisma.modifier.findFirst({
      where: { id, group: { tenantId } },
    });
    if (!found) throw new NotFoundException('Opção não encontrada.');
    return found;
  }
}
