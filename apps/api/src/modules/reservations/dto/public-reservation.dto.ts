import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreatePublicReservationDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
  @Matches(/^\d{2}:\d{2}$/) time!: string;
  @IsInt() @Min(1) @Max(50) partySize!: number;
  @IsString() @IsNotEmpty() @MaxLength(120) customerName!: string;
  @IsString() @IsNotEmpty() @MaxLength(30) customerPhone!: string;
  @IsEmail() @MaxLength(200) customerEmail!: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @IsOptional() @IsBoolean() marketingConsent?: boolean;
}

export class CancelReservationDto {
  @IsString() @IsNotEmpty() @MaxLength(128) token!: string;
}
