import { describe, expect, it } from 'vitest';

import { rewriteHugeiconsImports } from '../../tooling/hugeicons-imports-plugin';

describe('rewriteHugeiconsImports', () => {
  it('returns null when the module does not import hugeicons-react', () => {
    expect(rewriteHugeiconsImports(`import { useState } from 'react';`)).toBeNull();
  });

  it('rewrites a single named import to its per-icon virtual module', () => {
    expect(rewriteHugeiconsImports(`import { Home01Icon } from 'hugeicons-react';`)).toBe(
      `import { Home01Icon } from 'virtual:hugeicon/Home01Icon';`,
    );
  });

  it('splits several specifiers into one import each and keeps local aliases', () => {
    expect(
      rewriteHugeiconsImports(
        `import { Home01Icon, Search01Icon as SearchIcon } from "hugeicons-react";`,
      ),
    ).toBe(
      `import { Home01Icon } from 'virtual:hugeicon/Home01Icon'; ` +
        `import { Search01Icon as SearchIcon } from 'virtual:hugeicon/Search01Icon';`,
    );
  });

  it('keeps the line count of a multi-line import so stack traces do not shift', () => {
    const source = `import {\n  Home01Icon,\n  Search01Icon,\n} from 'hugeicons-react';\nconst x = 1;`;
    const rewritten = rewriteHugeiconsImports(source);
    expect(rewritten?.split('\n')).toHaveLength(source.split('\n').length);
    expect(rewritten?.endsWith('const x = 1;')).toBe(true);
    expect(rewritten).toContain(`from 'virtual:hugeicon/Search01Icon'`);
  });

  it('rewrites every hugeicons-react import in the module', () => {
    const source = `import { AIcon } from 'hugeicons-react';\nimport { BIcon } from 'hugeicons-react';`;
    expect(rewriteHugeiconsImports(source)).toBe(
      `import { AIcon } from 'virtual:hugeicon/AIcon';\nimport { BIcon } from 'virtual:hugeicon/BIcon';`,
    );
  });

  it('leaves a statement untouched when a specifier is not an icon component', () => {
    const source = `import { Home01Icon, createIconSet } from 'hugeicons-react';`;
    expect(rewriteHugeiconsImports(source)).toBeNull();
  });

  it('does not touch the same text inside an expression or string literal', () => {
    const source = `const example = "import { HomeIcon } from 'hugeicons-react';";`;
    expect(rewriteHugeiconsImports(source)).toBeNull();
  });

  it('ignores deep imports and other packages that only mention the name', () => {
    const source = `import { HomeIcon } from 'hugeicons-react/icons/HomeIcon';\nimport x from 'my-hugeicons-react-fork';`;
    expect(rewriteHugeiconsImports(source)).toBeNull();
  });
});
