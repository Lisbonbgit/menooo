import type { Metadata } from 'next';
import { LegalShell, ENTIDADE } from '../_legal/legal';

export const metadata: Metadata = {
  title: 'Política de Privacidade — Menooo',
  description: 'Como a plataforma Menooo trata os dados pessoais (RGPD).',
};

export default function PrivacidadePage() {
  return (
    <LegalShell title="Política de Privacidade" updated="13 de julho de 2026">
      <p>
        Esta política explica como a <strong>{ENTIDADE.nome}</strong>, NIF {ENTIDADE.nif}, com
        sede em {ENTIDADE.morada}, trata dados pessoais na plataforma Menooo, nos termos do
        Regulamento Geral sobre a Proteção de Dados (RGPD).
      </p>

      <h2>1. Quem é responsável pelo quê</h2>
      <ul>
        <li>
          <strong>Dados dos restaurantes</strong> (conta, dono, faturação da subscrição): a{' '}
          {ENTIDADE.nome} é a <strong>responsável pelo tratamento</strong>.
        </li>
        <li>
          <strong>Dados dos clientes finais</strong> introduzidos ao encomendar (nome, telefone,
          email, morada de entrega): o <strong>restaurante</strong> é o responsável pelo
          tratamento; a {ENTIDADE.nome} atua como <strong>subcontratante</strong>, tratando-os
          apenas para entregar a encomenda ao restaurante.
        </li>
      </ul>

      <h2>2. Que dados tratamos e para quê</h2>
      <ul>
        <li><strong>Conta do restaurante:</strong> nome, email, password (cifrada), dados da loja — para prestar o serviço (execução de contrato).</li>
        <li><strong>Encomendas:</strong> nome, contacto e morada do cliente final — para o restaurante preparar e entregar (execução de contrato).</li>
        <li><strong>Pagamentos da subscrição:</strong> processados pela Stripe; não guardamos números de cartão.</li>
        <li><strong>Emails transacionais:</strong> códigos de verificação, avisos de subscrição — enviados através do fornecedor SMTP.</li>
        <li><strong>Marketing ao cliente final:</strong> só com consentimento dado no checkout (caixa opcional), e apenas para o restaurante em causa.</li>
        <li><strong>Registos técnicos:</strong> logs de acesso e erros, para segurança e diagnóstico (interesse legítimo).</li>
      </ul>

      <h2>3. Cookies e armazenamento local</h2>
      <p>
        A plataforma usa apenas armazenamento técnico essencial (por exemplo, o carrinho de
        compras e a sessão do painel ficam no armazenamento local do navegador). Não usamos
        cookies de publicidade nem rastreio de terceiros.
      </p>

      <h2>4. Com quem partilhamos</h2>
      <ul>
        <li>Fornecedor de alojamento dos servidores (UE ou com garantias adequadas).</li>
        <li>Stripe (pagamentos de subscrição) e fornecedor de email transacional.</li>
        <li>Autoridades, quando a lei o exigir.</li>
      </ul>
      <p>Não vendemos dados pessoais a terceiros.</p>

      <h2>5. Prazos de conservação</h2>
      <ul>
        <li>Dados da conta: enquanto a conta existir; eliminados com a exclusão da conta.</li>
        <li>Encomendas: enquanto a loja existir, para histórico do restaurante.</li>
        <li>Registos de faturação da plataforma: prazos legais de contabilidade.</li>
      </ul>

      <h2>6. Os teus direitos</h2>
      <p>
        Podes pedir acesso, retificação, apagamento, limitação, portabilidade e opor-te ao
        tratamento, escrevendo para <a href={`mailto:${ENTIDADE.email}`}>{ENTIDADE.email}</a>.
        Clientes finais podem exercer os direitos junto do restaurante ou através de nós, que
        encaminhamos. Tens ainda o direito de apresentar reclamação à CNPD
        (<a href="https://www.cnpd.pt">cnpd.pt</a>).
      </p>

      <h2>7. Segurança</h2>
      <p>
        Passwords guardadas com cifragem forte (Argon2), acesso por HTTPS, isolamento de dados
        por restaurante e cópias de segurança regulares.
      </p>

      <h2>8. Alterações</h2>
      <p>
        Se esta política mudar de forma relevante, avisamos por email ou no painel antes de a
        alteração produzir efeitos.
      </p>
    </LegalShell>
  );
}
