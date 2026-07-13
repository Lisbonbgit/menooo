import { IsEmail, Matches, MinLength } from 'class-validator';

export class ForgotPasswordDto {
  @IsEmail()
  email!: string;
}

export class ResetPasswordDto {
  @IsEmail()
  email!: string;

  @Matches(/^\d{6}$/, { message: 'o código tem de ter 6 dígitos' })
  code!: string;

  @MinLength(8, { message: 'a password tem de ter pelo menos 8 caracteres' })
  newPassword!: string;
}
