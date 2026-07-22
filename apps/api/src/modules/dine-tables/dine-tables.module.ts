import { Module } from '@nestjs/common';
import { DineTablesService } from './dine-tables.service';
import { DineTablesController } from './dine-tables.controller';
import { PublicDineTableController } from './public-dine-table.controller';
import { PublicDineOrderController } from './public-dine-order.controller';
import { OrdersModule } from '../orders/orders.module';

// PrismaService vem do PrismaModule @Global — não precisa de import explícito aqui (mesmo padrão
// do CatalogModule, que também só depende do Prisma).
// OrdersModule: importado para injetar o OrdersGateway (createDineInOrder emite 'order.created'
// para o painel em tempo real) — mesmo padrão do ReservationsModule/TenantsModule, que também só
// precisam do gateway exportado, sem depender do resto do OrdersService.
@Module({
  imports: [OrdersModule],
  controllers: [DineTablesController, PublicDineTableController, PublicDineOrderController],
  providers: [DineTablesService],
  exports: [DineTablesService],
})
export class DineTablesModule {}
