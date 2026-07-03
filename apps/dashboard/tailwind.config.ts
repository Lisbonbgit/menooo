import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // marca "brasa" — quente e apetitosa
        brand: {
          DEFAULT: '#E05A1E',
          dark: '#C24812',
          soft: '#FBE9DD',
          ink: '#7A2E0E',
        },
        paper: '#FAF6F0',
        espresso: {
          DEFAULT: '#231A13',
          light: '#31251B',
          line: '#3E3025',
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
        pop: '0 24px 64px rgba(20,12,6,0.28)',
      },
      keyframes: {
        fadeUp: {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        pulseDot: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.35' },
        },
        ringNew: {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(224,90,30,0.0)' },
          '50%': { boxShadow: '0 0 0 6px rgba(224,90,30,0.18)' },
        },
      },
      animation: {
        'fade-up': 'fadeUp 0.45s cubic-bezier(0.22,1,0.36,1) both',
        'pulse-dot': 'pulseDot 1.6s ease-in-out infinite',
        'ring-new': 'ringNew 1.8s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
