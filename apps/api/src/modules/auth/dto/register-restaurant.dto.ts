import { IsEmail, IsNotEmpty, IsString, Matches, MinLength } from 'class-validator';

/** Auto-registo de um restaurante + utilizador OWNER. */
export class RegisterRestaurantDto {
  @IsString()
  @IsNotEmpty()
  restaurantName!: string;

  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug inválido: usar minúsculas, números e hífens (ex.: pizzaria-do-ze)',
  })
  slug!: string;

  @IsString()
  @IsNotEmpty()
  ownerName!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8, { message: 'a password deve ter pelo menos 8 caracteres' })
  password!: string;
}
