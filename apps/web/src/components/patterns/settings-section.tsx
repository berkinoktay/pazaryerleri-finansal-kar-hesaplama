import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { SoftSquareIcon } from '@/components/ui/soft-square-icon';
import { type ToneKey } from '@/lib/variants';

import { FeatureStatusMarker, type FeatureStatus } from './feature-status-marker';

/**
 * The standard settings card header: an optional leading icon chip (the
 * `SoftSquareIcon` vocabulary, fed from `@/lib/domain-icons`) + title +
 * optional draft marker + optional description, with a header-right `actions`
 * slot. Use this INSIDE a raw `<Card>` when the card wraps a `<form>` (so the
 * form can span content + footer); use `SettingsSection` for the simpler
 * non-form case. The icon chip is what makes a section read as a "panel"
 * rather than a wall of text.
 *
 * @useWhen heading a settings Card with an icon chip + title + optional draft marker + description
 */
export interface SettingsCardHeaderProps {
  title: string;
  description?: string;
  /** Leading icon element (e.g. `<DOMAIN_ICONS.password />`), shown in a soft chip before the title. */
  icon?: React.ReactNode;
  /** Tone of the icon chip. Default `neutral`; use a semantic tone only when the section carries that meaning. */
  iconTone?: ToneKey;
  /** Draft marker next to the title. Omit for a fully-wired section. */
  status?: FeatureStatus;
  /** Header-right slot (secondary action, link, badge). */
  actions?: React.ReactNode;
}

export function SettingsCardHeader({
  title,
  description,
  icon,
  iconTone = 'neutral',
  status,
  actions,
}: SettingsCardHeaderProps): React.ReactElement {
  return (
    <CardHeader actions={actions}>
      <div className="gap-sm flex items-start">
        {icon !== undefined ? (
          <SoftSquareIcon variant="soft" tone={iconTone}>
            {icon}
          </SoftSquareIcon>
        ) : null}
        <div className="gap-3xs flex min-w-0 flex-col">
          <div className="gap-xs flex items-center">
            <CardTitle>{title}</CardTitle>
            {status !== undefined ? <FeatureStatusMarker status={status} variant="badge" /> : null}
          </div>
          {description !== undefined ? <CardDescription>{description}</CardDescription> : null}
        </div>
      </div>
    </CardHeader>
  );
}

/**
 * Standard scaffold for a single (non-form) settings block: a Card with a
 * `SettingsCardHeader` and a content area, plus an optional footer strip. For
 * a block whose card wraps a `<form>`, compose a raw `<Card>` with
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
  iconTone = 'neutral',
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
        iconTone={iconTone}
        status={status}
        actions={actions}
      />
      <CardContent>{children}</CardContent>
      {footer !== undefined ? <CardFooter className="justify-end">{footer}</CardFooter> : null}
    </Card>
  );
}
