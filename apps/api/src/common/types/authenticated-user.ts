import { UserRole } from '@prisma/client';

export interface AuthenticatedUser {
  userId: string;
  accountId: string | null; // conta do dono (null = SUPER_ADMIN)
  tenantId: string | null; // unidade ativa na sessão
  email: string;
  role: UserRole;
}
