import { Module } from '@nestjs/common';
import { DineTablesService } from './dine-tables.service';
import { DineTablesController } from './dine-tables.controller';
import { PublicDineTableController } from './public-dine-table.controller';

// PrismaService vem do PrismaModule @Global — não precisa de import explícito aqui (mesmo padrão
// do CatalogModule, que também só depende do Prisma).
@Module({
  controllers: [DineTablesController, PublicDineTableController],
  providers: [DineTablesService],
  exports: [DineTablesService],
})
export class DineTablesModule {}
