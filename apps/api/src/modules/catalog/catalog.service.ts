import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
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

  async getProduct(tenantId: string, id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, tenantId },
      include: {
        modifierGroups: {
          orderBy: { sortOrder: 'asc' },
          include: { modifiers: { orderBy: { sortOrder: 'asc' } } },
        },
      },
    });
    if (!product) throw new NotFoundException('Produto não encontrado.');
    return product;
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
  // Grupos de modificadores
  // ==========================================================================

  async createModifierGroup(tenantId: string, productId: string, dto: CreateModifierGroupDto) {
    await this.ensureProduct(tenantId, productId);
    return this.prisma.modifierGroup.create({
      data: {
        productId,
        name: dto.name,
        required: dto.required ?? false,
        minSelect: dto.minSelect ?? 0,
        maxSelect: dto.maxSelect ?? 1,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async updateModifierGroup(tenantId: string, id: string, dto: UpdateModifierGroupDto) {
    await this.ensureModifierGroup(tenantId, id);
    return this.prisma.modifierGroup.update({ where: { id }, data: dto });
  }

  async deleteModifierGroup(tenantId: string, id: string) {
    await this.ensureModifierGroup(tenantId, id);
    await this.prisma.modifierGroup.delete({ where: { id } });
    return { deleted: true };
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
    const tenant = await this.prisma.tenant.findUnique({ where: { slug } });
    if (!tenant || tenant.status !== 'ACTIVE') {
      throw new NotFoundException('Loja não encontrada.');
    }
    return this.prisma.category.findMany({
      where: { tenantId: tenant.id, active: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        products: {
          where: { active: true },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          include: {
            modifierGroups: {
              orderBy: { sortOrder: 'asc' },
              include: { modifiers: { orderBy: { sortOrder: 'asc' } } },
            },
          },
        },
      },
    });
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
      where: { id, product: { tenantId } },
    });
    if (!found) throw new NotFoundException('Grupo de opções não encontrado.');
    return found;
  }

  private async ensureModifier(tenantId: string, id: string) {
    const found = await this.prisma.modifier.findFirst({
      where: { id, group: { product: { tenantId } } },
    });
    if (!found) throw new NotFoundException('Opção não encontrada.');
    return found;
  }
}
