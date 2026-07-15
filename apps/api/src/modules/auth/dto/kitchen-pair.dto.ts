import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class KitchenPairDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  code!: string;
}
