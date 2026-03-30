import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findByEmailOrPhone(emailOrPhone: string) {
    const raw = emailOrPhone.trim();
    if (!raw) return null;
    const emailLookup = raw.includes('@') ? raw.toLowerCase() : raw;
    return this.prisma.user.findFirst({
      where: {
        OR: [{ email: emailLookup }, { phone: raw }],
        isActive: true,
      },
      include: { profile: true },
    });
  }

  async findById(id: string) {
    return this.prisma.user.findUnique({
      where: { id, isActive: true },
      include: { profile: true },
    });
  }

  /** Без passwordHash — для API /users/me, /auth/me */
  async findByIdPublic(id: string) {
    const user = await this.findById(id);
    if (!user) return null;
    const { passwordHash: _, ...safe } = user;
    return safe;
  }

  async checkPassword(userId: string, password: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });
    if (!user?.passwordHash) return false;
    return bcrypt.compare(password, user.passwordHash);
  }

  async create(dto: { email?: string; phone?: string; password: string }) {
    const passwordHash = await bcrypt.hash(dto.password, 10);
    return this.prisma.user.create({
      data: {
        email: dto.email,
        phone: dto.phone,
        passwordHash,
        role: UserRole.USER,
      },
    });
  }
}
