import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CatalogService } from './catalog.service';
import { Public } from '../../common/decorators/public.decorator';
import { parseMenuType } from './menu-type.util';

@ApiTags('public')
@Controller('public/stores')
export class PublicCatalogController {
  constructor(private readonly catalog: CatalogService) {}

  /** Menu completo da loja. Sem `type` → Delivery (retrocompatível com o storefront). */
  @Public()
  @Get(':slug/menu')
  getMenu(@Param('slug') slug: string, @Query('type') type?: string) {
    return this.catalog.getPublicMenu(slug, parseMenuType(type));
  }
}
