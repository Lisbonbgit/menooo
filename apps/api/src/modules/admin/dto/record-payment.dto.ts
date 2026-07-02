import { IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class RecordPaymentDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount!: number;

  @IsInt()
  @Min(1)
  @Max(24)
  months!: number;

  @IsOptional()
  @IsString()
  note?: string;
}
