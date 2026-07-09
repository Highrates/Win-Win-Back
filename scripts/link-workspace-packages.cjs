/**
 * В монорепо npm часто поднимает @win-win/* только в корневой node_modules,
 * а nest/tsc при сборке из backend/ не находят модуль. Создаём symlink в backend/node_modules.
 */
const fs = require('fs');
const path = require('path');

const PACKAGES = ['admin-sections', 'order-item-snapshot', 'order-status', 'sourcing-request'];

const backendRoot = path.join(__dirname, '..');

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function linkPackage(packageName) {
  const linkPath = path.join(backendRoot, 'node_modules', '@win-win', packageName);

  if (exists(linkPath)) {
    try {
      const real = fs.realpathSync(linkPath);
      if (exists(real)) return;
    } catch {
      /* broken symlink */
    }
    try {
      fs.rmSync(linkPath, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }

  const flatTarget = path.join(backendRoot, 'packages', packageName);
  const monoTarget = path.join(backendRoot, '..', 'packages', packageName);
  const target = exists(flatTarget) ? flatTarget : monoTarget;

  if (!exists(target)) {
    console.error(
      `[link-workspace-packages] missing ${packageName}: expected ./packages/${packageName} or ../packages/${packageName}`,
    );
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  const rel = path.relative(path.dirname(linkPath), target);
  try {
    fs.symlinkSync(rel, linkPath, 'dir');
    console.log('[link-workspace-packages] linked', linkPath, '->', rel);
  } catch (e) {
    console.error('[link-workspace-packages] symlink failed:', e && e.message ? e.message : e);
    process.exit(1);
  }
}

for (const name of PACKAGES) {
  linkPackage(name);
}
