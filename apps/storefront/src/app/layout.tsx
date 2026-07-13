import type { Metadata } from 'next';
import { Fraunces, Schibsted_Grotesk } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';

const display = Fraunces({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  style: ['normal', 'italic'],
  variable: '--font-display',
});

const sans = Schibsted_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans-app',
});

const SITE_URL = process.env.NEXT_PUBLIC_STORE_URL ?? 'https://menooo.com';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Menooo — Loja online para o teu restaurante, sem comissões · €9,90/mês',
    template: '%s',
  },
  description:
    'Cria a loja online do teu restaurante em minutos. Pedidos no balcão em tempo real, talão impresso automaticamente, 0% de comissões. 7 dias grátis.',
  openGraph: {
    type: 'website',
    siteName: 'Menooo',
    title: 'Menooo — Loja online para o teu restaurante, sem comissões',
    description:
      'Pedidos no balcão em tempo real, talão impresso automaticamente, 0% de comissões. €9,90/mês, 7 dias grátis.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Menooo — Loja online para o teu restaurante, sem comissões',
    description: 'Pedidos em tempo real, talão automático, 0% comissões. €9,90/mês, 7 dias grátis.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt" className={`${display.variable} ${sans.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
