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
  console.warn(
    '[link-order-item-snapshot] skip: neither ./packages/order-item-snapshot nor ../packages/order-item-snapshot found',
  );
  process.exit(0);
}

fs.mkdirSync(path.dirname(linkPath), { recursive: true });
const rel = path.relative(path.dirname(linkPath), target);
fs.symlinkSync(rel, linkPath, 'dir');
console.log('[link-order-item-snapshot] linked', linkPath, '->', rel);
