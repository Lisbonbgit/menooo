import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

// ==========================================================================
// Mesas
// ==========================================================================

export class CreateTableDto {
  @IsString() @IsNotEmpty() @MaxLength(60) name!: string;
  @IsInt() @Min(1) @Max(50) seats!: number;
  @IsOptional() @IsString() @MaxLength(40) area?: string;
  @IsOptional() @IsBoolean() joinable?: boolean;
  @IsOptional() @IsBoolean() bookableOnline?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
}

export class UpdateTableDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(60) name?: string;
  @IsOptional() @IsInt() @Min(1) @Max(50) seats?: number;
  @IsOptional() @IsString() @MaxLength(40) area?: string;
  @IsOptional() @IsBoolean() joinable?: boolean;
  @IsOptional() @IsBoolean() bookableOnline?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
}

// ==========================================================================
// Mapa de sala — posições das mesas
// ==========================================================================

export class LayoutPositionDto {
  @IsString() @IsNotEmpty() id!: string;
  /** 8 colunas (0..7): a grelha é fixa para o `x` querer dizer o mesmo em todos os ecrãs — ver §6 do spec. */
  @IsInt() @Min(0) @Max(7) x!: number;
  @IsInt() @Min(0) @Max(49) y!: number;
}

export class SetLayoutDto {
  /** `null`/ausente = a área «Sem área» (o `Table.area` é anulável). */
  @IsOptional() @IsString() @MaxLength(60) area?: string | null;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LayoutPositionDto)
  positions!: LayoutPositionDto[];
}

// ==========================================================================
// Reservas (painel)
// ==========================================================================

export class CreateManualReservationDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
  @Matches(/^\d{2}:\d{2}$/) time!: string;
  @IsInt() @Min(1) @Max(100) partySize!: number;
  @IsOptional() @IsInt() @Min(30) @Max(480) durationMin?: number;
  @IsString() @IsNotEmpty() @MaxLength(120) customerName!: string;
  @IsOptional() @IsString() @MaxLength(30) customerPhone?: string;
  @IsOptional() @IsEmail() @MaxLength(200) customerEmail?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) @ArrayMaxSize(2) tableIds?: string[];
}

export class UpdateReservationDto {
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) date?: string;
  @IsOptional() @Matches(/^\d{2}:\d{2}$/) time?: string;
  @IsOptional() @IsInt() @Min(1) @Max(100) partySize?: number;
  @IsOptional() @IsInt() @Min(30) @Max(480) durationMin?: number;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) customerName?: string;
  @IsOptional() @IsString() @MaxLength(30) customerPhone?: string;
  @IsOptional() @IsEmail() @MaxLength(200) customerEmail?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) @ArrayMaxSize(2) tableIds?: string[];
}

export class UpdateReservationStatusDto {
  @IsIn(['COMPLETED', 'NO_SHOW', 'CANCELLED'])
  status!: 'COMPLETED' | 'NO_SHOW' | 'CANCELLED';
}

// ==========================================================================
// Janelas de reserva
// ==========================================================================

export class ReservationWindowDto {
  @IsInt() @Min(0) @Max(6) weekday!: number;
  @IsInt() @Min(0) @Max(1440) openMinute!: number;
  @IsInt() @Min(0) @Max(1380) closeMinute!: number;
}

/** Substitui a lista completa de janelas de reserva do tenant (máx. 2 por weekday). */
export class SetWindowsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReservationWindowDto)
  windows!: ReservationWindowDto[];
}

// ==========================================================================
// Serviços de reserva (Almoço/Jantar) — substituem as janelas (expand: as duas coexistem)
// ==========================================================================

export class CreateServiceDto {
  @IsString() @IsNotEmpty() @MaxLength(60) name!: string;
  /** 0=domingo … 6=sábado (convenção do OpeningHour). */
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  weekdays!: number[];
  @IsInt() @Min(0) @Max(1440) openMinute!: number;
  /** Teto das 23:00: o último slot COMEÇA aqui (janela de seating, não de estadia). */
  @IsInt() @Min(0) @Max(1380) closeMinute!: number;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}

export class UpdateServiceDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(60) name?: string;
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  weekdays?: number[];
  @IsOptional() @IsInt() @Min(0) @Max(1440) openMinute?: number;
  @IsOptional() @IsInt() @Min(0) @Max(1380) closeMinute?: number;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}

// ==========================================================================
// Bloqueios de dia
// ==========================================================================

export class CreateBlockDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
  @IsOptional() @IsString() @MaxLength(120) reason?: string;
}
