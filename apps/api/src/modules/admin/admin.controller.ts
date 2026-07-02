import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { AdminService } from './admin.service';
import { UpdateTenantStatusDto } from './dto/update-tenant-status.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('stats')
  stats() {
    return this.admin.stats();
  }

  @Get('tenants')
  listTenants() {
    return this.admin.listTenants();
  }

  @Get('tenants/:id')
  tenantDetail(@Param('id') id: string) {
    return this.admin.getTenantDetail(id);
  }

  @Patch('tenants/:id/status')
  setStatus(@Param('id') id: string, @Body() dto: UpdateTenantStatusDto) {
    return this.admin.setTenantStatus(id, dto.status);
  }

  @Post('tenants/:id/payments')
  recordPayment(@Param('id') id: string, @Body() dto: RecordPaymentDto) {
    return this.admin.recordPayment(id, dto);
  }
}
