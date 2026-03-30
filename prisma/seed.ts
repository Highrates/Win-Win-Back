import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const emailRaw = process.env.ADMIN_SEED_EMAIL ?? 'admin@winwin.local';
  const passwordRaw = process.env.ADMIN_SEED_PASSWORD ?? 'change-me-admin';
  const email = emailRaw.trim().toLowerCase();
  const password = passwordRaw.trim();

  const passwordHash = await bcrypt.hash(password, 10);

  await prisma.user.upsert({
    where: { email },
    create: {
      email,
      passwordHash,
      role: 'ADMIN',
      isActive: true,
    },
    update: {
      passwordHash,
      role: 'ADMIN',
      isActive: true,
    },
  });

  console.log(`[seed] Admin user ready: ${email} (role ADMIN). Change password after first deploy.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
