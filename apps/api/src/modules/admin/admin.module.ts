import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { AdminBootstrapService } from './admin-bootstrap.service';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [BillingModule],
  controllers: [AdminController],
  providers: [AdminService, AdminBootstrapService],
})
export class AdminModule {}
