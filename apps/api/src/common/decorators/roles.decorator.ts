import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@prisma/client';

export const ROLES_KEY = 'roles';

/** Restringe a rota a determinados papéis. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
