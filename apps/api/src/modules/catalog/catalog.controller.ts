import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CatalogService } from './catalog.service';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';
import {
  CreateModifierDto,
  CreateModifierGroupDto,
  UpdateModifierDto,
  UpdateModifierGroupDto,
} from './dto/modifier.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantId } from '../../common/decorators/tenant-id.decorator';

@ApiTags('catalog')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(UserRole.OWNER, UserRole.STAFF)
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  // ----- Categorias -----
  @Get('categories')
  listCategories(@TenantId() tenantId: string) {
    return this.catalog.listCategories(tenantId);
  }

  @Post('categories')
  createCategory(@TenantId() tenantId: string, @Body() dto: CreateCategoryDto) {
    return this.catalog.createCategory(tenantId, dto);
  }

  @Patch('categories/:id')
  updateCategory(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.catalog.updateCategory(tenantId, id, dto);
  }

  @Delete('categories/:id')
  deleteCategory(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.catalog.deleteCategory(tenantId, id);
  }

  // ----- Produtos -----
  @Get('products')
  listProducts(@TenantId() tenantId: string, @Query('categoryId') categoryId?: string) {
    return this.catalog.listProducts(tenantId, categoryId);
  }

  @Get('products/:id')
  getProduct(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.catalog.getProduct(tenantId, id);
  }

  @Post('products')
  createProduct(@TenantId() tenantId: string, @Body() dto: CreateProductDto) {
    return this.catalog.createProduct(tenantId, dto);
  }

  @Patch('products/:id')
  updateProduct(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.catalog.updateProduct(tenantId, id, dto);
  }

  @Delete('products/:id')
  deleteProduct(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.catalog.deleteProduct(tenantId, id);
  }

  // ----- Grupos de modificadores -----
  @Post('products/:productId/modifier-groups')
  createModifierGroup(
    @TenantId() tenantId: string,
    @Param('productId') productId: string,
    @Body() dto: CreateModifierGroupDto,
  ) {
    return this.catalog.createModifierGroup(tenantId, productId, dto);
  }

  @Patch('modifier-groups/:id')
  updateModifierGroup(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateModifierGroupDto,
  ) {
    return this.catalog.updateModifierGroup(tenantId, id, dto);
  }

  @Delete('modifier-groups/:id')
  deleteModifierGroup(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.catalog.deleteModifierGroup(tenantId, id);
  }

  // ----- Modificadores (opções) -----
  @Post('modifier-groups/:groupId/modifiers')
  createModifier(
    @TenantId() tenantId: string,
    @Param('groupId') groupId: string,
    @Body() dto: CreateModifierDto,
  ) {
    return this.catalog.createModifier(tenantId, groupId, dto);
  }

  @Patch('modifiers/:id')
  updateModifier(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateModifierDto,
  ) {
    return this.catalog.updateModifier(tenantId, id, dto);
  }

  @Delete('modifiers/:id')
  deleteModifier(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.catalog.deleteModifier(tenantId, id);
  }
}
