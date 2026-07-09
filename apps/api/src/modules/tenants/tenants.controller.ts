import { Body, Controller, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { TenantsService } from './tenants.service';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { SetOpeningHoursDto } from './dto/opening-hours.dto';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { AccountId } from '../../common/decorators/account-id.decorator';

@ApiTags('tenants')
@Controller()
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  /** Loja pública — usada pelo storefront. */
  @Public()
  @Get('public/stores/:slug')
  getStore(@Param('slug') slug: string) {
    return this.tenants.getPublicBySlug(slug);
  }

  // ----- Restaurante autenticado (dashboard) -----

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  @Get('tenants/me')
  getMine(@TenantId() tenantId: string) {
    return this.tenants.getMine(tenantId);
  }

  /** Unidades da conta do dono (para o seletor de loja). */
  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  @Get('tenants/mine')
  listMine(@AccountId() accountId: string) {
    return this.tenants.listMine(accountId);
  }

  /** Cria uma nova unidade na conta (fica PENDING até o admin ativar). */
  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER)
  @Post('tenants')
  create(@AccountId() accountId: string, @Body() dto: CreateTenantDto) {
    return this.tenants.createTenant(accountId, dto);
  }

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER)
  @Patch('tenants/me')
  updateMine(@TenantId() tenantId: string, @Body() dto: UpdateTenantDto) {
    return this.tenants.updateMine(tenantId, dto);
  }

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  @Get('tenants/me/hours')
  getHours(@TenantId() tenantId: string) {
    return this.tenants.getMyHours(tenantId);
  }

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER)
  @Put('tenants/me/hours')
  setHours(@TenantId() tenantId: string, @Body() dto: SetOpeningHoursDto) {
    return this.tenants.setMyHours(tenantId, dto.hours);
  }
}
