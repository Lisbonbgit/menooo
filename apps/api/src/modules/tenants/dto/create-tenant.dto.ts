import { IsNotEmpty, IsString, Matches } from 'class-validator';

/** Nova unidade (restaurante) dentro da conta do dono. */
export class CreateTenantDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug inválido: usar minúsculas, números e hífens (ex.: pizzaria-do-porto)',
  })
  slug!: string;
}
