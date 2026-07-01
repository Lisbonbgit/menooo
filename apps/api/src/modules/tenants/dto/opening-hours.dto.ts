import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, Max, Min, ValidateNested } from 'class-validator';

export class OpeningHourDto {
  @IsInt()
  @Min(0)
  @Max(6)
  weekday!: number; // 0=Domingo … 6=Sábado

  @IsInt()
  @Min(0)
  @Max(1439)
  openMinute!: number;

  @IsInt()
  @Min(1)
  @Max(1440)
  closeMinute!: number;
}

/** Substitui o horário completo da semana (apenas os dias com faixa definida). */
export class SetOpeningHoursDto {
  @IsArray()
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => OpeningHourDto)
  hours!: OpeningHourDto[];
}
