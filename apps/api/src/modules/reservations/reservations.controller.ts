import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { ReservationsService } from './reservations.service';
import { TurnstileService } from './turnstile.service';
import {
  CreateBlockDto,
  CreateManualReservationDto,
  CreateServiceDto,
  CreateTableDto,
  SetWindowsDto,
  UpdateReservationDto,
  UpdateReservationStatusDto,
  UpdateServiceDto,
  UpdateTableDto,
} from './dto/panel.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantId } from '../../common/decorators/tenant-id.decorator';

/** Painel de reservas (dono/staff) — mesas, reservas, janelas, bloqueios. KITCHEN fora de tudo. */
@ApiTags('reservations')
@Controller()
export class ReservationsController {
  constructor(
    private readonly reservations: ReservationsService,
    private readonly turnstile: TurnstileService,
  ) {}

  /**
   * Estado da proteção anti-bot, para o bloco de prontidão do painel.
   *
   * Vive aqui e não no /health de propósito: o /health é @Public() e dizer ao mundo
   * `enforced:false` (ou ver o `consecutiveFailures` a subir) é um oráculo em tempo real sobre
   * quando o endpoint que auto-confirma mesas está sem proteção — exatamente o sinal que diz a
   * um atacante quando atacar. O dono precisa dele; a internet não.
   */
  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  @Get('reservations/turnstile-status')
  turnstileStatus() {
    return this.turnstile.stats();
  }

  // ----- Mesas -----

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  @Get('tables')
  listTables(@TenantId() tenantId: string) {
    return this.reservations.listTables(tenantId);
  }

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  @Post('tables')
  createTable(@TenantId() tenantId: string, @Body() dto: CreateTableDto) {
    return this.reservations.createTable(tenantId, dto);
  }

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  @Patch('tables/:id')
  updateTable(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: UpdateTableDto) {
    return this.reservations.updateTable(tenantId, id, dto);
  }

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  @Delete('tables/:id')
  deleteTable(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.reservations.deleteTable(tenantId, id);
  }

  // ----- Reservas -----

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  @Get('reservations')
  listReservations(@TenantId() tenantId: string, @Query('date') date: string) {
    return this.reservations.listReservations(tenantId, date);
  }

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  @Post('reservations')
  createManual(@TenantId() tenantId: string, @Body() dto: CreateManualReservationDto) {
    return this.reservations.createManual(tenantId, dto);
  }

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  @Patch('reservations/:id')
  updateReservation(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateReservationDto,
  ) {
    return this.reservations.updateReservation(tenantId, id, dto);
  }

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  @Patch('reservations/:id/status')
  updateStatus(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateReservationStatusDto,
  ) {
    return this.reservations.updateStatus(tenantId, id, dto);
  }

  // ----- Janelas de reserva -----

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  @Get('reservation-windows')
  listWindows(@TenantId() tenantId: string) {
    return this.reservations.listWindows(tenantId);
  }

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  @Put('reservation-windows')
  setWindows(@TenantId() tenantId: string, @Body() dto: SetWindowsDto) {
    return this.reservations.setWindows(tenantId, dto);
  }

  // ----- Serviços de reserva -----
  // Todas com @Roles explícito: o RolesGuard falha ABERTO (`if (!required) return true`), logo
  // um método sem o decorador fica acessível a qualquer autenticado — o tablet da COZINHA incluído.

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  @Get('reservation-services')
  listServices(@TenantId() tenantId: string) {
    return this.reservations.listServices(tenantId);
  }

  /** Declarada ANTES de qualquer 'reservation-services/:id': senão o Nest resolve 'day' como :id. */
  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  @Get('reservation-services/day')
  listServicesForDay(@TenantId() tenantId: string, @Query('date') date: string) {
    return this.reservations.listServicesForDay(tenantId, date);
  }

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  @Post('reservation-services')
  createService(@TenantId() tenantId: string, @Body() dto: CreateServiceDto) {
    return this.reservations.createService(tenantId, dto);
  }

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  @Patch('reservation-services/:id')
  updateService(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: UpdateServiceDto) {
    return this.reservations.updateService(tenantId, id, dto);
  }

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  @Delete('reservation-services/:id')
  deleteService(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.reservations.deleteService(tenantId, id);
  }

  // ----- Bloqueios de dia -----

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  @Get('reservation-blocks')
  listBlocks(@TenantId() tenantId: string) {
    return this.reservations.listBlocks(tenantId);
  }

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  @Post('reservation-blocks')
  createBlock(@TenantId() tenantId: string, @Body() dto: CreateBlockDto) {
    return this.reservations.createBlock(tenantId, dto);
  }

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  @Delete('reservation-blocks/:id')
  deleteBlock(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.reservations.deleteBlock(tenantId, id);
  }
}
