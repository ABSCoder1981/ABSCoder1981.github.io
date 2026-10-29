import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import './MobileMenu.css';

type Link = { href: string; label: string };
type Props = {
  services: Link[];
  localities: Link[];
  telHref: string;
  waHref: string;
  phoneDisplay: string;
};

export default function MobileMenu({ services, localities, telHref, waHref, phoneDisplay }: Props) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    document.documentElement.style.overflow = open ? 'hidden' : '';
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>('a, button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        ref={toggleRef}
        className="mm-toggle"
        aria-expanded={open}
        aria-controls="mobile-menu"
        aria-label={open ? 'Close menu' : 'Open menu'}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name={open ? 'close' : 'menu'} />
      </button>

      {/* Close after any link is followed (matters for same-page #links and back/forward cache) */}
      <div
        id="mobile-menu"
        ref={panelRef}
        className="mm-panel"
        hidden={!open}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('a')) setOpen(false);
        }}
      >
        <nav aria-label="Mobile">
          <p className="mm-heading">Services</p>
          <ul role="list" className="mm-list">
            {services.map((l) => (
              <li key={l.href}>
                <a href={l.href}>{l.label}</a>
              </li>
            ))}
          </ul>
          <p className="mm-heading">Localities</p>
          <ul role="list" className="mm-list mm-list--grid">
            {localities.map((l) => (
              <li key={l.href}>
                <a href={l.href}>{l.label}</a>
              </li>
            ))}
          </ul>
          <ul role="list" className="mm-list mm-list--main">
            <li>
              <a href="/contact">Contact</a>
            </li>
          </ul>
        </nav>
        <div className="mm-cta">
          <a className="btn btn--outline" href={telHref} data-cta="mobile-menu">
            <Icon name="phone" /> <span className="num">{phoneDisplay}</span>
          </a>
          <a className="btn btn--whatsapp" href={waHref} target="_blank" rel="noopener" data-cta="mobile-menu">
            <Icon name="whatsapp" /> WhatsApp us
          </a>
        </div>
      </div>
    </>
  );
}
