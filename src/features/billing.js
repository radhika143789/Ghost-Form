/**
 * billing.js — Ghost Form Phase 6: Stripe Billing Integration
 *
 * Handles Pro subscription checkout and billing portal access.
 * All Stripe interactions go through a Supabase Edge Function
 * to keep the Stripe secret key server-side.
 */

import { SUPABASE_URL } from '../config.js';

const PLANS = {
  pro_monthly: {
    id: 'pro_monthly',
    name: 'Ghost Form Pro — Monthly',
    price: '$4.99/mo',
    interval: 'month',
  },
  pro_annual: {
    id: 'pro_annual',
    name: 'Ghost Form Pro — Annual',
    price: '$39.99/yr',
    interval: 'year',
    savings: '33% savings',
  },
};

/**
 * Returns available billing plans.
 * @returns {Object}
 */
export function getPlans() {
  return PLANS;
}

/**
 * Opens Stripe Checkout for the given plan.
 * Calls the Supabase Edge Function which creates a Checkout Session.
 *
 * @param {'pro_monthly'|'pro_annual'} planId
 * @param {string} accessToken - Supabase JWT
 * @returns {Promise<void>}
 */
export async function openCheckout(planId, accessToken) {
  if (!PLANS[planId]) throw new Error(`Unknown plan: ${planId}`);

  const res = await fetch(`${SUPABASE_URL}/functions/v1/create-checkout`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ planId }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Checkout creation failed: ${res.status} — ${body}`);
  }

  const { url } = await res.json();
  if (!url) throw new Error('No checkout URL returned');

  // Open in a new tab
  if (typeof chrome !== 'undefined' && chrome.tabs) {
    chrome.tabs.create({ url });
  } else {
    window.open(url, '_blank');
  }
}

/**
 * Opens the Stripe Billing Portal for subscription management.
 *
 * @param {string} accessToken - Supabase JWT
 * @returns {Promise<void>}
 */
export async function openBillingPortal(accessToken) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/create-checkout`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'portal' }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Portal creation failed: ${res.status} — ${body}`);
  }

  const { url } = await res.json();
  if (!url) throw new Error('No portal URL returned');

  if (typeof chrome !== 'undefined' && chrome.tabs) {
    chrome.tabs.create({ url });
  } else {
    window.open(url, '_blank');
  }
}
