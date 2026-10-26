import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import Icon from './Icon';
import './EnquiryForm.css';

type Intent = 'buy' | 'sell' | 'rent' | 'invest';

const INTENTS: { value: Intent; label: string; leadType: string }[] = [
  { value: 'buy', label: 'Buy', leadType: 'buyer' },
  { value: 'sell', label: 'Sell', leadType: 'seller' },
  { value: 'rent', label: 'Rent or let out', leadType: 'rental' },
  { value: 'invest', label: 'Invest', leadType: 'investor' },
];

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const;
const UTM_STORE = 'ashiyana_utm';

type Props = {
  /** Pre-set "I want to" */
  intent?: Intent;
  /** Pre-set locality (locality pages) */
  locality?: string;
  localities: string[];
  telHref: string;
  waHref: string;
  phoneDisplay: string;
  heading?: string;
  requirementPlaceholder?: string;
  endpoint?: string;
  /** Heading level for the form title, so the page outline has no gaps */
  headingLevel?: "h2" | "h3";
  /** "sheet": landing-page requirement sheet (intent tiles first, own button wording, stamped confirmation) */
  variant?: 'default' | 'sheet';
};

const INTENT_ICONS: Record<string, string> = { buy: 'home', sell: 'tag', rent: 'key', invest: 'trending' };

type Status = 'idle' | 'sending' | 'success' | 'error';
type Errors = Partial<Record<'name' | 'phone' | 'intent', string>>;

