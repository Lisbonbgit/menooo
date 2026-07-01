import { Body, Controller, Get, Param, Patch, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { TenantsService } from './tenants.service';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { SetOpeningHoursDto } from './dto/opening-hours.dto';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantId } from '../../common/decorators/tenant-id.decorator';

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
