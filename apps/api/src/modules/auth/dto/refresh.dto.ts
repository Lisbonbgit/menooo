import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class RefreshDto {
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;

  /** Unidade ativa a preservar na renovação (opcional). */
  @IsOptional()
  @IsString()
  tenantId?: string;
}

export class LogoutDto {
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}
