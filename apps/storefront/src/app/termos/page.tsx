import type { Metadata } from 'next';
import { LegalShell, ENTIDADE } from '../_legal/legal';

export const metadata: Metadata = {
  title: 'Termos e Condições — Menooo',
  description: 'Termos e condições de utilização da plataforma Menooo.',
};

export default function TermosPage() {
  return (
    <LegalShell title="Termos e Condições" updated="13 de julho de 2026">
      <p>
        Estes termos regulam a utilização da plataforma <strong>Menooo</strong> (menooo.com e
        subdomínios), operada por <strong>{ENTIDADE.nome}</strong>, NIF {ENTIDADE.nif}, com sede
        em {ENTIDADE.morada} (&quot;Menooo&quot;, &quot;nós&quot;). Ao criar conta ou utilizar a
        plataforma, aceitas estes termos.
      </p>

      <h2>1. O serviço</h2>
      <p>
        O Menooo é uma plataforma de software (SaaS) que permite a restaurantes criar uma loja
        online própria, receber encomendas em tempo real e imprimir talões. O Menooo fornece a
        tecnologia; <strong>não confeciona, não entrega e não vende</strong> os produtos
        apresentados nas lojas.
      </p>

      <h2>2. Encomendas: contrato entre cliente e restaurante</h2>
      <p>
        Cada encomenda feita numa loja Menooo constitui um contrato direto entre o consumidor e o
        restaurante identificado nessa loja. O pagamento é feito diretamente ao restaurante
        (na entrega ou no levantamento). Preços, disponibilidade, qualidade, alergénios, tempos de
        entrega e faturação ao consumidor são da responsabilidade do restaurante. Reclamações
        sobre uma encomenda devem ser dirigidas ao restaurante; reclamações sobre a plataforma, a
        nós ({ENTIDADE.email}).
      </p>

      <h2>3. Conta do restaurante</h2>
      <ul>
        <li>O registo é gratuito e a loja fica pendente até aprovação pela nossa equipa.</li>
        <li>És responsável pela veracidade dos dados, pela segurança das credenciais e por toda a atividade na tua conta.</li>
        <li>A conta pode ter várias lojas (unidades); a subscrição cobre todas as unidades da conta.</li>
      </ul>

      <h2>4. Preço e subscrição</h2>
      <ul>
        <li>Período de teste gratuito de 7 dias a partir da ativação da primeira loja.</li>
        <li>Depois do teste: subscrição de <strong>€9,90/mês</strong> (IVA incluído, salvo indicação em contrário), sem comissões sobre as vendas.</li>
        <li>Sem fidelização: podes cancelar a qualquer momento e o acesso mantém-se até ao fim do período pago.</li>
        <li>Sem pagamento válido após o teste, as lojas ficam offline até a subscrição ser ativada.</li>
      </ul>

      <h2>5. Utilização aceitável</h2>
      <p>
        Não é permitido usar a plataforma para conteúdos ou atividades ilegais, para vender
        produtos proibidos, para enviar comunicações não solicitadas, nem para interferir com o
        funcionamento ou a segurança do serviço. Reservamo-nos o direito de suspender ou banir
        contas que violem estes termos, com efeito imediato em todas as lojas da conta.
      </p>

      <h2>6. Conteúdos do restaurante</h2>
      <p>
        Os menús, fotografias, marcas e textos publicados nas lojas pertencem ao restaurante, que
        garante ter os direitos necessários e nos autoriza a alojá-los e apresentá-los para
        prestar o serviço.
      </p>

      <h2>7. Disponibilidade e alterações</h2>
      <p>
        Trabalhamos para manter o serviço disponível de forma contínua, mas não garantimos
        disponibilidade ininterrupta (manutenções, falhas de terceiros ou causas de força maior).
        Podemos alterar funcionalidades e estes termos; alterações relevantes serão comunicadas
        com antecedência razoável por email ou no painel.
      </p>

      <h2>8. Responsabilidade</h2>
      <p>
        Na máxima medida permitida por lei, a nossa responsabilidade total perante um restaurante
        fica limitada ao valor pago pela subscrição nos 12 meses anteriores ao facto que a
        originar. Nada nestes termos limita direitos que a lei não permita limitar.
      </p>

      <h2>9. Resolução de litígios</h2>
      <p>
        Em caso de litígio de consumo, o consumidor pode recorrer ao Livro de Reclamações
        eletrónico (<a href="https://www.livroreclamacoes.pt/Inicio/">livroreclamacoes.pt</a>) e
        às entidades de resolução alternativa de litígios competentes. Lei aplicável: portuguesa.
        Foro: comarca da sede da {ENTIDADE.nome}, sem prejuízo das normas imperativas de proteção
        do consumidor.
      </p>

      <h2>10. Contacto</h2>
      <p>
        {ENTIDADE.nome} · NIF {ENTIDADE.nif} · {ENTIDADE.morada} ·{' '}
        <a href={`mailto:${ENTIDADE.email}`}>{ENTIDADE.email}</a>
      </p>
    </LegalShell>
  );
}
