import { slotMinutes } from './slots.util';

describe('slotMinutes', () => {
  it('janela única: de open a close inclusive, passo 30', () => {
    expect(slotMinutes([{ openMinute: 12 * 60, closeMinute: 13 * 60 }])).toEqual([720, 750, 780]);
  });
  it('início não-múltiplo de 30 arredonda para cima', () => {
    expect(slotMinutes([{ openMinute: 12 * 60 + 15, closeMinute: 13 * 60 }])).toEqual([750, 780]);
  });
  it('duas janelas (almoço+jantar) ordenadas e sem duplicados', () => {
    expect(
      slotMinutes([
        { openMinute: 19 * 60, closeMinute: 19 * 60 + 30 },
        { openMinute: 12 * 60, closeMinute: 12 * 60 + 30 },
      ]),
    ).toEqual([720, 750, 1140, 1170]);
  });
  it('janela invertida ou vazia → sem slots', () => {
    expect(slotMinutes([{ openMinute: 800, closeMinute: 700 }])).toEqual([]);
  });
});
