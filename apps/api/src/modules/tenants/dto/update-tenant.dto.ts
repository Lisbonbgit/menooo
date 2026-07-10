import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';

/** Campos que o dono do restaurante pode editar nas definições da loja. */
export class UpdateTenantDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  // Identidade visual — URL devolvido por POST /uploads (string vazia = remover).
  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @IsString()
  coverUrl?: string;

  // Cores da montra (hex #rrggbb; string vazia = repor o tema Menooo)
  @IsOptional()
  @Matches(/^(#[0-9a-fA-F]{6})?$/, { message: 'cor inválida: usar formato #rrggbb' })
  brandColor?: string;

  @IsOptional()
  @Matches(/^(#[0-9a-fA-F]{6})?$/, { message: 'cor inválida: usar formato #rrggbb' })
  heroColor?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  zipCode?: string;

  @IsOptional()
  @IsBoolean()
  acceptsDelivery?: boolean;

  @IsOptional()
  @IsBoolean()
  acceptsPickup?: boolean;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  deliveryFee?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minOrderValue?: number;

  @IsOptional()
  @IsBoolean()
  isOpen?: boolean;
}
