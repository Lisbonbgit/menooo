import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { AdminService } from './admin.service';
import { MailService } from '../mail/mail.service';
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
  constructor(
    private readonly admin: AdminService,
    private readonly mail: MailService,
  ) {}

  /** Envia um email de teste (todos os moldes) para confirmar a configuração. */
  @Post('mail-test')
  async mailTest(@Query('to') to: string) {
    if (!this.mail.isEnabled()) return { enabled: false };
    const d = new Date(Date.now() + 7 * 86_400_000);
    await this.mail.sendWelcome(to, 'Matheus', 'Restaurante de Teste');
    await this.mail.sendActivated(to, 'Restaurante de Teste', 'pizzaria-demo', d);
    await this.mail.sendTrialEnding(to, 'Restaurante de Teste', 2, d);
    await this.mail.sendSubscriptionActive(to, 'Restaurante de Teste', d);
    await this.mail.sendSubscriptionCancelled(to, 'Restaurante de Teste', d);
    return { enabled: true, sent: 5, to };
  }

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
