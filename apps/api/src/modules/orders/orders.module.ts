import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { PublicOrdersController } from './public-orders.controller';
import { PublicOrderTrackController } from './public-order-track.controller';
import { OrdersGateway } from './orders.gateway';
import { PromotionsModule } from '../promotions/promotions.module';

@Module({
  imports: [JwtModule.register({}), PromotionsModule],
  controllers: [OrdersController, PublicOrdersController, PublicOrderTrackController],
  providers: [OrdersService, OrdersGateway],
  exports: [OrdersService, OrdersGateway],
})
export class OrdersModule {}
