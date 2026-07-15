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
import { randomBytes, randomInt } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { isReservedSlug } from '../../common/reserved-slugs';
import { RegisterRestaurantDto } from './dto/register-restaurant.dto';
import { LoginDto } from './dto/login.dto';

// Verificação de email por código de 6 dígitos
const CODE_TTL_MS = 20 * 60 * 1000; // validade do código
const MAX_ATTEMPTS = 5; // tentativas por código antes de exigir novo
const RESEND_COOLDOWN_MS = 60 * 1000; // intervalo mínimo entre reenvios

/** '7d' | '12h' | '15m' | '30s' → ms. Default 7 dias se não reconhecer. */
function parseDurationMs(value: string): number {
  const m = /^(\d+)\s*([smhd])$/.exec(value.trim());
  if (!m) return 7 * 24 * 60 * 60 * 1000;
  const n = Number(m[1]);
  const mult = m[2] === 's' ? 1_000 : m[2] === 'm' ? 60_000 : m[2] === 'h' ? 3_600_000 : 86_400_000;
  return n * mult;
}

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
    if (isReservedSlug(dto.slug)) {
      throw new ConflictException('Esse endereço de loja (slug) não está disponível.');
    }
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

    // empresa banida: recusa ANTES do desvio para verificação de email,
    // senão o fluxo do código contornava o bloqueio
    await this.assertAccountNotBanned(user.accountId);

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
    await this.assertAccountNotBanned(user.accountId);
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

    // aviso interno: registo confirmado com loja pendente de ativação no admin
    if (tenant && tenant.status === 'PENDING') {
      const account = await this.prisma.account.findUnique({
        where: { id: tenant.accountId },
        select: { referralSource: true },
      });
      void this.mail.sendNewRegistrationAlert({
        restaurantName: tenant.name,
        slug: tenant.slug,
        ownerName: verified.name,
        ownerEmail: verified.email,
        referralSource: account?.referralSource,
      });
    }

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

  /**
   * "Esqueci-me da password": envia um código de 6 dígitos. A resposta é
   * sempre neutra — não revela se o email existe na plataforma.
   */
  async forgotPassword(email: string) {
    const user = await this.prisma.user.findFirst({
      where: { email },
      orderBy: { createdAt: 'asc' },
    });
    if (!user) return { ok: true };

    // dentro do cooldown: resposta igualmente neutra (um 400 aqui seria um
    // oráculo de que o email existe), simplesmente sem reenviar
    const sentRecently =
      user.passwordResetExpiresAt &&
      user.passwordResetExpiresAt.getTime() - Date.now() > CODE_TTL_MS - RESEND_COOLDOWN_MS;
    if (sentRecently) return { ok: true };

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetCodeHash: await argon2.hash(code),
        passwordResetExpiresAt: new Date(Date.now() + CODE_TTL_MS),
        passwordResetAttempts: 0,
      },
    });
    void this.mail.sendPasswordReset(user.email, user.name, code);
    return { ok: true };
  }

  /** Define a password nova com o código; corta as sessões existentes. */
  async resetPassword(email: string, code: string, newPassword: string) {
    const user = await this.prisma.user.findFirst({
      where: { email },
      orderBy: { createdAt: 'asc' },
    });
    // mensagem única para qualquer falha — não revela emails nem estados
    const invalid = () => new UnauthorizedException('Código inválido ou expirado.');
    if (!user || !user.passwordResetCodeHash || !user.passwordResetExpiresAt) throw invalid();
    if (user.passwordResetExpiresAt.getTime() < Date.now()) throw invalid();
    if (user.passwordResetAttempts >= MAX_ATTEMPTS) throw invalid();

    const ok = await argon2.verify(user.passwordResetCodeHash, code).catch(() => false);
    if (!ok) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { passwordResetAttempts: { increment: 1 } },
      });
      throw invalid();
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: await argon2.hash(newPassword),
          passwordResetCodeHash: null,
          passwordResetExpiresAt: null,
          passwordResetAttempts: 0,
          // quem repõe a password provou controlar o email
          emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
        },
      }),
      // sessões antigas deixam de valer (se o email foi comprometido, corta tudo)
      this.prisma.refreshToken.deleteMany({ where: { userId: user.id } }),
    ]);
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
    // sem isto, um token residual pós-ban renovava a sessão indefinidamente
    await this.assertAccountNotBanned(current.accountId);
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant || tenant.accountId !== current.accountId) {
      throw new ForbiddenException('Unidade não pertence à tua conta.');
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: current.userId } });
    const tokens = await this.issueTokens(user, tenant.id);
    return { tenant, ...tokens };
  }

  /**
   * Renova a sessão a partir de um refresh token válido. RODA o token (o antigo
   * fica revogado e é emitido um novo par), por isso cada refresh token só serve
   * uma vez. Preserva a unidade ativa se o cliente a indicar e ela pertencer à
   * conta; senão usa a unidade por omissão.
   */
  async refresh(refreshToken: string, tenantId?: string) {
    const parsed = this.parseRefreshToken(refreshToken);
    if (!parsed) throw new UnauthorizedException('Sessão inválida.');

    const row = await this.prisma.refreshToken.findUnique({ where: { id: parsed.id } });
    if (!row) throw new UnauthorizedException('Sessão inválida.');

    // Reutilização de um token JÁ rodado = cópia roubada ou replay: corta a
    // família inteira do utilizador e obriga a nova autenticação.
    if (row.revokedAt) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: row.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Sessão expirada. Inicia sessão novamente.');
    }
    if (row.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Sessão expirada. Inicia sessão novamente.');
    }
    const ok = await argon2.verify(row.tokenHash, parsed.secret).catch(() => false);
    if (!ok) throw new UnauthorizedException('Sessão inválida.');

    const user = await this.prisma.user.findUnique({ where: { id: row.userId } });
    if (!user) throw new UnauthorizedException('Sessão inválida.');
    await this.assertAccountNotBanned(user.accountId);

    // roda: o refresh token só vale uma vez
    await this.prisma.refreshToken.update({
      where: { id: row.id },
      data: { revokedAt: new Date() },
    });

    // KITCHEN está PRESO à unidade emparelhada — ignora o tenantId do cliente.
    const activeTenantId =
      user.role === UserRole.KITCHEN
        ? (user.kitchenTenantId ?? null)
        : await this.resolveTenantId(user, tenantId);
    const tokens = await this.issueTokens(user, activeTenantId);
    return { user: this.sanitizeUser(user), ...tokens };
  }

  /** Revoga um refresh token (logout). Idempotente e silencioso. */
  async logout(refreshToken: string) {
    const parsed = this.parseRefreshToken(refreshToken);
    if (parsed) {
      await this.prisma.refreshToken.updateMany({
        where: { id: parsed.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    return { ok: true };
  }

  /** Nenhuma emissão de sessão para contas banidas (login, verify-email, switch). */
  private async assertAccountNotBanned(accountId: string | null) {
    if (!accountId) return;
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { status: true },
    });
    if (account?.status === 'BANNED') {
      throw new ForbiddenException('Conta banida. Contacta o suporte.');
    }
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
    // TTLs mais curtos para a cozinha: o tablet é partilhado e a revogação
    // ("desemparelhar") só faz efeito quando o access token expira.
    const isKitchen = user.role === UserRole.KITCHEN;
    const accessToken = await this.jwt.signAsync(payload, {
      secret: process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret',
      expiresIn: isKitchen
        ? (process.env.KITCHEN_ACCESS_TTL ?? '5m')
        : (process.env.JWT_ACCESS_TTL ?? '15m'),
    });
    const refreshTtlMs = parseDurationMs(
      isKitchen
        ? (process.env.KITCHEN_REFRESH_TTL ?? '5d')
        : (process.env.JWT_REFRESH_TTL ?? '7d'),
    );
    const refreshToken = await this.createRefreshToken(user.id, refreshTtlMs);
    return { accessToken, refreshToken };
  }

  /**
   * Cria um refresh token opaco no formato `<id>.<segredo>`. Guardamos só o hash
   * do segredo (argon2) — o valor em claro nunca fica na base de dados.
   */
  private async createRefreshToken(userId: string, ttlMs: number): Promise<string> {
    const secret = randomBytes(32).toString('hex');
    const row = await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: await argon2.hash(secret),
        expiresAt: new Date(Date.now() + ttlMs),
      },
    });
    return `${row.id}.${secret}`;
  }

  private parseRefreshToken(raw: string): { id: string; secret: string } | null {
    const i = raw.indexOf('.');
    if (i <= 0 || i === raw.length - 1) return null;
    return { id: raw.slice(0, i), secret: raw.slice(i + 1) };
  }

  /** Unidade ativa pedida (se pertencer à conta do utilizador) ou a por omissão. */
  private async resolveTenantId(user: User, wanted?: string): Promise<string | null> {
    if (wanted) {
      const t = await this.prisma.tenant.findUnique({ where: { id: wanted } });
      if (t && t.accountId === user.accountId) return t.id;
    }
    return this.defaultTenantId(user.accountId);
  }

  private sanitizeUser(user: User) {
    const { passwordHash: _ph, ...rest } = user;
    return rest;
  }
}
