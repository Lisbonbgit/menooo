import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Gestor master (SUPER_ADMIN) definido pelo .env: SUPER_ADMIN_EMAIL +
 * SUPER_ADMIN_PASSWORD. Em cada arranque, se as duas variáveis existirem,
 * garante que o super-admin tem esse email e password (login gerido pelo .env).
 * Sem as variáveis, não faz nada — o login atual mantém-se.
 */
@Injectable()
export class AdminBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminBootstrapService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    const email = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.SUPER_ADMIN_PASSWORD;
    if (!email || !password) return;

    const passwordHash = await argon2.hash(password);
    const existing = await this.prisma.user.findFirst({
      where: { role: UserRole.SUPER_ADMIN },
      orderBy: { createdAt: 'asc' },
    });

    if (existing) {
      // nada muda se o email e a password já forem os do .env
      const sameEmail = existing.email.toLowerCase() === email;
      const samePassword = await argon2.verify(existing.passwordHash, password).catch(() => false);
      if (sameEmail && samePassword) return;

      await this.prisma.user.update({
        where: { id: existing.id },
        data: { email, passwordHash, accountId: null, emailVerifiedAt: new Date() },
      });
      this.logger.log(`gestor master atualizado a partir do .env (${email}).`);
    } else {
      await this.prisma.user.create({
        data: {
          email,
          passwordHash,
          name: 'Gestor Master',
          role: UserRole.SUPER_ADMIN,
          accountId: null,
          emailVerifiedAt: new Date(),
        },
      });
      this.logger.log(`gestor master criado a partir do .env (${email}).`);
    }
  }
}
