import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveAdminSectionFromApiPath } from './api-paths';

const BACKEND_SRC = join(__dirname, '../../../backend/src');
const API_PREFIX = '/api/v1';

function listControllerFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listControllerFiles(full));
    } else if (entry.name.endsWith('.controller.ts')) {
      out.push(full);
    }
  }
  return out;
}

function isStaffProtectedAdminRoute(fileContent: string, methodIndex: number): boolean {
  const before = fileContent.slice(0, methodIndex);
  const classGuard = /@UseGuards\([^)]*RolesGuard/.test(before);
  const methodBlockStart = before.lastIndexOf('\n  @');
  const methodBlock = fileContent.slice(methodBlockStart, methodIndex + 400);
  const methodGuard =
    /@UseGuards\([^)]*RolesGuard/.test(methodBlock) &&
    /UserRole\.(ADMIN|MODERATOR)/.test(methodBlock);
  return (classGuard || methodGuard) && /UserRole\.(ADMIN|MODERATOR)/.test(fileContent);
}

function collectAdminApiRoutes(): string[] {
  const routes = new Set<string>();

  for (const file of listControllerFiles(BACKEND_SRC)) {
    const content = readFileSync(file, 'utf8');
    if (!content.includes('RolesGuard')) continue;
    if (!/UserRole\.(ADMIN|MODERATOR)/.test(content)) continue;

    const controllerMatch = content.match(/@Controller\(\s*['"`]([^'"`]+)['"`]\s*\)/);
    if (!controllerMatch) continue;
    const controllerBase = controllerMatch[1];

    const methodRe =
      /@(Get|Post|Put|Patch|Delete)\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/g;
    let match: RegExpExecArray | null;
    while ((match = methodRe.exec(content)) !== null) {
      if (!isStaffProtectedAdminRoute(content, match.index)) continue;

      const subPath = match[2] ?? '';
      const combined = [controllerBase, subPath].filter(Boolean).join('/');
      const isAdminRoute =
        combined.includes('/admin') ||
        controllerBase.includes('/admin') ||
        file.includes('-admin.controller.ts');
      if (!isAdminRoute) continue;

      routes.add(`${API_PREFIX}/${combined}`.replace(/\/+/g, '/'));
    }
  }

  return [...routes].sort();
}

describe('api-paths coverage', () => {
  it('maps every staff-protected admin API route from Nest controllers', () => {
    const routes = collectAdminApiRoutes();
    expect(routes.length).toBeGreaterThan(10);

    const unmapped: string[] = [];
    for (const route of routes) {
      const section = resolveAdminSectionFromApiPath(route);
      if (section == null) unmapped.push(route);
    }

    expect(unmapped, `Add rules in api-paths.ts for:\n${unmapped.join('\n')}`).toEqual([]);
  });
});
