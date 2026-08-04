// modules/billing/service.js — CRM subscription status + checkout kickoff,
// ported from src/routes/billing.js. Order/session creation is
// deliberately stubbed per-provider, same as the reference: wiring a real
// Razorpay order / Stripe Checkout Session / PayPal order needs that
// provider's SDK + API keys, which aren't in this repo. The shape (routes,
// request/response contract, crm_subscriptions writes) is real — replace
// the TODO block in createCheckout() with the real SDK call once a
// provider is chosen.
const { supabase } = require('../../shared/db');

async function getSubscription(clientId) {
  const { data, error } = await supabase.from('crm_subscriptions').select('*').eq('client_id', clientId).maybeSingle();
  if (error) throw new Error(error.message);
  return data || { client_id: clientId, plan: 'free', status: 'active', provider: null, provider_ref: null, current_period_end: null };
}

/** Starts a checkout for the given plan. Returns { checkoutUrl } once a
 * real provider SDK is wired in; for now returns a clear "not configured"
 * error instead of silently pretending to charge the client. */
async function createCheckout(clientId, { plan, provider }) {
  if (!plan) throw new Error('plan is required');
  if (!provider) throw new Error('provider is required (e.g. "razorpay", "stripe", "paypal")');

  // TODO: replace with a real SDK call per provider, e.g.:
  //   if (provider === 'stripe') { const session = await stripe.checkout.sessions.create({...}); return { checkoutUrl: session.url }; }
  //   if (provider === 'razorpay') { const order = await razorpay.orders.create({...}); return { checkoutUrl: order.short_url }; }
  throw new Error(`Checkout for provider "${provider}" isn't configured yet — add the SDK call in modules/billing/service.js#createCheckout.`);
}

/** Called from a (future) payment-provider webhook once that's wired up —
 * upserts the client's subscription row. Kept separate from createCheckout
 * so the "who actually gets charged" trust boundary is the webhook, not
 * the client-facing checkout-start call. */
async function applySubscriptionUpdate(clientId, { plan, status, provider, provider_ref, current_period_end }) {
  const { data, error } = await supabase.from('crm_subscriptions').upsert({
    client_id: clientId, plan, status, provider, provider_ref, current_period_end, updated_at: new Date().toISOString(),
  }, { onConflict: 'client_id' }).select().single();
  if (error) throw new Error(error.message);
  return data;
}

module.exports = { getSubscription, createCheckout, applySubscriptionUpdate };
