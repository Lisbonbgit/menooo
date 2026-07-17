import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });

  // O throttle identifica o cliente por `req.ip`. Confiar no X-Forwarded-For SEM um proxy
  // à frente que o reescreva deixa o cliente escolher o próprio IP: um header diferente por
  // pedido = um balde novo por pedido, e todos os limites (login, reservas públicas) caem.
  // Hoje a API está publicada direta (`8083:3001`), logo o valor seguro é `false` = IP do socket.
  // Só pôr TRUST_PROXY=1 quando existir mesmo um proxy E a porta direta deixar de estar exposta
  // (senão o proxy é contornável pela porta e voltamos ao mesmo buraco).
  app.set('trust proxy', process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) : false);

  // CORP cross-origin: as imagens são servidas em api.menooo.com e mostradas
  // na loja (menooo.com) — de outra forma o browser bloqueava-as.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cookieParser());

  // ficheiros carregados (fotos de produtos, capa e logótipo das lojas)
  const uploadsDir = process.env.UPLOADS_DIR ?? join(process.cwd(), 'uploads');
  mkdirSync(uploadsDir, { recursive: true });
  app.useStaticAssets(uploadsDir, { prefix: '/uploads', maxAge: '7d', immutable: true });

  const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim());
  app.enableCors({ origin: origins, credentials: true });

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const swagger = new DocumentBuilder()
    .setTitle('Menooo API')
    .setDescription('SaaS de encomendas online para restaurantes')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swagger));

  // Aviso ruidoso: prod sem secret = reservas públicas a responder 503 (fail-closed, spec §5).
  // O estado "sem proteção" nasce de um typo ou de um .env perdido num redeploy — tem de gritar.
  if (process.env.NODE_ENV === 'production') {
    if (process.env.TURNSTILE_SECRET_KEY) {
      // eslint-disable-next-line no-console
      console.log('🛡️  Turnstile ATIVO nas reservas públicas');
    } else if (process.env.TURNSTILE_OPTIONAL === '1') {
      // eslint-disable-next-line no-console
      console.warn('⚠️  Turnstile DESLIGADO por TURNSTILE_OPTIONAL=1 — reservas públicas sem proteção');
    } else {
      // eslint-disable-next-line no-console
      console.error('❌ TURNSTILE_SECRET_KEY em falta: as reservas públicas vão responder 503');
    }
  }

  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`🍔 Menooo API a correr em http://localhost:${port}/api`);
}

bootstrap();
