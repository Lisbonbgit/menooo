import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateDineTableDto {
  @IsString() @MaxLength(40) name!: string;
}
export class BulkDineTableDto {
  @IsInt() @Min(1) @Max(100) count!: number;
  @IsOptional() @IsString() @MaxLength(20) prefix?: string; // default "Mesa"
}
export class UpdateDineTableDto {
  @IsOptional() @IsString() @MaxLength(40) name?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}
