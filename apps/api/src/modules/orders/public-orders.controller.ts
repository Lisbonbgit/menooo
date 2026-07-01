import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { OrdersService } from './orders.service';
import { CreatePublicOrderDto } from './dto/create-order.dto';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('public')
@Controller('public/stores')
export class PublicOrdersController {
  constructor(private readonly orders: OrdersService) {}

  /** Criar encomenda a partir da loja pública (checkout do cliente). */
  @Public()
  @Post(':slug/orders')
  create(@Param('slug') slug: string, @Body() dto: CreatePublicOrderDto) {
    return this.orders.createPublicOrder(slug, dto);
  }
}
