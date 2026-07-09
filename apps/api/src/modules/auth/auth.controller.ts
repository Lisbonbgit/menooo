import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterRestaurantDto } from './dto/register-restaurant.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendCodeDto } from './dto/resend-code.dto';
import { SwitchTenantDto } from './dto/switch-tenant.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/authenticated-user';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  register(@Body() dto: RegisterRestaurantDto) {
    return this.auth.registerRestaurant(dto);
  }

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  /** Confirma o código de 6 dígitos enviado por email e inicia sessão. */
  @Public()
  @Post('verify-email')
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.auth.verifyEmail(dto.email, dto.code);
  }

  /** Reenvia um novo código de verificação para o email. */
  @Public()
  @Post('resend-code')
  resendCode(@Body() dto: ResendCodeDto) {
    return this.auth.resendCode(dto.email);
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }

  /** Troca a unidade ativa da sessão (devolve novo token). */
  @ApiBearerAuth()
  @Post('switch')
  switchTenant(@CurrentUser() user: AuthenticatedUser, @Body() dto: SwitchTenantDto) {
    return this.auth.switchTenant(user, dto.tenantId);
  }
}
