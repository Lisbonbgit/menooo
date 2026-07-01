import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { PromotionsService } from './promotions.service';
import { CreateDeliveryZoneDto, UpdateDeliveryZoneDto } from './dto/delivery-zone.dto';
import { CreateCouponDto, UpdateCouponDto } from './dto/coupon.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantId } from '../../common/decorators/tenant-id.decorator';

@ApiTags('promotions')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(UserRole.OWNER)
@Controller()
export class PromotionsController {
  constructor(private readonly promotions: PromotionsService) {}

  // ----- Zonas de entrega -----
  @Get('delivery-zones')
  listZones(@TenantId() tenantId: string) {
    return this.promotions.listZones(tenantId);
  }

  @Post('delivery-zones')
  createZone(@TenantId() tenantId: string, @Body() dto: CreateDeliveryZoneDto) {
    return this.promotions.createZone(tenantId, dto);
  }

  @Patch('delivery-zones/:id')
  updateZone(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateDeliveryZoneDto,
  ) {
    return this.promotions.updateZone(tenantId, id, dto);
  }

  @Delete('delivery-zones/:id')
  deleteZone(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.promotions.deleteZone(tenantId, id);
  }

  // ----- Cupões -----
  @Get('coupons')
  listCoupons(@TenantId() tenantId: string) {
    return this.promotions.listCoupons(tenantId);
  }

  @Post('coupons')
  createCoupon(@TenantId() tenantId: string, @Body() dto: CreateCouponDto) {
    return this.promotions.createCoupon(tenantId, dto);
  }

  @Patch('coupons/:id')
  updateCoupon(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCouponDto,
  ) {
    return this.promotions.updateCoupon(tenantId, id, dto);
  }

  @Delete('coupons/:id')
  deleteCoupon(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.promotions.deleteCoupon(tenantId, id);
  }
}
