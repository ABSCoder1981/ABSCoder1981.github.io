import { useId, useState } from 'react';
import Icon from './Icon';
import './FaqAccordion.css';

type Props = { faqs: { q: string; a: string }[] };

/**
 * FAQ accordion. Answers are server-rendered (hidden with the `hidden` attribute, not removed),
 * so they're in the HTML for search engines and match the FAQPage schema.
 */
export default function FaqAccordion({ faqs }: Props) {
  const id = useId();
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div className="faq">
      {faqs.map((f, i) => {
        const isOpen = open === i;
        return (
          <div className={`faq__item${isOpen ? ' is-open' : ''}`} key={f.q}>
            <h3 className="faq__q">
              <button
                id={`${id}-q${i}`}
                aria-expanded={isOpen}
                aria-controls={`${id}-a${i}`}
                onClick={() => setOpen(isOpen ? null : i)}
              >
                <span>{f.q}</span>
                <Icon name="chevron" size={20} />
              </button>
            </h3>
            <div id={`${id}-a${i}`} role="region" aria-labelledby={`${id}-q${i}`} className="faq__a" hidden={!isOpen}>
              <p>{f.a}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
