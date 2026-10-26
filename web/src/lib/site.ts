import site from '../data/site.json';
import services from '../data/services.json';
import localities from '../data/localities.json';

export { site, services, localities };

export type Service = (typeof services)[number];
export type Locality = (typeof localities)[number];

/** Form "I want to" options. Values double as the lead type tag in the enquiry email. */
export const INTENTS = [
  { value: 'buy', label: 'Buy', leadType: 'buyer' },
  { value: 'sell', label: 'Sell', leadType: 'seller' },
  { value: 'rent', label: 'Rent or let out', leadType: 'rental' },
  { value: 'invest', label: 'Invest', leadType: 'investor' },
] as const;
export type Intent = (typeof INTENTS)[number]['value'];

export const telHref = `tel:${site.phone.e164}`;

/**
 * WhatsApp deep link with a pre-filled message naming the page,
 * e.g. "Hi, I'm interested in selling a property (from: Sell page)".
 */
export function waHref(interest: string, pageName: string): string {
  const text = `Hi, I'm interested in ${interest} (from: ${pageName})`;
  return `https://wa.me/${site.phone.whatsapp}?text=${encodeURIComponent(text)}`;
}

export const localityNames = localities.map((l) => l.name);
