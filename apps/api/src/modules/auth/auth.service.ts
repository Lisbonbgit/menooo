import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, User, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomInt } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { RegisterRestaurantDto } from './dto/register-restaurant.dto';
import { LoginDto } from './dto/login.dto';

// Verificação de email por código de 6 dígitos
const CODE_TTL_MS = 20 * 60 * 1000; // validade do código
const MAX_ATTEMPTS = 5; // tentativas por código antes de exigir novo
const RESEND_COOLDOWN_MS = 60 * 1000; // intervalo mínimo entre reenvios

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
  ) {}

  /**
   * Auto-registo: cria a Conta do dono + a 1ª unidade (PENDING) + utilizador
   * OWNER, e devolve tokens já com essa unidade ativa.
   */
  async registerRestaurant(dto: RegisterRestaurantDto) {
    const existingSlug = await this.prisma.tenant.findUnique({ where: { slug: dto.slug } });
    if (existingSlug) {
      throw new ConflictException('Esse endereço de loja (slug) já está em uso.');
    }

    const passwordHash = await argon2.hash(dto.password);

    try {
      const account = await this.prisma.account.create({
        data: {
          name: dto.restaurantName,
          referralSource: dto.referralSource?.trim() || null,
          tenants: {
            create: { slug: dto.slug, name: dto.restaurantName, email: dto.email },
          },
          users: {
            create: {
              name: dto.ownerName,
              email: dto.email,
              passwordHash,
              role: UserRole.OWNER,
            },
          },
        },
        include: { users: true, tenants: true },
      });

      const user = account.users[0];
      // envia o código de verificação de 6 dígitos; só entra depois de confirmar
      await this.issueAndSendCode(user);
      return { needsVerification: true, email: user.email };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Já existe uma conta com esse email.');
      }
      throw e;
    }
  }

  async login(dto: LoginDto) {
    // login por email — dono/staff de uma conta ou super admin
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email },
      orderBy: { createdAt: 'asc' },
    });
    if (!user) throw new UnauthorizedException('Credenciais inválidas.');

    const valid = await argon2.verify(user.passwordHash, dto.password);
    if (!valid) throw new UnauthorizedException('Credenciais inválidas.');

    // conta por verificar: encaminha para o ecrã do código (sem reenviar aqui)
    if (!user.emailVerifiedAt) {
      return { needsVerification: true, email: user.email };
    }

    const activeTenantId = await this.defaultTenantId(user.accountId);
    const tokens = await this.issueTokens(user, activeTenantId);
    return { user: this.sanitizeUser(user), ...tokens };
  }

  /** Confirma o código de 6 dígitos, marca o email verificado e inicia sessão. */
  async verifyEmail(email: string, code: string) {
    const user = await this.prisma.user.findFirst({
      where: { email },
      orderBy: { createdAt: 'asc' },
    });
    if (!user) throw new UnauthorizedException('Não encontrámos esse email.');
    if (user.emailVerifiedAt) {
      throw new BadRequestException('Este email já está verificado — inicia sessão.');
    }
    if (!user.verificationCodeHash || !user.verificationCodeExpiresAt) {
      throw new BadRequestException('Não há código pendente. Pede um novo código.');
    }
    if (user.verificationCodeExpiresAt.getTime() < Date.now()) {
      throw new BadRequestException('O código expirou. Pede um novo código.');
    }
    if (user.verificationAttempts >= MAX_ATTEMPTS) {
      throw new BadRequestException('Demasiadas tentativas. Pede um novo código.');
    }

    const ok = await argon2.verify(user.verificationCodeHash, code).catch(() => false);
    if (!ok) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { verificationAttempts: { increment: 1 } },
      });
      throw new UnauthorizedException('Código incorreto.');
    }

    const verified = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerifiedAt: new Date(),
        verificationCodeHash: null,
        verificationCodeExpiresAt: null,
        verificationAttempts: 0,
      },
    });

    // agora sim, boas-vindas + tokens
    const tenant = verified.accountId
      ? await this.prisma.tenant.findFirst({
          where: { accountId: verified.accountId },
          orderBy: { createdAt: 'asc' },
        })
      : null;
    if (tenant) void this.mail.sendWelcome(verified.email, verified.name, tenant.name);

    const tokens = await this.issueTokens(verified, tenant?.id ?? null);
    return { tenant, user: this.sanitizeUser(verified), ...tokens };
  }

  /** Reenvia um novo código de verificação (com intervalo mínimo). */
  async resendCode(email: string) {
    const user = await this.prisma.user.findFirst({
      where: { email },
      orderBy: { createdAt: 'asc' },
    });
    // não revela se o email existe; se já verificado, nada a fazer
    if (!user || user.emailVerifiedAt) return { ok: true };

    const sentRecently =
      user.verificationCodeExpiresAt &&
      user.verificationCodeExpiresAt.getTime() - Date.now() > CODE_TTL_MS - RESEND_COOLDOWN_MS;
    if (sentRecently) {
      throw new BadRequestException('Aguarda um momento antes de pedir um novo código.');
    }

    await this.issueAndSendCode(user);
    return { ok: true };
  }

  /** Gera um código de 6 dígitos, guarda-o (hash) e envia-o por email. */
  private async issueAndSendCode(user: User) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const verificationCodeHash = await argon2.hash(code);
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        verificationCodeHash,
        verificationCodeExpiresAt: new Date(Date.now() + CODE_TTL_MS),
        verificationAttempts: 0,
      },
    });
    void this.mail.sendVerificationCode(user.email, user.name, code);
  }

  /**
   * Troca a unidade ativa da sessão: valida que a unidade pertence à conta do
   * utilizador e emite um novo token com esse tenantId.
   */
  async switchTenant(current: AuthenticatedUser, tenantId: string) {
    if (!current.accountId) {
      throw new ForbiddenException('Sem conta associada.');
    }
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant || tenant.accountId !== current.accountId) {
      throw new ForbiddenException('Unidade não pertence à tua conta.');
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: current.userId } });
    const tokens = await this.issueTokens(user, tenant.id);
    return { tenant, ...tokens };
  }

  /** Unidade ativa por omissão de uma conta: a mais antiga (ou null). */
  private async defaultTenantId(accountId: string | null): Promise<string | null> {
    if (!accountId) return null;
    const first = await this.prisma.tenant.findFirst({
      where: { accountId },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    return first?.id ?? null;
  }

  private async issueTokens(user: User, activeTenantId: string | null) {
    const payload = {
      sub: user.id,
      accountId: user.accountId,
      tenantId: activeTenantId,
      email: user.email,
      role: user.role,
    };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret',
      expiresIn: process.env.JWT_ACCESS_TTL ?? '15m',
    });
    return { accessToken };
  }

  private sanitizeUser(user: User) {
    const { passwordHash: _ph, ...rest } = user;
    return rest;
  }
}
