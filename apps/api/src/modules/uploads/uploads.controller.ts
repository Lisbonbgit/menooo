import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { randomUUID } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';

/** Pasta onde os ficheiros ficam (volume persistente em produção). */
const UPLOADS_DIR = process.env.UPLOADS_DIR ?? join(process.cwd(), 'uploads');

/** Base pública para construir o URL final (sem barra no fim). */
const publicBase = () =>
  (process.env.PUBLIC_API_URL ?? `http://localhost:${process.env.API_PORT ?? 3001}`).replace(
    /\/+$/,
    '',
  );

/** Extensão do ficheiro a partir do tipo — também serve de lista branca. */
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB

/** Ficheiro recebido pelo multer (evita depender de @types/multer). */
interface UploadedImage {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
}

@ApiTags('uploads')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(UserRole.OWNER, UserRole.STAFF)
@Controller('uploads')
export class UploadsController {
  constructor() {
    mkdirSync(UPLOADS_DIR, { recursive: true });
  }

  /** Recebe uma imagem (campo `file`) e devolve o URL público. */
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  upload(@UploadedFile() file?: UploadedImage) {
    if (!file) throw new BadRequestException('Nenhum ficheiro recebido.');

    const ext = EXT_BY_MIME[file.mimetype];
    if (!ext) {
      throw new BadRequestException('Formato inválido. Usa JPG, PNG, WebP ou GIF.');
    }
    if (file.size > MAX_BYTES) {
      throw new BadRequestException('Imagem demasiado grande (máx. 8 MB).');
    }

    const name = `${randomUUID()}.${ext}`;
    writeFileSync(join(UPLOADS_DIR, name), file.buffer);
    return { url: `${publicBase()}/uploads/${name}` };
  }
}
