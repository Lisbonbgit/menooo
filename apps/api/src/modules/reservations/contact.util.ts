// Chaves NORMALIZADAS de contacto, usadas SÓ para contar o cap anti-spam por pessoa.
// Os valores originais (customerEmail/customerPhone) mantêm-se intactos para exibição.

/** trim + lowercase. NÃO desfaz aliasing de gmail (pontos/+tag): arrisca falsos positivos e YAGNI. */
export function emailKey(v: string | null | undefined): string | null {
  const s = (v ?? '').trim().toLowerCase();
  return s === '' ? null : s;
}

/** só dígitos, últimos 9 (PT): +351912345678, 912 345 678 e 912345678 são o mesmo contacto. */
export function phoneKey(v: string | null | undefined): string | null {
  const d = (v ?? '').replace(/\D/g, '');
  return d === '' ? null : d.slice(-9);
}
