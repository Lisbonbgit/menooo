import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, User, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { RegisterRestaurantDto } from './dto/register-restaurant.dto';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
  ) {}

  /** Auto-registo: cria Tenant (PENDING) + utilizador OWNER, devolve tokens. */
  async registerRestaurant(dto: RegisterRestaurantDto) {
    const existingSlug = await this.prisma.tenant.findUnique({ where: { slug: dto.slug } });
    if (existingSlug) {
      throw new ConflictException('Esse endereço de loja (slug) já está em uso.');
    }

    const passwordHash = await argon2.hash(dto.password);

    try {
      const tenant = await this.prisma.tenant.create({
        data: {
          slug: dto.slug,
          name: dto.restaurantName,
          email: dto.email,
          referralSource: dto.referralSource?.trim() || null,
          users: {
            create: {
              name: dto.ownerName,
              email: dto.email,
              passwordHash,
              role: UserRole.OWNER,
            },
          },
        },
        include: { users: true },
      });

      const user = tenant.users[0];
      // email de boas-vindas (não bloqueia o registo se falhar)
      void this.mail.sendWelcome(user.email, dto.ownerName, dto.restaurantName);
      const tokens = await this.issueTokens(user);
      return { tenant: this.sanitizeTenant(tenant), user: this.sanitizeUser(user), ...tokens };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Já existe uma conta com esse email.');
      }
      throw e;
    }
  }

  async login(dto: LoginDto) {
    // login por email — procura em qualquer tenant + super admins
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email },
      orderBy: { createdAt: 'asc' },
    });
    if (!user) throw new UnauthorizedException('Credenciais inválidas.');

    const valid = await argon2.verify(user.passwordHash, dto.password);
    if (!valid) throw new UnauthorizedException('Credenciais inválidas.');

    const tokens = await this.issueTokens(user);
    return { user: this.sanitizeUser(user), ...tokens };
  }

  private async issueTokens(user: User) {
    const payload = {
      sub: user.id,
      tenantId: user.tenantId,
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

  private sanitizeTenant(tenant: { users?: User[] } & Record<string, unknown>) {
    const { users: _users, ...rest } = tenant;
    return rest;
  }
}
