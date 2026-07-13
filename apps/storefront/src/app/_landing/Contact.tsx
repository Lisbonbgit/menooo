import { Mail } from 'lucide-react';

/** Contacto humano: dono de restaurante fala com gente, não com uma página. */
export function Contact() {
  return (
    <section className="mx-auto max-w-5xl px-6 py-16">
      <div className="flex flex-col items-start justify-between gap-6 border border-ink/15 bg-white px-8 py-8 sm:flex-row sm:items-center">
        <div>
          <h2 className="font-display text-[22px] font-semibold tracking-tight">
            Falas com gente, não com uma página.
          </h2>
          <p className="mt-1.5 text-[14px] leading-relaxed text-ink-soft">
            Dúvidas antes de começar? Respondemos de pessoa para pessoa.
          </p>
        </div>
        <a
          href="mailto:geral@menooo.com"
          className="inline-flex shrink-0 items-center gap-2.5 rounded-lg border border-ink/15 px-6 py-3 text-[14px] font-semibold text-ink transition-colors hover:border-brand hover:text-brand-dark"
        >
          <Mail size={16} /> geral@menooo.com
        </a>
      </div>
    </section>
  );
}
