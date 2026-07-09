import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveAdminSectionFromPathname } from './pathnames';

const ADMIN_PAGES_ROOT = join(__dirname, '../../../frontend/app/(admin)/admin');

/** Маршруты, где null — ожидаемо (login без section guard). */
const PATHNAME_NULL_OK = new Set(['/admin/login']);

function listAdminPageFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listAdminPageFiles(full));
    } else if (entry.name === 'page.tsx') {
      out.push(full);
    }
  }
  return out;
}

/** `app/(admin)/admin/.../page.tsx` → `/admin/...` с sample-id вместо `[param]`. */
function pageFileToPathname(filePath: string): string {
  const rel = relative(ADMIN_PAGES_ROOT, filePath).replace(/\\/g, '/');
  if (rel === 'page.tsx') return '/admin';
  const route = rel.replace(/\/page\.tsx$/, '');
  const withSamples = route.replace(/\[[^\]]+\]/g, 'sample-id');
  return `/admin/${withSamples}`.replace(/\/+/g, '/');
}

describe('pathnames coverage (Next admin routes)', () => {
  it('resolves every app/(admin)/admin/**/page.tsx pathname', () => {
    const files = listAdminPageFiles(ADMIN_PAGES_ROOT);
    expect(files.length).toBeGreaterThan(10);

    const unmapped: string[] = [];
    for (const file of files) {
      const pathname = pageFileToPathname(file);
      const section = resolveAdminSectionFromPathname(pathname);
      if (section == null && !PATHNAME_NULL_OK.has(pathname)) {
        unmapped.push(`${pathname} ← ${relative(ADMIN_PAGES_ROOT, file)}`);
      }
    }

    expect(unmapped, `Add prefix rules in nav-manifest/pathnames for:\n${unmapped.join('\n')}`).toEqual(
      [],
    );
  });
});
