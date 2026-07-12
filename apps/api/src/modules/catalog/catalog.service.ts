import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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

  listCategories(tenantId: string) {
    return this.prisma.category.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  createCategory(tenantId: string, dto: CreateCategoryDto) {
    return this.prisma.category.create({
      data: { tenantId, name: dto.name, sortOrder: dto.sortOrder ?? 0 },
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

  // ==========================================================================
  // Produtos
  // ==========================================================================

  listProducts(tenantId: string, categoryId?: string) {
    return this.prisma.product.findMany({
      where: { tenantId, ...(categoryId ? { categoryId } : {}) },
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
    await this.ensureProduct(tenantId, id);
    if (dto.categoryId) await this.ensureCategory(tenantId, dto.categoryId);
    return this.prisma.product.update({ where: { id }, data: dto });
  }

  async deleteProduct(tenantId: string, id: string) {
    await this.ensureProduct(tenantId, id);
    await this.prisma.product.delete({ where: { id } });
    return { deleted: true };
  }

  // ==========================================================================
  // Grupos de modificadores (biblioteca do restaurante)
  // ==========================================================================

  async listModifierGroups(tenantId: string) {
    const groups = await this.prisma.modifierGroup.findMany({
      where: { tenantId },
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

  createModifierGroup(tenantId: string, dto: CreateModifierGroupDto) {
    const minSelect = dto.minSelect ?? 0;
    const maxSelect = dto.maxSelect ?? 1;
    this.assertGroupLimits(minSelect, maxSelect);
    return this.prisma.modifierGroup.create({
      data: {
        tenantId,
        name: dto.name,
        required: dto.required ?? false,
        minSelect,
        maxSelect,
      },
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
    await this.ensureModifierGroup(tenantId, groupId);
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

  async getPublicMenu(slug: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      include: { account: true },
    });
    if (!tenant || tenant.status !== 'ACTIVE' || !isSubscriptionUsable(tenant.account)) {
      throw new NotFoundException('Loja não encontrada.');
    }
    const categories = await this.prisma.category.findMany({
      where: { tenantId: tenant.id, active: true },
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
