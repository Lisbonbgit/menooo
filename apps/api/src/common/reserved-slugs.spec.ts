import { isReservedSlug } from './reserved-slugs';

describe('isReservedSlug', () => {
  it('reserva os slugs de rotas estáticas do storefront', () => {
    expect(isReservedSlug('termos')).toBe(true);
    expect(isReservedSlug('checkout')).toBe(true);
  });

  it('reserva "cozinha" (a página de download do APK taparia a loja)', () => {
    expect(isReservedSlug('cozinha')).toBe(true);
  });

  it('é insensível a maiúsculas', () => {
    expect(isReservedSlug('Cozinha')).toBe(true);
    expect(isReservedSlug('COZINHA')).toBe(true);
  });

  it('deixa passar os slugs das lojas reais', () => {
    expect(isReservedSlug('pizzaria-demo')).toBe(false);
    expect(isReservedSlug('lenha-e-brasa')).toBe(false);
    expect(isReservedSlug('loja-do-silas')).toBe(false);
  });
});
