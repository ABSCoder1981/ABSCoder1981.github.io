import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import Icon from './Icon';

type Props = {
  name: string;
  localities: string[];
  defaultValue?: string;
  labelId: string;
};

/**
 * Locality picker: a styled listbox in place of the browser's plain <select>.
 * The value is submitted through a hidden input with the same name. Keyboard: Enter / Space / arrows
 * open it, arrows move, Enter selects, Escape closes, typing a letter jumps to the first match.
 * The panel opens upwards when there is no room below (sections are one screen tall).
 */
export default function LocalityPicker({ name, localities, defaultValue = '', labelId }: Props) {
  const options = [{ value: '', label: 'Any / not sure' }, ...localities.map((l) => ({ value: l, label: l })), { value: 'Other', label: 'Other area' }];
  const initial = Math.max(0, options.findIndex((o) => o.value === defaultValue));
  const [selected, setSelected] = useState(initial);
  const [active, setActive] = useState(initial);
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const show = () => {
    const r = button.current!.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    setUp(below < 300 && r.top > below);
    setActive(selected);
    setOpen(true);
  };
  const choose = (i: number) => {
    setSelected(i);
    setOpen(false);
    button.current?.focus();
  };

  // close on outside click
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  // keep the highlighted option in view
  useEffect(() => {
    if (open) list.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const last = options.length - 1;
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        show();
      }
      return;
    }
    if (e.key === 'ArrowDown') setActive((a) => Math.min(last, a + 1));
    else if (e.key === 'ArrowUp') setActive((a) => Math.max(0, a - 1));
    else if (e.key === 'Home') setActive(0);
    else if (e.key === 'End') setActive(last);
    else if (e.key === 'Enter' || e.key === ' ') choose(active);
    else if (e.key === 'Escape') setOpen(false);
    else if (e.key === 'Tab') {
      setOpen(false);
      return;
    } else if (e.key.length === 1) {
      const k = e.key.toLowerCase();
      const hit = options.findIndex((o, i) => i > active && o.label.toLowerCase().startsWith(k));
      const first = options.findIndex((o) => o.label.toLowerCase().startsWith(k));
      if (hit >= 0 || first >= 0) setActive(hit >= 0 ? hit : first);
    } else return;
    e.preventDefault();
  };

  return (
    <div className={`lp${open ? ' is-open' : ''}${up ? ' is-up' : ''}`} ref={root}>
      <input type="hidden" name={name} value={options[selected].value} />
      <button
        type="button"
        ref={button}
        className="lp__btn"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-labelledby={labelId}
        aria-activedescendant={open ? `${id}-o${active}` : undefined}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKey}
      >
        <Icon name="pin" size={18} className="lp__pin" />
        <span className={`lp__value${selected === 0 ? ' is-empty' : ''}`}>{options[selected].label}</span>
        <Icon name="chevron" size={18} className="lp__chev" />
      </button>
      <ul className="lp__list" id={`${id}-list`} role="listbox" aria-labelledby={labelId} ref={list} hidden={!open}>
        {options.map((o, i) => (
          <li
            key={o.value || 'any'}
            id={`${id}-o${i}`}
            role="option"
            aria-selected={i === selected}
            className={`lp__opt${i === active ? ' is-active' : ''}${i === 0 || i === options.length - 1 ? ' is-muted' : ''}`}
            onPointerEnter={() => setActive(i)}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => choose(i)}
          >
            <span>{o.label}</span>
            {i === selected && <Icon name="check" size={16} />}
          </li>
        ))}
      </ul>
    </div>
  );
}
