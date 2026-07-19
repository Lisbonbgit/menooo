import { IsBoolean } from 'class-validator';

export class SetLifetimeDto {
  /** true = dar acesso vitalício; false = retirar */
  @IsBoolean()
  lifetime!: boolean;
}
