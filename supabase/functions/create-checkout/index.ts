// supabase/functions/create-checkout/index.ts
//
// Supabase Edge Function — Creates Stripe Checkout Sessions & Portal URLs.
// Deploy with: supabase functions deploy create-checkout
//
// Required secrets (set via `supabase secrets set`):
//   STRIPE_SECRET_KEY     — Stripe API secret key
//   STRIPE_PRICE_MONTHLY  — Stripe Price ID for monthly plan
//   STRIPE_PRICE_ANNUAL   — Stripe Price ID for annual plan
//   STRIPE_WEBHOOK_SECRET — Stripe webhook signing secret

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@13?target=deno';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2023-10-16' });

const PRICE_MAP: Record<string, string> = {
  pro_monthly: Deno.env.get('STRIPE_PRICE_MONTHLY')!,
  pro_annual: Deno.env.get('STRIPE_PRICE_ANNUAL')!,
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Verify Supabase JWT
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing auth' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();

    // --- Billing Portal ---
    if (body.action === 'portal') {
      // Look up Stripe customer ID from profile
      const { data: profile } = await supabase
        .from('profiles')
        .select('stripe_customer_id')
        .eq('id', user.id)
        .single();

      if (!profile?.stripe_customer_id) {
        return new Response(JSON.stringify({ error: 'No subscription found' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const session = await stripe.billingPortal.sessions.create({
        customer: profile.stripe_customer_id,
        return_url: `${req.headers.get('origin') || 'chrome-extension://'}`,
      });

      return new Response(JSON.stringify({ url: session.url }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // --- Checkout Session ---
    const { planId } = body;
    const priceId = PRICE_MAP[planId];
    if (!priceId) {
      return new Response(JSON.stringify({ error: `Unknown plan: ${planId}` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Find or create Stripe customer
    let customerId: string;
    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .single();

    if (profile?.stripe_customer_id) {
      customerId = profile.stripe_customer_id;
    } else {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { supabase_uid: user.id },
      });
      customerId = customer.id;

      await supabase
        .from('profiles')
        .update({ stripe_customer_id: customerId })
        .eq('id', user.id);
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${req.headers.get('origin') || 'chrome-extension://'}?checkout=success`,
      cancel_url: `${req.headers.get('origin') || 'chrome-extension://'}?checkout=cancel`,
      subscription_data: {
        metadata: { supabase_uid: user.id, plan: planId },
      },
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Checkout error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
