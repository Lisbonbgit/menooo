import { IsBoolean } from 'class-validator';

export class BanAccountDto {
  /** true = banir (bloqueia login e lojas); false = reativar */
  @IsBoolean()
  banned!: boolean;
}
