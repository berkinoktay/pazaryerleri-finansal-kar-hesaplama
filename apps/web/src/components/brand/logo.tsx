import { cn } from '@/lib/utils';

export interface LogoProps extends React.SVGAttributes<SVGSVGElement> {
  size?: 'sm' | 'md' | 'lg';
}

/**
 * PazarSync mark. Geometric P + S composite suggesting flow/sync between
 * two surfaces (marketplaces → ledger). Single-color so it inherits from
 * `currentColor` and reads correctly on any background, dark or light.
 */
export function Logo({ className, size = 'md', ...props }: LogoProps): React.ReactElement {
  const px = size === 'sm' ? 20 : size === 'lg' ? 28 : 24;
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('text-primary', className)}
      aria-label="PazarSync"
      {...props}
    >
      <path
        d="M4 4h8a5 5 0 0 1 0 10H4V4Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M20 20H12a5 5 0 0 1 0-10"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </svg>
  );
}
