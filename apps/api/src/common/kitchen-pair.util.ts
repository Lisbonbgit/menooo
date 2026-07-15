import { randomInt } from 'crypto';

// Código de emparelhamento do tablet de cozinha: <id 4><segredo 8> em base32
// (A–Z2–7). O id é público (lookup indexado — evita varrer tenants e correr
// argon2 em todos); o segredo tem 8×5 = 40 bits de entropia.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const ID_LEN = 4;
const SECRET_LEN = 8;

export const PAIR_CODE_TTL_MS = 10 * 60 * 1000; // validade do código

function randomChars(n: number): string {
  let out = '';
  for (let i = 0; i < n; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

export function generatePairCode(): { id: string; secret: string; display: string } {
  const id = randomChars(ID_LEN);
  const secret = randomChars(SECRET_LEN);
  const raw = id + secret;
  const display = `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
  return { id, secret, display };
}

/** Maiúsculas, corrige 0→O e 1→I, remove separadores e tudo fora do alfabeto. */
export function normalizePairCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/0/g, 'O')
    .replace(/1/g, 'I')
    .replace(/[^A-Z2-7]/g, '');
}

export function splitPairCode(normalized: string): { id: string; secret: string } | null {
  if (normalized.length !== ID_LEN + SECRET_LEN) return null;
  return { id: normalized.slice(0, ID_LEN), secret: normalized.slice(ID_LEN) };
}
