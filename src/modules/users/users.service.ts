import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async existsByPhoneOrEmail(phoneDigits: string | null, emailLower: string | null): Promise<boolean> {
    const or: Prisma.UserWhereInput[] = [];
    if (phoneDigits) or.push({ phone: phoneDigits });
    if (emailLower) {
      const e = emailLower.trim().toLowerCase();
      if (e) or.push({ email: e });
    }
    if (!or.length) return false;
    const u = await this.prisma.user.findFirst({
      where: { OR: or, isActive: true },
      select: { id: true },
    });
    return !!u;
  }

  async createRetailUser(dto: {
    phone: string | null;
    email: string | null;
    password: string;
    consentPersonalData: boolean;
    consentSms: boolean;
  }) {
    if (!dto.phone && !dto.email) {
      throw new BadRequestException('Нужен телефон или email');
    }
    const email = dto.email ? dto.email.trim().toLowerCase() : null;
    const phone = dto.phone;
    const or: Prisma.UserWhereInput[] = [];
    if (phone) or.push({ phone });
    if (email) or.push({ email });
    const existing = await this.prisma.user.findFirst({
      where: { OR: or },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('Пользователь с таким телефоном или email уже зарегистрирован');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const now = new Date();
    const user = await this.prisma.user.create({
      data: {
        email,
        phone,
        passwordHash,
        role: UserRole.USER,
        consentPersonalDataAcceptedAt: dto.consentPersonalData ? now : null,
        consentSmsMarketingAcceptedAt: dto.consentSms ? now : null,
      },
    });
    const { passwordHash: _, ...safe } = user;
    return safe;
  }

  async listRetailUsers(params: { skip: number; take: number; q?: string }) {
    const q = params.q?.trim();
    const digits = q?.replace(/\D/g, '') ?? '';
    const where: Prisma.UserWhereInput = {
      role: UserRole.USER,
      ...(q
        ? {
            OR: [
              { email: { contains: q, mode: 'insensitive' } },
              ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: params.skip,
        take: params.take,
        select: {
          id: true,
          email: true,
          phone: true,
          isActive: true,
          createdAt: true,
          consentPersonalDataAcceptedAt: true,
          consentSmsMarketingAcceptedAt: true,
          profile: { select: { firstName: true, lastName: true } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return { items, total };
  }

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
