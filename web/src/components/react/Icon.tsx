import { iconSvg } from '../../lib/icons';

type Props = { name: string; size?: number; className?: string };

/** React twin of Icon.astro, rendering the same SVG markup. */
export default function Icon({ name, size = 24, className = '' }: Props) {
  return (
    <span
      className="icon"
      style={{ display: 'inline-flex', lineHeight: 0 }}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: iconSvg(name, size, className) }}
    />
  );
}
