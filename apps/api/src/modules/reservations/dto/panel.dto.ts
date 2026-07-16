import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
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
  @IsInt() @Min(0) @Max(1440) closeMinute!: number;
}

/** Substitui a lista completa de janelas de reserva do tenant (máx. 2 por weekday). */
export class SetWindowsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReservationWindowDto)
  windows!: ReservationWindowDto[];
}

// ==========================================================================
// Bloqueios de dia
// ==========================================================================

export class CreateBlockDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
  @IsOptional() @IsString() @MaxLength(120) reason?: string;
}
