import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CatalogService } from './catalog.service';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('public')
@Controller('public/stores')
export class PublicCatalogController {
  constructor(private readonly catalog: CatalogService) {}

  /** Menu completo da loja (categorias ativas → produtos ativos → opções). */
  @Public()
  @Get(':slug/menu')
  getMenu(@Param('slug') slug: string) {
    return this.catalog.getPublicMenu(slug);
  }
}
