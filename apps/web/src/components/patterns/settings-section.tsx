import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { type ToneKey } from '@/lib/variants';
import { cn } from '@/lib/utils';

import { FeatureStatusMarker, type FeatureStatus } from './feature-status-marker';

/**
 * The standard settings card header: a small inline leading icon + title +
 * optional draft marker + optional description, with a header-right `actions`
 * slot and a hairline divider below. The icon is rendered INLINE (small, muted)
 * — deliberately NOT the `SoftSquareIcon` chip the rows use — so a section
 * header never reads as just another toggle row. The divider + the header's own
 * padding give the body clear breathing room.
 *
 * @useWhen heading a settings Card with an inline icon + title + optional draft marker + description
 */
export interface SettingsCardHeaderProps {
  title: string;
  description?: string;
  /** Small inline leading icon element (e.g. `<DOMAIN_ICONS.password />`). Rendered muted, no chip. */
  icon?: React.ReactNode;
  /** Kept for API symmetry with rows; the header icon is always muted, so this is unused. */
  iconTone?: ToneKey;
  /** Draft marker next to the title. Omit for a fully-wired section. */
  status?: FeatureStatus;
  /** Header-right slot (secondary action, link, badge). */
  actions?: React.ReactNode;
  className?: string;
}

export function SettingsCardHeader({
  title,
  description,
  icon,
  status,
  actions,
  className,
}: SettingsCardHeaderProps): React.ReactElement {
  return (
    <CardHeader
      actions={actions}
      className={cn('border-border pt-md pb-md mb-md border-b', className)}
    >
      <div className="gap-2xs flex min-w-0 flex-col">
        <div className="gap-xs flex items-center">
          {icon !== undefined ? (
            <span
              aria-hidden
              className="text-muted-foreground [&_svg]:size-icon-sm flex shrink-0 items-center"
            >
              {icon}
            </span>
          ) : null}
          <CardTitle>{title}</CardTitle>
          {status !== undefined ? <FeatureStatusMarker status={status} variant="badge" /> : null}
        </div>
        {description !== undefined ? <CardDescription>{description}</CardDescription> : null}
      </div>
    </CardHeader>
  );
}

/**
 * Consistent contextual aside card for the 1/3 column: an inline icon + title
 * header over a body slot, with one fixed internal rhythm. Standardizes the
 * padding and gaps so the right-hand cards never read as unevenly spaced next
 * to the main column. The body styles itself — pass muted helper text, a
 * key/value list, or logos as children.
 *
 * @useWhen rendering a contextual/info/summary card in a settings page aside column
 */
export function SettingsAsideCard({
  title,
  icon,
  children,
  className,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <Card className={className}>
      <CardContent className="gap-sm pt-lg flex flex-col">
        <div className="gap-xs flex items-center">
          {icon !== undefined ? (
            <span
              aria-hidden
              className="text-muted-foreground [&_svg]:size-icon-sm flex shrink-0 items-center"
            >
              {icon}
            </span>
          ) : null}
          <span className="text-foreground text-sm font-semibold">{title}</span>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

/**
 * Standard scaffold for a single (non-form) settings block: a Card with a
 * `SettingsCardHeader` and a content area, plus an optional footer strip. For a
 * block whose card wraps a `<form>`, compose a raw `<Card>` with
 * `SettingsCardHeader` directly so the form can span content + footer.
 *
 * @useWhen grouping related settings controls under one titled, surfaced block on a /settings page
 */
export interface SettingsSectionProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  iconTone?: ToneKey;
  /** Marks the block as not-yet-wired; shows the dev-only draft marker. */
  status?: FeatureStatus;
  actions?: React.ReactNode;
  /** Trailing divided strip — typically the primary save button. */
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function SettingsSection({
  title,
  description,
  icon,
  status,
  actions,
  footer,
  children,
  className,
}: SettingsSectionProps): React.ReactElement {
  return (
    <Card className={className}>
      <SettingsCardHeader
        title={title}
        description={description}
        icon={icon}
        status={status}
        actions={actions}
      />
      <CardContent className="pt-lg">{children}</CardContent>
      {footer !== undefined ? <CardFooter className="justify-end">{footer}</CardFooter> : null}
    </Card>
  );
}
