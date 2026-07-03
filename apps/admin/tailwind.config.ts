import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#E05A1E',
          dark: '#C24812',
          soft: '#FBE9DD',
        },
        paper: '#FAF6F0',
        espresso: {
          DEFAULT: '#231A13',
          light: '#31251B',
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
      },
      keyframes: {
        fadeUp: {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-up': 'fadeUp 0.45s cubic-bezier(0.22,1,0.36,1) both',
      },
    },
  },
  plugins: [],
};

export default config;
