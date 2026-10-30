import Stripe from 'stripe';
import { config } from '../../config.js';

let stripe: Stripe | null = null;
export function getStripe(): Stripe {
  if (!config.STRIPE_SECRET_KEY) throw new Error('Stripe is not configured');
  stripe ??= new Stripe(config.STRIPE_SECRET_KEY);
  return stripe;
}