/** Accepts 98xxxxxxxx, +91 98xxx xxxxx, 098xxxxxxxx. Returns the 10-digit number or null. */
export function normalisePhone(raw: string): string | null {
  let d = raw.replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

/** UTM tags from this URL, or from the landing page earlier in the session. */
function readUtm(): Record<string, string> {
  const fromUrl: Record<string, string> = {};
  const params = new URLSearchParams(window.location.search);
  for (const k of UTM_KEYS) {
    const v = params.get(k);
    if (v) fromUrl[k] = v.slice(0, 100);
  }
  try {
    if (Object.keys(fromUrl).length) {
      sessionStorage.setItem(UTM_STORE, JSON.stringify(fromUrl));
      return fromUrl;
    }
    return JSON.parse(sessionStorage.getItem(UTM_STORE) || '{}');
  } catch {
    return fromUrl;
  }
}

export default function EnquiryForm({
  intent: presetIntent,
  locality: presetLocality = '',
  localities,
  telHref,
  waHref,
  phoneDisplay,
  heading = 'Tell us what you need',
  requirementPlaceholder = 'e.g. 3 BHK, ready to move, under ₹3 Cr',
  endpoint = '/api/enquiry',
  headingLevel: H = 'h3',
  variant = 'default',
}: Props) {
  const sheet = variant === 'sheet';
  const uid = useId();
  const [status, setStatus] = useState<Status>('idle');
  const [errors, setErrors] = useState<Errors>({});
  const [utm, setUtm] = useState<Record<string, string>>({});
  const [sentName, setSentName] = useState('');
  const doneRef = useRef<HTMLDivElement>(null);

  useEffect(() => setUtm(readUtm()), []);

  // Confirmation: bring it into view and move focus to it, so it's seen on a phone and announced by screen readers
  useEffect(() => {
    if (status !== 'success' || !doneRef.current) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    doneRef.current.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    doneRef.current.focus({ preventScroll: true });
  }, [status]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const name = String(data.get('name') || '').trim();
    const phone = normalisePhone(String(data.get('phone') || ''));
    const intent = String(data.get('intent') || '') as Intent;

    const next: Errors = {};
    if (name.length < 2) next.name = 'Please enter your name.';
    if (!phone) next.phone = 'Please enter a 10-digit Indian mobile number.';
    if (!INTENTS.some((i) => i.value === intent)) next.intent = 'Please choose what you want to do.';
    setErrors(next);
    if (Object.keys(next).length) {
      const first = Object.keys(next)[0];
      form.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
      return;
    }

    const locality = String(data.get('locality') || '');
    const payload = {
      name,
      phone,
      intent,
      locality,
      requirement: String(data.get('requirement') || '').trim().slice(0, 1000),
      sourcePage: window.location.pathname,
      pageTitle: document.title,
      utm,
      submittedAt: new Date().toISOString(),
      website: String(data.get('website') || ''), // honeypot
    };

    setStatus('sending');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setSentName(name.split(' ')[0]);
      setStatus('success');
      window.dispatchEvent(
        new CustomEvent('ashiyana:lead', {
          detail: { intent, lead_type: INTENTS.find((i) => i.value === intent)?.leadType, locality },
        }),
      );
    } catch {
      setStatus('error');
    } finally {
      clearTimeout(timer);
    }
  }

  if (status === 'success') {
    return (
      <div className={`ef ef--done${sheet ? ' ef--sheet' : ''}`} role="status" ref={doneRef} tabIndex={-1}>
        {sheet && <span className="ef__stamp" aria-hidden="true">Received</span>}
        <span className="ef__done-icon">
          <Icon name="check" size={28} />
        </span>
        <H className="heading-lg">Thank you{sentName ? `, ${sentName}` : ''}</H>
        <p>Thanks, we've received your enquiry and will call you back between 9:30 am and 6:30 pm.</p>
        <ol className="ef__next">
          <li>A member of our Kothrud team calls you on the number you gave.</li>
          <li>We talk through your requirement, usually in about 10 minutes.</li>
          <li>We send you options or the next step on WhatsApp.</li>
        </ol>
        <p className="ef__now">
          Can't wait? <a href={waHref} target="_blank" rel="noopener" data-cta="form-success">WhatsApp us now</a> or call{' '}
          <a href={telHref} data-cta="form-success" className="num">
            {phoneDisplay}
          </a>
          .
        </p>
      </div>
    );
  }

  const err = (k: keyof Errors) =>
    errors[k] ? (
      <span className="ef__err" id={`${uid}-${k}-err`}>
        {errors[k]}
      </span>
    ) : null;

  const intentField = (
    <fieldset className="ef__field ef__intent" aria-invalid={!!errors.intent}>
      <legend>
        I want to <span aria-hidden="true">*</span>
      </legend>
      <div className={sheet ? 'ef__pills ef__tiles' : 'ef__pills'}>
        {INTENTS.map((i) => (
          <label key={i.value} className="ef__pill">
            <input type="radio" name="intent" value={i.value} defaultChecked={presetIntent === i.value} required />
            <span>
              {sheet && <Icon name={INTENT_ICONS[i.value]} size={22} />}
              {i.label}
            </span>
          </label>
        ))}
      </div>
      {err('intent')}
    </fieldset>
  );

  return (
    <form className={sheet ? 'ef ef--sheet' : 'ef'} onSubmit={onSubmit} noValidate aria-labelledby={`${uid}-h`}>
      <H className="heading-lg ef__h" id={`${uid}-h`}>
        {heading}
      </H>
      <p className="ef__sub">{sheet ? 'Fill in the sheet. We call you back, usually the same day.' : "We'll call you back. No spam, no obligation."}</p>

      <div className="ef__grid">
        {sheet && intentField}
        <label className="ef__field">
          <span>
            Name <span aria-hidden="true">*</span>
          </span>
          <input
            name="name"
            autoComplete="name"
            required
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? `${uid}-name-err` : undefined}
          />
          {err('name')}
        </label>

        <label className="ef__field">
          <span>
            Mobile number <span aria-hidden="true">*</span>
          </span>
          <input
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            placeholder="10-digit mobile"
            required
            aria-invalid={!!errors.phone}
            aria-describedby={errors.phone ? `${uid}-phone-err` : undefined}
          />
          {err('phone')}
        </label>

        {!sheet && intentField}

        <label className="ef__field">
          <span>
            Locality <span className="ef__opt">(optional)</span>
          </span>
          <select name="locality" defaultValue={presetLocality}>
            <option value="">Any / not sure</option>
            {localities.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
            <option value="Other">Other area</option>
          </select>
        </label>

        <label className="ef__field ef__full">
          <span>
            Your requirement <span className="ef__opt">(optional)</span>
          </span>
          <textarea name="requirement" rows={3} maxLength={1000} placeholder={requirementPlaceholder} />
        </label>

        {/* Honeypot: hidden from people and assistive tech, bots tend to fill it */}
        <div className="ef__hp" aria-hidden="true">
          <label>
            Website
            <input name="website" tabIndex={-1} autoComplete="off" />
          </label>
        </div>
      </div>

      {status === 'error' && (
        <div className="ef__fail" role="alert">
          <p>
            <strong>Sorry, your enquiry didn't go through.</strong> Please call or WhatsApp us and we'll help right
            away.
          </p>
          <div className="btn-row">
            <a className="btn btn--outline btn--sm" href={telHref} data-cta="form-error">
              <Icon name="phone" size={18} /> <span className="num">{phoneDisplay}</span>
            </a>
            <a className="btn btn--whatsapp btn--sm" href={waHref} target="_blank" rel="noopener" data-cta="form-error">
              <Icon name="whatsapp" size={18} /> WhatsApp
            </a>
          </div>
        </div>
      )}

      <button className="btn btn--primary ef__submit" type="submit" disabled={status === 'sending'}>
        {status === 'sending' ? 'Sending…' : sheet ? 'Book my requirement call →' : 'Send enquiry'}
      </button>
      <p className="ef__fine">
        By sending, you agree to be contacted about your enquiry. See our <a href="/privacy">privacy policy</a>.
      </p>
    </form>
  );
}
