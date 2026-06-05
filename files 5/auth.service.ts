import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import * as crypto from 'crypto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  // ─── Валидация initData от Telegram ────────────────────────
  validateInitData(initData: string): boolean {
    const botToken = this.config.get<string>('BOT_TOKEN');
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return false;

    params.delete('hash');

    // Строим data_check_string
    const checkString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    // HMAC-SHA256
    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(botToken)
      .digest();

    const expectedHash = crypto
      .createHmac('sha256', secretKey)
      .update(checkString)
      .digest('hex');

    return expectedHash === hash;
  }

  // ─── Логин / регистрация ────────────────────────────────────
  async loginWithInitData(initData: string) {
    if (!this.validateInitData(initData)) {
      throw new UnauthorizedException('Невалидный initData от Telegram');
    }

    const params = new URLSearchParams(initData);
    const userRaw = params.get('user');
    if (!userRaw) throw new UnauthorizedException('Нет данных пользователя');

    const tgUser = JSON.parse(userRaw);

    // Upsert пользователя
    const user = await this.prisma.user.upsert({
      where: { telegramId: String(tgUser.id) },
      update: {
        username: tgUser.username,
        firstName: tgUser.first_name,
        lastName: tgUser.last_name,
      },
      create: {
        telegramId: String(tgUser.id),
        username: tgUser.username,
        firstName: tgUser.first_name,
        lastName: tgUser.last_name,
      },
    });

    const token = this.jwt.sign({ sub: user.id, telegramId: user.telegramId });

    return { token, user };
  }

  // ─── Для бота: найти или создать юзера по telegramId ───────
  async findOrCreateByTelegramId(
    telegramId: string,
    data?: { username?: string; firstName?: string; lastName?: string },
  ) {
    return this.prisma.user.upsert({
      where: { telegramId },
      update: { ...data },
      create: { telegramId, ...data },
    });
  }
}
