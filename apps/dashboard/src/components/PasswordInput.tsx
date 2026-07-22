'use client';

import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  /** classes de layout do invólucro (ex. margens: "mb-6"). */
  containerClassName?: string;
};

/**
 * Campo de password com botão "olho" para mostrar/esconder o texto.
 * Começa escondida; o botão é `type="button"` para não submeter o form.
 * O `className` estiliza o input (como antes); as margens vão em `containerClassName`.
 */
export function PasswordInput({ className = '', containerClassName = '', ...props }: Props) {
  const [show, setShow] = useState(false);
  return (
    <div className={`relative ${containerClassName}`}>
      <input {...props} type={show ? 'text' : 'password'} className={`${className} pr-11`} />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? 'Esconder password' : 'Mostrar password'}
        aria-pressed={show}
        className="absolute inset-y-0 right-0 flex items-center px-3.5 text-ink-mute transition-colors hover:text-brand"
      >
        {show ? <EyeOff size={18} strokeWidth={2} /> : <Eye size={18} strokeWidth={2} />}
      </button>
    </div>
  );
}
