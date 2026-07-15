import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { OrdersService } from './orders.service';
import { UpdateStatusDto } from './dto/update-status.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantId } from '../../common/decorators/tenant-id.decorator';

@ApiTags('orders')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(UserRole.OWNER, UserRole.STAFF)
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  // KITCHEN (tablet de cozinha) só vê e avança pedidos. O @Roles no método
  // SOBREPÕE o da classe (getAllAndOverride) — /orders/summary fica de fora
  // de propósito (receita é só para OWNER/STAFF).
  @Roles(UserRole.OWNER, UserRole.STAFF, UserRole.KITCHEN)
  @Get()
  list(@TenantId() tenantId: string) {
    return this.orders.listForTenant(tenantId);
  }

  @Get('summary')
  summary(@TenantId() tenantId: string) {
    return this.orders.summaryForTenant(tenantId);
  }

  @Roles(UserRole.OWNER, UserRole.STAFF, UserRole.KITCHEN)
  @Get(':id')
  get(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.orders.getForTenant(tenantId, id);
  }

  @Roles(UserRole.OWNER, UserRole.STAFF, UserRole.KITCHEN)
  @Patch(':id/status')
  updateStatus(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateStatusDto,
  ) {
    return this.orders.updateStatus(tenantId, id, dto.status);
  }
}
