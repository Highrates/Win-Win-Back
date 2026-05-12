/**
 * В монорепо npm часто поднимает @win-win/order-item-snapshot только в корневой node_modules,
 * а nest/tsc при сборке из backend/ не находят модуль. На сервере (Win-Win-Back) пакет
 * ставится через file:./packages/… — линк уже есть. Здесь создаём symlink только если цель существует.
 */
const fs = require('fs');
const path = require('path');

const backendRoot = path.join(__dirname, '..');
const linkPath = path.join(backendRoot, 'node_modules', '@win-win', 'order-item-snapshot');

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

if (exists(linkPath)) {
  try {
    const real = fs.realpathSync(linkPath);
    if (exists(real)) process.exit(0);
  } catch {
    /* broken symlink */
  }
  try {
    fs.rmSync(linkPath, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

const flatTarget = path.join(backendRoot, 'packages', 'order-item-snapshot');
const monoTarget = path.join(backendRoot, '..', 'packages', 'order-item-snapshot');
const target = exists(flatTarget) ? flatTarget : monoTarget;

if (!exists(target)) {
  console.error(
    '[link-order-item-snapshot] missing package dir: expected ./packages/order-item-snapshot (Win-Win-Back) or ../packages/order-item-snapshot (monorepo). Commit packages/order-item-snapshot into the back repo; see scripts/deploy-back.sh',
  );
  process.exit(1);
}

fs.mkdirSync(path.dirname(linkPath), { recursive: true });
const rel = path.relative(path.dirname(linkPath), target);
try {
  fs.symlinkSync(rel, linkPath, 'dir');
  console.log('[link-order-item-snapshot] linked', linkPath, '->', rel);
} catch (e) {
  console.error('[link-order-item-snapshot] symlink failed:', e && e.message ? e.message : e);
  process.exit(1);
}
