import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { OrdersService } from './orders.service';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('public')
@Controller('public/orders')
export class PublicOrderTrackController {
  constructor(private readonly orders: OrdersService) {}

  /** Estado ao vivo de um pedido, por token privado. A página faz sondagem, daí o throttle generoso. */
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get(':token')
  track(@Param('token') token: string) {
    return this.orders.getPublicTracking(token);
  }
}
