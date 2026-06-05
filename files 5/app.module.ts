import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bullmq';

import { PrismaModule } from './common/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { MembersModule } from './modules/members/members.module';
import { ColumnsModule } from './modules/columns/columns.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { SubtasksModule } from './modules/subtasks/subtasks.module';
import { TagsModule } from './modules/tags/tags.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { BotModule } from './modules/bot/bot.module';
import { SmartAssistantModule } from './modules/smart-assistant/smart-assistant.module';
import { TaskParserModule } from './modules/task-parser/task-parser.module';
import { ReportsModule } from './modules/reports/reports.module';

@Module({
  imports: [
    // Конфигурация из .env
    ConfigModule.forRoot({ isGlobal: true }),

    // Cron-задачи
    ScheduleModule.forRoot(),

    // Redis + BullMQ очереди
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          url: config.get('REDIS_URL'),
        },
      }),
    }),

    // Prisma (глобально)
    PrismaModule,

    // Функциональные модули
    AuthModule,
    ProjectsModule,
    MembersModule,
    ColumnsModule,
    TasksModule,
    SubtasksModule,
    TagsModule,
    NotificationsModule,
    BotModule,
    SmartAssistantModule,
    TaskParserModule,
    ReportsModule,
  ],
})
export class AppModule {}
