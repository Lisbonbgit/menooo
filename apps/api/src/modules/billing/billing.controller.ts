import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Post,
  RawBodyRequest,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Request } from 'express';
import { BillingService } from './billing.service';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AccountId } from '../../common/decorators/account-id.decorator';

@ApiTags('billing')
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  /** A UI usa isto para saber se mostra o botão de pagamento automático. */
  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  @Get('config')
  config() {
    return this.billing.config();
  }

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER)
  @Post('checkout')
  checkout(@AccountId() accountId: string) {
    return this.billing.createCheckout(accountId);
  }

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER)
  @Post('portal')
  portal(@AccountId() accountId: string) {
    return this.billing.createPortal(accountId);
  }

  /** Chamado pelo Stripe (assinado) — nunca pelo browser. */
  @Public()
  @Post('webhook')
  webhook(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') sig?: string) {
    if (!sig || !req.rawBody) {
      throw new BadRequestException('Pedido de webhook inválido.');
    }
    return this.billing.handleWebhook(req.rawBody, sig);
  }
}
