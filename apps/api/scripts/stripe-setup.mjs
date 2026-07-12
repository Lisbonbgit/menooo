/**
 * Configuração inicial do Stripe para o Menooo — correr UMA vez por ambiente.
 *
 *   STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-setup.mjs [preço-mensal-EUR] [url-do-webhook]
 *
 * Cria: produto "Menooo", preço mensal recorrente e o endpoint de webhook.
 * Imprime as variáveis para colar no .env do servidor.
 */
import Stripe from 'stripe';

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error('Falta STRIPE_SECRET_KEY (sk_test_... ou sk_live_...)');
  process.exit(1);
}

const priceEur = parseFloat(process.argv[2] ?? '9.90');
const webhookUrl = process.argv[3] ?? 'http://187.124.4.163:8083/api/billing/webhook';

const stripe = new Stripe(key);

const product = await stripe.products.create({
  name: 'Menooo — subscrição mensal',
  description: 'Loja online de encomendas para o teu restaurante, sem comissões.',
});

const price = await stripe.prices.create({
  product: product.id,
  currency: 'eur',
  unit_amount: Math.round(priceEur * 100),
  recurring: { interval: 'month' },
});

const webhook = await stripe.webhookEndpoints.create({
  url: webhookUrl,
  enabled_events: [
    'checkout.session.completed',
    'invoice.paid',
    'customer.subscription.deleted',
  ],
});

console.log('\n✅ Stripe configurado. Cola isto no .env do servidor:\n');
console.log(`STRIPE_SECRET_KEY=${key}`);
console.log(`STRIPE_PRICE_ID=${price.id}`);
console.log(`STRIPE_WEBHOOK_SECRET=${webhook.secret}`);
console.log(`\n(produto: ${product.id} · preço: €${priceEur.toFixed(2)}/mês · webhook: ${webhookUrl})`);
