import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // personalizáveis por loja via variáveis CSS (StoreTheme define-as);
        // os valores por omissão são o tema Menooo
        brand: {
          DEFAULT: 'rgb(var(--store-brand, 224 90 30) / <alpha-value>)',
          dark: 'rgb(var(--store-brand-dark, 194 72 18) / <alpha-value>)',
          soft: 'rgb(var(--store-brand-soft, 251 233 221) / <alpha-value>)',
          ink: 'rgb(var(--store-brand-ink, 122 46 14) / <alpha-value>)',
        },
        paper: '#FAF6F0',
        espresso: {
          DEFAULT: 'rgb(var(--store-hero, 35 26 19) / <alpha-value>)',
          light: 'rgb(var(--store-hero-light, 49 37 27) / <alpha-value>)',
        },
        ink: {
          DEFAULT: '#2B211A',
          soft: '#6E6156',
          mute: '#A2937F',
        },
        line: '#EBE1D3',
        cream: '#F3EBDF',
      },
      fontFamily: {
        display: ['var(--font-display)', 'Georgia', 'serif'],
        sans: ['var(--font-sans-app)', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(43,33,26,0.05)',
        lift: '0 2px 6px rgba(43,33,26,0.08), 0 16px 40px rgba(43,33,26,0.12)',
        bar: '0 -4px 24px rgba(43,33,26,0.10), 0 8px 32px rgba(43,33,26,0.18)',
      },
      keyframes: {
        fadeUp: {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        sheetUp: {
          from: { transform: 'translateY(40px)', opacity: '0' },
          to: { transform: 'translateY(0)', opacity: '1' },
        },
      },
      animation: {
        'fade-up': 'fadeUp 0.45s cubic-bezier(0.22,1,0.36,1) both',
        'sheet-up': 'sheetUp 0.3s cubic-bezier(0.22,1,0.36,1) both',
      },
    },
  },
  plugins: [],
};

export default config;
