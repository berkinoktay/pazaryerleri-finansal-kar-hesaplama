'use client';

import { CodeIcon, PackageIcon, Search01Icon } from 'hugeicons-react';
import * as React from 'react';

import manifest from '@/../components.manifest.json';
import { KpiTile } from '@/components/patterns/kpi-tile';
import { PageHeader } from '@/components/patterns/page-header';
import { StatGroup } from '@/components/patterns/stat-group';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';

interface ManifestEntry {
  name: string;
  path: string;
  category: 'atom' | 'molecule';
  status: 'stable' | 'experimental' | 'deprecated';
  useWhen?: string;
}

interface ManifestRoot {
  version: number;
  count: number;
  components: ManifestEntry[];
}

const TYPED_MANIFEST = manifest as ManifestRoot;
const ENTRIES: ManifestEntry[] = TYPED_MANIFEST.components;

const CATEGORY_LABEL: Record<ManifestEntry['category'], string> = {
  atom: 'Atom',
  molecule: 'Pattern',
};

const STATUS_TONE: Record<ManifestEntry['status'], 'success' | 'warning' | 'destructive'> = {
  stable: 'success',
  experimental: 'warning',
  deprecated: 'destructive',
};

const STATUS_LABEL: Record<ManifestEntry['status'], string> = {
  stable: 'stable',
  experimental: 'experimental',
  deprecated: 'deprecated',
};

type CategoryFilter = 'all' | 'atom' | 'molecule';

function matches(entry: ManifestEntry, query: string): boolean {
  if (query.trim() === '') return true;
  const lower = query.trim().toLowerCase();
  return (
    entry.name.toLowerCase().includes(lower) ||
    entry.path.toLowerCase().includes(lower) ||
    (entry.useWhen?.toLowerCase().includes(lower) ?? false)
  );
}

export default function ManifestPage(): React.ReactElement {
  const [query, setQuery] = React.useState('');
  const [filter, setFilter] = React.useState<CategoryFilter>('all');

  const counts = React.useMemo(() => {
    let atoms = 0;
    let molecules = 0;
    for (const entry of ENTRIES) {
      if (entry.category === 'atom') atoms += 1;
      else molecules += 1;
    }
    return { atoms, molecules };
  }, []);

  const filtered = React.useMemo(() => {
    return ENTRIES.filter(
      (entry) => (filter === 'all' || entry.category === filter) && matches(entry, query),
    );
  }, [filter, query]);

  const grouped = React.useMemo(() => {
    const groups: Record<string, ManifestEntry[]> = {};
    for (const entry of filtered) {
      const key = CATEGORY_LABEL[entry.category];
      if (groups[key] === undefined) groups[key] = [];
      groups[key].push(entry);
    }
    for (const key of Object.keys(groups)) {
      groups[key].sort((a, b) => a.name.localeCompare(b.name));
    }
    return groups;
  }, [filtered]);

  return (
    <>
      <PageHeader
        title="Manifest"
        intent={`PazarSync design sisteminin canlı kataloğu — ${TYPED_MANIFEST.count} bileşen, build sırasında components.manifest.json'a yazılır. Her bileşen kendi @useWhen ipucunu taşır.`}
      />

      <StatGroup>
        <KpiTile
          label="Toplam"
          value={{ kind: 'count', amount: TYPED_MANIFEST.count }}
          context="patterns/ + ui/ altında stable"
        />
        <KpiTile
          label="Atomlar"
          value={{ kind: 'count', amount: counts.atoms }}
          context="shadcn primitive üstünde"
        />
        <KpiTile
          label="Patternler"
          value={{ kind: 'count', amount: counts.molecules }}
          context="PazarSync özel composite"
        />
      </StatGroup>

      <div className="gap-md flex flex-col">
        <div className="gap-sm flex flex-wrap items-center justify-between">
          <Input
            type="text"
            inputMode="search"
            placeholder="Ada, dosya yoluna veya @useWhen'e göre filtrele…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            leadingIcon={<Search01Icon />}
            onClear={query.length > 0 ? () => setQuery('') : undefined}
            clearLabel="Temizle"
            className="max-w-input flex-1"
          />
          <ToggleGroup
            type="single"
            value={filter}
            onValueChange={(value) => {
              if (value === 'all' || value === 'atom' || value === 'molecule') {
                setFilter(value);
              }
            }}
            aria-label="Kategori filtresi"
          >
            <ToggleGroupItem value="all">Tümü</ToggleGroupItem>
            <ToggleGroupItem value="atom">Atomlar</ToggleGroupItem>
            <ToggleGroupItem value="molecule">Patternler</ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className="text-2xs text-muted-foreground tabular-nums">
          {filtered.length} / {TYPED_MANIFEST.count} bileşen
        </div>
      </div>

      {Object.keys(grouped).length === 0 ? (
        <div className="border-border bg-card p-xl gap-sm flex flex-col items-center rounded-md border text-center">
          <span className="bg-muted text-muted-foreground [&_svg]:size-icon flex size-12 items-center justify-center rounded-full">
            <PackageIcon aria-hidden />
          </span>
          <span className="text-foreground text-md font-semibold">Sonuç yok</span>
          <span className="text-2xs text-muted-foreground">
            Aramayı sadeleştir veya kategori filtresini sıfırla.
          </span>
        </div>
      ) : (
        Object.entries(grouped).map(([category, items]) => (
          <section key={category} className="gap-md flex flex-col">
            <div className="gap-xs flex items-baseline">
              <h2 className="text-foreground text-lg font-semibold tracking-tight">{category}</h2>
              <span className="text-2xs text-muted-foreground tabular-nums">{items.length}</span>
            </div>
            <div className="gap-sm grid sm:grid-cols-2 lg:grid-cols-3">
              {items.map((entry) => (
                <ManifestCard key={entry.path} entry={entry} />
              ))}
            </div>
          </section>
        ))
      )}
    </>
  );
}

function ManifestCard({ entry }: { entry: ManifestEntry }): React.ReactElement {
  return (
    <article
      className={cn('border-border bg-card p-md gap-xs flex flex-col rounded-md border shadow-xs')}
    >
      <div className="gap-xs flex items-start justify-between">
        <h3 className="text-foreground text-md font-semibold tracking-tight">{entry.name}</h3>
        <Badge tone={STATUS_TONE[entry.status]}>{STATUS_LABEL[entry.status]}</Badge>
      </div>
      <div className="gap-xs flex items-center">
        <CodeIcon className="size-icon-sm text-muted-foreground shrink-0" aria-hidden />
        <code className="text-2xs text-muted-foreground truncate font-mono">{entry.path}</code>
      </div>
      {entry.useWhen !== undefined ? (
        <p className="text-muted-foreground text-sm leading-snug">{entry.useWhen}</p>
      ) : (
        <p className="text-2xs text-warning">@useWhen JSDoc tag&apos;ı eksik</p>
      )}
    </article>
  );
}
