"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const vitest_1 = require("vitest");
const api_paths_1 = require("./api-paths");
const BACKEND_SRC = (0, node_path_1.join)(__dirname, '../../../backend/src');
const API_PREFIX = '/api/v1';
function listControllerFiles(dir) {
    const out = [];
    for (const entry of (0, node_fs_1.readdirSync)(dir, { withFileTypes: true })) {
        const full = (0, node_path_1.join)(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...listControllerFiles(full));
        }
        else if (entry.name.endsWith('.controller.ts')) {
            out.push(full);
        }
    }
    return out;
}
function isStaffProtectedAdminRoute(fileContent, methodIndex) {
    const before = fileContent.slice(0, methodIndex);
    const classGuard = /@UseGuards\([^)]*RolesGuard/.test(before);
    const methodBlockStart = before.lastIndexOf('\n  @');
    const methodBlock = fileContent.slice(methodBlockStart, methodIndex + 400);
    const methodGuard = /@UseGuards\([^)]*RolesGuard/.test(methodBlock) &&
        /UserRole\.(ADMIN|MODERATOR)/.test(methodBlock);
    return (classGuard || methodGuard) && /UserRole\.(ADMIN|MODERATOR)/.test(fileContent);
}
function collectAdminApiRoutes() {
    const routes = new Set();
    for (const file of listControllerFiles(BACKEND_SRC)) {
        const content = (0, node_fs_1.readFileSync)(file, 'utf8');
        if (!content.includes('RolesGuard'))
            continue;
        if (!/UserRole\.(ADMIN|MODERATOR)/.test(content))
            continue;
        const controllerMatch = content.match(/@Controller\(\s*['"`]([^'"`]+)['"`]\s*\)/);
        if (!controllerMatch)
            continue;
        const controllerBase = controllerMatch[1];
        const methodRe = /@(Get|Post|Put|Patch|Delete)\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/g;
        let match;
        while ((match = methodRe.exec(content)) !== null) {
            if (!isStaffProtectedAdminRoute(content, match.index))
                continue;
            const subPath = match[2] ?? '';
            const combined = [controllerBase, subPath].filter(Boolean).join('/');
            const isAdminRoute = combined.includes('/admin') ||
                controllerBase.includes('/admin') ||
                file.includes('-admin.controller.ts');
            if (!isAdminRoute)
                continue;
            routes.add(`${API_PREFIX}/${combined}`.replace(/\/+/g, '/'));
        }
    }
    return [...routes].sort();
}
(0, vitest_1.describe)('api-paths coverage', () => {
    (0, vitest_1.it)('maps every staff-protected admin API route from Nest controllers', () => {
        const routes = collectAdminApiRoutes();
        (0, vitest_1.expect)(routes.length).toBeGreaterThan(10);
        const unmapped = [];
        for (const route of routes) {
            const section = (0, api_paths_1.resolveAdminSectionFromApiPath)(route);
            if (section == null)
                unmapped.push(route);
        }
        (0, vitest_1.expect)(unmapped, `Add rules in api-paths.ts for:\n${unmapped.join('\n')}`).toEqual([]);
    });
});
