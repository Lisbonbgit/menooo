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

  // O throttle identifica o cliente por `req.ip`, logo quem controlar o `req.ip` derruba TODOS
  // os limites (login incluído). Em produção há DOIS caminhos até esta API:
  //   1. https://api.menooo.com  -> Caddy (no host) -> aqui. O Caddy reescreve o X-Forwarded-For,
  //      logo o XFF é de confiança e é dele que sai o IP real do cliente.
  //   2. http://187.124.4.163:8083 -> DIRETO, porta publicada pelo compose. Aqui o XFF é só o que
  //      o atacante escreveu: um header diferente por pedido = um balde novo por pedido.
  // `trust proxy: 1` confiava nos dois (furo pelo caminho 2); `false` não confiaria em nenhum e
  // punha TODO o tráfego do Caddy num só balde -> 429 em clientes reais.
  // Uma lista de proxies resolve os dois: o XFF só conta quando o PEER da ligação é mesmo o
  // proxy (loopback = Caddy no host; uniquelocal = 10/8, 172.16/12, 192.168/16 se algum dia for
  // container). Um pedido da internet à porta 8083 tem peer público -> XFF ignorado -> req.ip =
  // IP do socket, não falsificável. E um XFF forjado ATRAVÉS do Caddy também não pega: o Caddy
  // acrescenta o IP real à direita e o proxy-addr lê a cadeia da direita para a esquerda.
  // Fechar a porta 8083 (`127.0.0.1:8083:3001`) continua a ser boa higiene, mas já não é o que
  // segura isto de pé.
  app.set('trust proxy', process.env.TRUST_PROXY ?? ['loopback', 'uniquelocal']);

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
