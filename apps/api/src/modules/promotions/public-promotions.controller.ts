import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PromotionsService } from './promotions.service';
import { Public } from '../../common/decorators/public.decorator';
import { ValidateCouponDto } from './dto/validate-coupon.dto';

@ApiTags('public')
@Controller('public/stores')
export class PublicPromotionsController {
  constructor(private readonly promotions: PromotionsService) {}

  @Public()
  @Get(':slug/delivery-quote')
  quote(@Param('slug') slug: string, @Query('zip') zip = '') {
    return this.promotions.publicDeliveryQuote(slug, zip);
  }

  @Public()
  @Post(':slug/validate-coupon')
  validateCoupon(@Param('slug') slug: string, @Body() dto: ValidateCouponDto) {
    return this.promotions.publicValidateCoupon(slug, dto.code, dto.subtotal);
  }
}
