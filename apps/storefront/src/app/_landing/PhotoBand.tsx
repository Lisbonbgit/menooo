import Image from 'next/image';
import type { ReactNode } from 'react';

/** Faixa fotográfica de ambiente a toda a largura, com overlay espresso
 *  para o texto em creme manter contraste sobre a foto. */
export function PhotoBand({
  src,
  alt,
  kicker,
  title,
  sub,
  priority = false,
  children,
}: {
  src: string;
  alt: string;
  kicker: string;
  title: string;
  sub: string;
  /** true na primeira faixa: entra no viewport inicial em desktop (LCP) */
  priority?: boolean;
  children?: ReactNode;
}) {
  return (
    <section className="relative flex min-h-[380px] items-center overflow-hidden bg-espresso md:min-h-[460px]">
      <Image
        src={src}
        alt={alt}
        fill
        sizes="100vw"
        quality={70}
        priority={priority}
        className="object-cover"
      />
      {/* overlay duplo: cor da marca + gradiente lateral para a zona do texto */}
      <div className="absolute inset-0 bg-espresso/45" />
      <div className="absolute inset-0 bg-gradient-to-r from-espresso/95 via-espresso/60 to-espresso/20" />

      <div className="relative mx-auto w-full max-w-5xl px-6 py-20">
        <div className="max-w-md">
          <p className="text-[11.5px] font-semibold uppercase tracking-[0.22em] text-brand">
            {kicker}
          </p>
          <h2 className="mt-3 font-display text-[30px] font-semibold leading-tight tracking-tight text-cream sm:text-[36px]">
            {title}
          </h2>
          <p className="mt-4 text-[14.5px] leading-relaxed text-cream/70">{sub}</p>
          {children}
        </div>
      </div>
    </section>
  );
}
