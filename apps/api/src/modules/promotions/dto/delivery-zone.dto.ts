import { IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString, Matches, Min } from 'class-validator';

export class CreateDeliveryZoneDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @Matches(/^\d{1,7}$/, { message: 'prefixo postal: só dígitos (ex.: 1000)' })
  postalPrefix!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  fee!: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minOrder?: number;
}

export class UpdateDeliveryZoneDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{1,7}$/, { message: 'prefixo postal: só dígitos (ex.: 1000)' })
  postalPrefix?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  fee?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minOrder?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
