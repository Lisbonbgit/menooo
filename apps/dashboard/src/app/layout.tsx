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

export const metadata: Metadata = {
  title: 'Comanda — Painel do Restaurante',
  description: 'Gestão de encomendas, menu e loja online',
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
