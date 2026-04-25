'use client';

import { ArrowDown01Icon, Building03Icon, PlusSignIcon, Tick01Icon } from 'hugeicons-react';
import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { setActiveOrgIdAction } from '@/lib/active-org-actions';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';

import type { Organization } from '../api/organizations.api';

import { CreateOrganizationModal } from './create-organization-modal';

export interface OrgSwitcherProps {
  orgs: Organization[];
  activeOrgId?: string | undefined;
}

export function OrgSwitcher({ orgs, activeOrgId }: OrgSwitcherProps): React.ReactElement {
  const t = useTranslations('organizations.switcher');
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [modalOpen, setModalOpen] = React.useState(false);

  const active = orgs.find((o) => o.id === activeOrgId) ?? orgs[0];
  const initial = useMemo(() => active?.name.charAt(0).toUpperCase() ?? '', [active]);

  async function handleSelect(orgId: string): Promise<void> {
    setOpen(false);
    if (orgId === activeOrgId) return;
    await setActiveOrgIdAction(orgId);
    router.refresh();
  }

  if (!active) {
    // Edge case: no orgs. The RSC guard redirects to onboarding before
    // the shell renders, so this is only reachable during the brief
    // window of a page transition. Render a neutral placeholder rather
    // than crashing.
    return <div className="h-9 w-full" aria-hidden />;
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={t('trigger')}
            className={cn(
              'gap-xs px-xs py-3xs duration-fast text-muted-foreground hover:bg-muted hover:text-foreground flex w-full items-center rounded-md text-left text-xs transition-colors',
              'focus-visible:outline-none',
            )}
          >
            <span
              aria-hidden="true"
              className="bg-muted text-muted-foreground text-2xs flex size-5 shrink-0 items-center justify-center rounded-sm font-semibold uppercase"
            >
              {initial}
            </span>
            <span className="min-w-0 flex-1 truncate font-medium">{active.name}</span>
            <ArrowDown01Icon className="size-3 shrink-0" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-0">
          <Command>
            <CommandInput placeholder={t('placeholder')} />
            <CommandList>
              <CommandEmpty>{t('empty')}</CommandEmpty>
              <CommandGroup heading={t('heading')}>
                {orgs.map((org) => (
                  <CommandItem
                    key={org.id}
                    value={`${org.name} ${org.slug}`}
                    onSelect={() => void handleSelect(org.id)}
                  >
                    <Building03Icon className="size-icon-sm text-muted-foreground" />
                    <div className="flex flex-1 flex-col leading-tight">
                      <span className="font-medium">{org.name}</span>
                      <span className="text-2xs text-muted-foreground font-mono">{org.slug}</span>
                    </div>
                    {org.id === active.id ? (
                      <Tick01Icon className="size-icon-sm text-muted-foreground" />
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup>
                <CommandItem
                  onSelect={() => {
                    setOpen(false);
                    setModalOpen(true);
                  }}
                >
                  <PlusSignIcon className="size-icon-sm text-muted-foreground" />
                  {t('createNew')}
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <CreateOrganizationModal open={modalOpen} onOpenChange={setModalOpen} />
    </>
  );
}
