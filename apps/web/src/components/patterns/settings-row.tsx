import { SoftSquareIcon } from '@/components/ui/soft-square-icon';
import { type ToneKey } from '@/lib/variants';
import { cn } from '@/lib/utils';

/**
 * A single settings row: an optional leading icon chip, a title (and optional
 * description) on the left, a control (Switch, Select, Button, value, badge) on
 * the right. The icon chip — the existing `SoftSquareIcon` vocabulary, fed from
 * `@/lib/domain-icons` — is what lifts a settings list out of "plain text rows".
 * Stacks vertically below `sm`. Pass `htmlFor` to associate the title with a
 * control's id (renders the title as a real `<label>`).
 *
 * Wrap several rows in `SettingsRowGroup` to get hairline dividers between them.
 *
 * @useWhen laying out a label/description-and-control row inside a settings section (toggles, selects, inline values)
 */
export interface SettingsRowProps {
  title: string;
  description?: string;
  control?: React.ReactNode;
  /** Leading icon element (e.g. `<DOMAIN_ICONS.notifDailySummary />`), shown in a soft chip. */
  icon?: React.ReactNode;
  /** Tone of the icon chip. Default `neutral` (restrained); use a semantic tone only when the row carries that meaning. */
  iconTone?: ToneKey;
  /** Associates the title with a control id (renders the title as a `<label>`). */
  htmlFor?: string;
  className?: string;
}

export function SettingsRow({
  title,
  description,
  control,
  icon,
  iconTone = 'neutral',
  htmlFor,
  className,
}: SettingsRowProps): React.ReactElement {
  const heading = (
    <>
      <span className="text-foreground text-sm font-medium">{title}</span>
      {description !== undefined ? (
        <span className="text-2xs text-muted-foreground">{description}</span>
      ) : null}
    </>
  );

  return (
    <div
      className={cn(
        'gap-md py-md flex flex-col sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <div className="gap-sm flex min-w-0 items-center">
        {icon !== undefined ? (
          <SoftSquareIcon variant="soft" tone={iconTone} shape="circle">
            {icon}
          </SoftSquareIcon>
        ) : null}
        {htmlFor !== undefined ? (
          <label htmlFor={htmlFor} className="gap-3xs flex min-w-0 cursor-pointer flex-col">
            {heading}
          </label>
        ) : (
          <div className="gap-3xs flex min-w-0 flex-col">{heading}</div>
        )}
      </div>
      {control !== undefined ? <div className="shrink-0">{control}</div> : null}
    </div>
  );
}

/**
 * Stacks `SettingsRow`s with hairline dividers between them. Drop it inside a
 * `CardContent`; the negative vertical margin trims the first/last row's own
 * padding so the group sits flush against the card's padding.
 */
export function SettingsRowGroup({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <div className={cn('divide-border-muted -my-md flex flex-col divide-y', className)}>
      {children}
    </div>
  );
}
