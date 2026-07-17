import { emailKey, phoneKey } from './contact.util';

describe('emailKey', () => {
  it('trim + lowercase: " Ana@X.pt " é o mesmo contacto que "ana@x.pt"', () => {
    expect(emailKey(' Ana@X.pt ')).toBe('ana@x.pt');
  });
  it('email já normalizado fica igual', () => {
    expect(emailKey('ana@x.pt')).toBe('ana@x.pt');
  });
  it('vazio, só espaços, null e undefined dão null', () => {
    expect(emailKey('')).toBeNull();
    expect(emailKey('   ')).toBeNull();
    expect(emailKey(null)).toBeNull();
    expect(emailKey(undefined)).toBeNull();
  });
  it('NÃO desfaz aliasing de gmail (decisão do spec: arrisca falsos positivos)', () => {
    expect(emailKey('a.na+jantar@gmail.com')).toBe('a.na+jantar@gmail.com');
    expect(emailKey('a.na+jantar@gmail.com')).not.toBe(emailKey('ana@gmail.com'));
  });
});

describe('phoneKey', () => {
  it('+351 912 345 678 e 912345678 são o mesmo contacto', () => {
    expect(phoneKey('+351 912 345 678')).toBe('912345678');
    expect(phoneKey('912345678')).toBe('912345678');
    expect(phoneKey('+351912345678')).toBe('912345678');
    expect(phoneKey('912 345 678')).toBe('912345678');
  });
  it('descarta qualquer pontuação (parênteses, traços, pontos)', () => {
    expect(phoneKey('(+351) 912-345.678')).toBe('912345678');
  });
  it('número mais curto que 9 dígitos fica como está (não faz padding)', () => {
    expect(phoneKey('12345')).toBe('12345');
  });
  it('vazio, só pontuação, null e undefined dão null', () => {
    expect(phoneKey('')).toBeNull();
    expect(phoneKey('   ')).toBeNull();
    expect(phoneKey('+-()')).toBeNull();
    expect(phoneKey(null)).toBeNull();
    expect(phoneKey(undefined)).toBeNull();
  });
});
