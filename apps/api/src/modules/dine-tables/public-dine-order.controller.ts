import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { DineTablesService } from './dine-tables.service';
import { CreateDineOrderDto } from './dto/dine-order.dto';
import { Public } from '../../common/decorators/public.decorator';

/** Pedido feito à mesa via QR — sem autenticação. Isolamento de QR + de menu no serviço. */
@ApiTags('public')
@Controller('public/stores')
export class PublicDineOrderController {
  constructor(private readonly tables: DineTablesService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':slug/mesa/:qrToken/orders')
  create(@Param('slug') slug: string, @Param('qrToken') qrToken: string, @Body() dto: CreateDineOrderDto) {
    return this.tables.createDineInOrder(slug, qrToken, dto);
  }
}
