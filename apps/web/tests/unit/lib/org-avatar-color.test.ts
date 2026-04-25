import { describe, expect, it } from 'vitest';

import { getOrgAvatarPalette, type OrgAvatarPalette } from '@/lib/org-avatar-color';

describe('getOrgAvatarPalette', () => {
  it('aynı orgId her çağrıda aynı palette index üretir', () => {
    const id = 'org_abc123';
    expect(getOrgAvatarPalette(id)).toBe(getOrgAvatarPalette(id));
  });

  it("farklı orgId'ler genelde farklı palette üretir", () => {
    const palettes = new Set<OrgAvatarPalette>();
    for (let i = 0; i < 100; i++) {
      palettes.add(getOrgAvatarPalette(`org_${i}`));
    }
    // 100 random id'de en az 4 farklı palette beklenir (6 paletten)
    expect(palettes.size).toBeGreaterThanOrEqual(4);
  });

  it('boş veya tek karakter string için bile geçerli palette döner', () => {
    const valid: OrgAvatarPalette[] = [
      'primary',
      'success',
      'warning',
      'info',
      'destructive',
      'accent',
    ];
    expect(valid).toContain(getOrgAvatarPalette(''));
    expect(valid).toContain(getOrgAvatarPalette('a'));
  });

  it('Türkçe karakter içeren orgId için crash etmez', () => {
    expect(() => getOrgAvatarPalette('org_İstanbul_Şirketi')).not.toThrow();
  });
});
