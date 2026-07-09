import { IsEmail, Matches } from 'class-validator';

export class VerifyEmailDto {
  @IsEmail()
  email!: string;

  @Matches(/^\d{6}$/, { message: 'o código tem de ter 6 dígitos' })
  code!: string;
}
