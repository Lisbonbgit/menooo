/**
 * Postgres portátil (embedded-postgres) para desenvolvimento/testes — sem Docker.
 *
 *   node scripts/embedded-db.mjs all     → migrate + seed e termina
 *   node scripts/embedded-db.mjs serve   → arranca, migra, semeia e fica vivo
 *
 * Usa a PG_PORT (default 5433), igual ao DATABASE_URL do .env.
 */
import EmbeddedPostgres from 'embedded-postgres';
import { execSync } from 'node:child_process';

const PORT = Number(process.env.PG_PORT ?? 5433);
const DATABASE_URL = `postgresql://comanda:comanda@localhost:${PORT}/comanda?schema=public`;
const mode = process.argv[2] ?? 'all';

// pasta de dados persistente (sobrevive entre arranques) na própria app
const dataDir = new URL('../.pgdata', import.meta.url).pathname;

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'comanda',
  password: 'comanda',
  port: PORT,
  persistent: true,
});

async function main() {
  const { existsSync } = await import('node:fs');
  if (!existsSync(dataDir)) {
    console.log(`[db] a inicializar em ${dataDir}…`);
    await pg.initialise();
  }
  await pg.start();
  try {
    await pg.createDatabase('comanda');
  } catch {
    /* já existe */
  }
  console.log(`[db] pronto: ${DATABASE_URL}`);

  const env = { ...process.env, DATABASE_URL };
  execSync('npx prisma migrate deploy', { stdio: 'inherit', env });
  execSync('npx prisma db seed', { stdio: 'inherit', env });

  if (mode === 'serve') {
    console.log('[db] SERVE-READY');
    const shutdown = async () => {
      await pg.stop();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    setInterval(() => {}, 1 << 30);
    return;
  }

  await pg.stop();
  console.log('[db] parado.');
}

main().catch(async (err) => {
  console.error('[db] erro:', err);
  try {
    await pg.stop();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
