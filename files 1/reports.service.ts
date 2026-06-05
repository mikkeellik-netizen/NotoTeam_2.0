import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { Bot } from 'grammy';
import { startOfWeek, endOfWeek, subDays } from 'date-fns';

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);
  private bot: Bot;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    this.bot = new Bot(this.config.get('BOT_TOKEN')!);
  }

  // ─── Еженедельный отчёт — каждый вторник в 19:00 МСК ──────
  @Cron('0 16 * * 2', { timeZone: 'Europe/Moscow' }) // 19:00 МСК = 16:00 UTC
  async sendWeeklyReports() {
    this.logger.log('Запуск еженедельных отчётов...');

    const projects = await this.prisma.project.findMany({
      where: { isArchived: false },
      include: { owner: true },
    });

    for (const project of projects) {
      try {
        await this.sendProjectWeeklyReport(project);
      } catch (e) {
        this.logger.error(`Ошибка отчёта для проекта ${project.id}: ${e.message}`);
      }
    }
  }

  // ─── Отчёт о просрочках — каждые 2 недели в понедельник ───
  @Cron('0 9 * * 1', { timeZone: 'Europe/Moscow' })
  async sendOverdueReports() {
    // Запускаем только каждые 2 недели (нечётные)
    const weekNum = Math.floor(Date.now() / (7 * 24 * 3600 * 1000));
    if (weekNum % 2 !== 0) return;

    this.logger.log('Запуск отчётов о просрочках...');

    const projects = await this.prisma.project.findMany({
      where: { isArchived: false },
      include: { owner: true, members: { include: { user: true } } },
    });

    for (const project of projects) {
      await this.sendOverdueReport(project);
    }
  }

  // ─── Еженедельный отчёт по проекту ────────────────────────
  private async sendProjectWeeklyReport(project: any) {
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
    const weekEnd = endOfWeek(new Date(), { weekStartsOn: 1 });

    const [completed, created, overdue, byMember] = await Promise.all([
      // Завершённые за неделю
      this.prisma.task.findMany({
        where: {
          projectId: project.id,
          archivedAt: { gte: weekStart, lte: weekEnd },
          isArchived: true,
        },
        include: { assignee: true },
      }),
      // Созданные за неделю
      this.prisma.task.count({
        where: { projectId: project.id, createdAt: { gte: weekStart } },
      }),
      // Просроченные
      this.prisma.task.count({
        where: {
          projectId: project.id,
          isArchived: false,
          deadlineAt: { lt: new Date() },
        },
      }),
      // По исполнителям
      this.prisma.task.groupBy({
        by: ['assigneeId'],
        where: { projectId: project.id, archivedAt: { gte: weekStart }, isArchived: true },
        _count: { id: true },
      }),
    ]);

    const lines = [
      `📊 *Еженедельный отчёт — ${project.title}*`,
      `📅 ${this.fmtDate(weekStart)} — ${this.fmtDate(weekEnd)}`,
      '',
      `✅ Завершено задач: *${completed.length}*`,
      `➕ Создано задач: *${created}*`,
      `🔴 Просрочено: *${overdue}*`,
    ];

    if (byMember.length > 0) {
      lines.push('', '👥 *По участникам:*');
      for (const m of byMember) {
        if (!m.assigneeId) continue;
        const user = await this.prisma.user.findUnique({ where: { id: m.assigneeId } });
        const name = user?.firstName ?? user?.username ?? `ID ${m.assigneeId}`;
        lines.push(`  • ${name}: ${m._count.id} задач`);
      }
    }

    await this.bot.api.sendMessage(project.owner.telegramId, lines.join('\n'), {
      parse_mode: 'Markdown',
    });
  }

  // ─── Отчёт о систематических просрочках ───────────────────
  private async sendOverdueReport(project: any) {
    const twoWeeksAgo = subDays(new Date(), 14);

    // Считаем просрочки на человека за 2 недели
    const overdues = await this.prisma.task.groupBy({
      by: ['assigneeId'],
      where: {
        projectId: project.id,
        isArchived: false,
        deadlineAt: { lt: new Date(), gte: twoWeeksAgo },
        assigneeId: { not: null },
      },
      _count: { id: true },
      having: { id: { _count: { gte: 3 } } },
    });

    if (overdues.length === 0) return;

    const lines = [
      `⚠️ *Отчёт о просрочках — ${project.title}*`,
      `За последние 2 недели:`,
      '',
    ];

    for (const o of overdues) {
      if (!o.assigneeId) continue;
      const user = await this.prisma.user.findUnique({ where: { id: o.assigneeId } });
      const name = user?.firstName ?? user?.username ?? `ID ${o.assigneeId}`;
      lines.push(`⛔ ${name}: *${o._count.id} просрочки*`);
      lines.push(`   → Рекомендация: обсудите загрузку и дедлайны`);
    }

    await this.bot.api.sendMessage(project.owner.telegramId, lines.join('\n'), {
      parse_mode: 'Markdown',
    });
  }

  private fmtDate(d: Date): string {
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
  }
}
