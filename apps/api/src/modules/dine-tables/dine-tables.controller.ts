import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { DineTablesService } from './dine-tables.service';
import { BulkDineTableDto, CreateDineTableDto, UpdateDineTableDto } from './dto/dine-table.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantId } from '../../common/decorators/tenant-id.decorator';

/** Painel de mesas de sala (dine-in QR) — dono/staff. Separado das mesas de reservas (Table). */
@ApiTags('dine-tables')
@Controller('dine-tables')
export class DineTablesController {
  constructor(private readonly tables: DineTablesService) {}

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  @Get()
  list(@TenantId() tenantId: string) {
    return this.tables.list(tenantId);
  }

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  @Post()
  create(@TenantId() tenantId: string, @Body() dto: CreateDineTableDto) {
    return this.tables.create(tenantId, dto);
  }

  /** Declarada ANTES de ':id': senão o Nest resolve 'bulk' como se fosse um id de mesa. */
  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  @Post('bulk')
  bulk(@TenantId() tenantId: string, @Body() dto: BulkDineTableDto) {
    return this.tables.bulk(tenantId, dto);
  }

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  @Patch(':id')
  update(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: UpdateDineTableDto) {
    return this.tables.update(tenantId, id, dto);
  }

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  @Delete(':id')
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.tables.remove(tenantId, id);
  }

  /**
   * Contas (sessões) abertas das mesas de sala. `?status=open` é o único suportado por agora
   * (histórico de sessões fechadas fica para outra fase). Declarado depois de ':id' acima não
   * conflita: são 3 segmentos ('table-sessions/:id/close') vs. 1 (':id'), o router do Nest
   * discrimina por forma do path, não por ordem de declaração.
   */
  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  @Get('table-sessions')
  listOpenSessions(@TenantId() tenantId: string, @Query('status') _status?: string) {
    return this.tables.listOpenSessions(tenantId);
  }

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  @Patch('table-sessions/:id/close')
  closeSession(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.tables.closeSession(tenantId, id);
  }
}
