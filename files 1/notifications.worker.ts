import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SmartAssistantService, MessageEvent } from '../smart-assistant/smart-assistant.service';
import { Bot } from 'grammy';
import { ConfigService } from '@nestjs/config';

@Processor('notifications')
export class NotificationsWorker extends WorkerHost {
  private readonly logger = new Logger(NotificationsWorker.name);
  private bot: Bot;

  constructor(
    private prisma: PrismaService,
    private assistant: SmartAssistantService,
    private config: ConfigService,
  ) {
    super();
    this.bot = new Bot(this.config.get('BOT_TOKEN')!);
  }

  async process(job: Job) {
    const { type, taskId, userId } = job.data;

    try {
      // Загружаем задачу с проектом
      const task = await this.prisma.task.findUnique({
        where: { id: taskId },
        include: { project: true, assignee: true },
      });

      if (!task) return;

      // Загружаем пользователя
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!user) return;

      const tone = task.project.aiToneStyle;
      const text = this.assistant.formatNotification(
        type as MessageEvent,
        tone,
        {
          title: task.title,
          deadlineAt: task.deadlineAt,
          priority: task.priority,
        },
        task.project.title,
        user.firstName ?? user.username,
      );

      // Отправляем через бот
      await this.bot.api.sendMessage(user.telegramId, text, {
        parse_mode: 'Markdown',
      });

      this.logger.log(`Уведомление [${type}] → ${user.telegramId}`);
    } catch (err) {
      this.logger.error(`Ошибка уведомления: ${err.message}`);
      throw err; // BullMQ сделает retry
    }
  }
}
