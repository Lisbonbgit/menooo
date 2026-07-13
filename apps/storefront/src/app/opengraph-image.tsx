import { ImageResponse } from 'next/og';

// OG image de marca da homepage (partilha no WhatsApp/redes).
export const alt = 'Menooo — Loja online para o teu restaurante, sem comissões';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const BG = '#231A13';
const CREAM = '#F3EBDF';
const BRAND = '#E05A1E';
const PAPER = '#FAF6F0';
const INK = '#2B211A';
const MUTE = '#A2937F';

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          background: BG,
          padding: '64px 72px',
          fontFamily: 'Georgia, serif',
        }}
      >
        {/* coluna esquerda: mensagem */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ width: 20, height: 20, borderRadius: 999, background: BRAND }} />
            <div style={{ fontSize: 34, fontWeight: 700, color: CREAM, letterSpacing: -1 }}>Menooo</div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 62, fontWeight: 700, color: CREAM, lineHeight: 1.05, letterSpacing: -2 }}>
              A tua loja online,
            </div>
            <div style={{ fontSize: 62, fontWeight: 700, color: BRAND, lineHeight: 1.05, letterSpacing: -2, fontStyle: 'italic' }}>
              sem comissões.
            </div>
            <div style={{ fontSize: 26, color: 'rgba(243,235,223,0.65)', marginTop: 22, maxWidth: 560, lineHeight: 1.4, fontFamily: 'sans-serif' }}>
              Pedidos no balcão em tempo real e talão impresso automaticamente.
            </div>
          </div>

          <div style={{ display: 'flex', gap: 14, fontFamily: 'sans-serif' }}>
            <div style={{ display: 'flex', background: BRAND, color: '#fff', fontSize: 24, fontWeight: 700, padding: '12px 24px', borderRadius: 12 }}>
              €9,90/mês
            </div>
            <div style={{ display: 'flex', color: 'rgba(243,235,223,0.7)', fontSize: 24, fontWeight: 600, padding: '12px 4px' }}>
              0% comissões · 7 dias grátis
            </div>
          </div>
        </div>

        {/* coluna direita: talão */}
        <div style={{ display: 'flex', alignItems: 'center', paddingLeft: 48 }}>
          <div style={{ display: 'flex', flexDirection: 'column', width: 300, background: PAPER, borderRadius: 8, padding: '30px 32px', transform: 'rotate(2deg)' }}>
            <div style={{ display: 'flex', justifyContent: 'center', fontSize: 15, color: MUTE, letterSpacing: 4, fontFamily: 'sans-serif' }}>
              MENOOO · PEDIDO
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', fontSize: 68, fontWeight: 700, color: INK, marginTop: 4 }}>
              #42
            </div>
            <div style={{ display: 'flex', height: 1, background: 'rgba(43,33,26,0.18)', margin: '20px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 20, color: INK, fontFamily: 'sans-serif', marginBottom: 10 }}>
              <div>2× Margherita</div>
              <div>23,00</div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 20, color: INK, fontFamily: 'sans-serif', marginBottom: 10 }}>
              <div>1× Diavola</div>
              <div>11,50</div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 20, color: INK, fontFamily: 'sans-serif' }}>
              <div>2× Água 0,5 L</div>
              <div>2,40</div>
            </div>
            <div style={{ display: 'flex', height: 1, background: 'rgba(43,33,26,0.18)', margin: '20px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 15, color: MUTE, letterSpacing: 2, fontFamily: 'sans-serif' }}>TOTAL</div>
              <div style={{ fontSize: 34, fontWeight: 700, color: INK }}>39,40 €</div>
            </div>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
