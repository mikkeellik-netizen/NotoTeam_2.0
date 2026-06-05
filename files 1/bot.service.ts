import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Bot, InlineKeyboard, Context } from 'grammy';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { TasksService } from '../tasks/tasks.service';
import { TaskParserService } from '../task-parser/task-parser.service';
import { SmartAssistantService } from '../smart-assistant/smart-assistant.service';

// Состояние диалога создания задачи (in-memory)
interface TaskCreationSession {
  step: 'choose_project' | 'input_task' | 'confirm' | 'fix_field';
  projectId?: number;
  projectTitle?: string;
  parsed?: any;
  fixField?: string;
}

@Injectable()
export class BotService implements OnModuleInit {
  private readonly logger = new Logger(BotService.name);
  bot: Bot;
  private sessions = new Map<number, TaskCreationSession>();

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
    private authService: AuthService,
    private tasksService: TasksService,
    private taskParser: TaskParserService,
    private assistant: SmartAssistantService,
  ) {
    this.bot = new Bot(this.config.get('BOT_TOKEN')!);
  }

  async onModuleInit() {
    this.setupHandlers();
    // Запускаем бота в режиме long polling
    this.bot.start({ onStart: () => this.logger.log('🤖 Бот запущен') });
  }

  // ─── Регистрация хэндлеров ─────────────────────────────────
  private setupHandlers() {
    const { bot } = this;

    // /start
    bot.command('start', (ctx) => this.handleStart(ctx));

    // /my — мои задачи
    bot.command('my', (ctx) => this.handleMyTasks(ctx));

    // /new — создать задачу
    bot.command('new', (ctx) => this.handleNewTask(ctx));

    // /help
    bot.command('help', (ctx) =>
      ctx.reply(
        '📋 *Команды бота:*\n\n' +
        '/start — главное меню\n' +
        '/my — мои активные задачи\n' +
        '/new — создать задачу голосом/текстом\n' +
        '/help — справка',
        { parse_mode: 'Markdown' },
      ),
    );

    // Колбэки от inline-кнопок
    bot.callbackQuery(/^open_board_(\d+)$/, (ctx) => this.handleOpenBoard(ctx));
    bot.callbackQuery('my_tasks', (ctx) => this.handleMyTasks(ctx));
    bot.callbackQuery(/^task_confirm_(\d+)$/, (ctx) => this.handleTaskConfirm(ctx));
    bot.callbackQuery(/^task_edit_(\d+)$/, (ctx) => this.handleTaskEdit(ctx));
    bot.callbackQuery('task_cancel', (ctx) => {
      const uid = ctx.from!.id;
      this.sessions.delete(uid);
      ctx.editMessageText('❌ Создание задачи отменено.');
    });
    bot.callbackQuery(/^choose_project_(\d+)$/, (ctx) => this.handleChooseProject(ctx));
    bot.callbackQuery(/^fix_(.+)$/, (ctx) => this.handleFixField(ctx));

    // Текстовые сообщения — диалог создания задачи
    bot.on('message:text', (ctx) => this.handleTextMessage(ctx));
  }

  // ─── /start ───────────────────────────────────────────────
  private async handleStart(ctx: Context) {
    const tg = ctx.from!;

    await this.authService.findOrCreateByTelegramId(String(tg.id), {
      username: tg.username,
      firstName: tg.first_name,
      lastName: tg.last_name,
    });

    const name = tg.first_name ?? tg.username ?? 'друг';
    const webappUrl = this.config.get('WEBAPP_URL');

    const keyboard = new InlineKeyboard()
      .webApp('📋 Открыть доску', webappUrl!)
      .row()
      .text('✅ Мои задачи', 'my_tasks')
      .row()
      .text('➕ Создать задачу', 'new_task_start');

    await ctx.reply(
      `👋 Привет, *${name}*!\n\n` +
      `Я твой командный помощник для управления задачами.\n\n` +
      `Что делаем?`,
      { parse_mode: 'Markdown', reply_markup: keyboard },
    );
  }

  // ─── /my — мои задачи ─────────────────────────────────────
  private async handleMyTasks(ctx: Context) {
    const uid = await this.getOrCreateUser(ctx);
    if (!uid) return;

    const data = await this.tasksService.findMyTasks(uid.id);
    const all = [...data.red, ...data.yellow, ...data.green, ...data.noDate];

    if (all.length === 0) {
      return ctx.reply('🎉 Активных задач нет! Так держать.');
    }

    const lines: string[] = ['*Мои активные задачи:*\n'];

    if (data.red.length) {
      lines.push('🔴 *Срочно:*');
      for (const t of data.red) lines.push(this.formatTaskLine(t));
      lines.push('');
    }
    if (data.yellow.length) {
      lines.push('🟡 *Скоро:*');
      for (const t of data.yellow) lines.push(this.formatTaskLine(t));
      lines.push('');
    }
    if (data.green.length) {
      lines.push('🟢 *В работе:*');
      for (const t of data.green) lines.push(this.formatTaskLine(t));
      lines.push('');
    }
    if (data.noDate.length) {
      lines.push('📋 *Без дедлайна:*');
      for (const t of data.noDate) lines.push(this.formatTaskLine(t));
      lines.push('');
    }

    // Прогресс
    const { completed, total } = data.stats;
    const percent = total ? Math.round((completed / total) * 100) : 0;
    const bar = this.progressBar(percent);
    lines.push(`✅ Завершено: *${completed} из ${total}*`);
    lines.push(`${bar} ${percent}%`);

    await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
  }

  // ─── /new — начало создания задачи ────────────────────────
  private async handleNewTask(ctx: Context) {
    const user = await this.getOrCreateUser(ctx);
    if (!user) return;

    // Получаем проекты пользователя
    const members = await this.prisma.projectMember.findMany({
      where: { userId: user.id },
      include: { project: true },
    });

    const projects = members.map((m) => m.project).filter((p) => !p.isArchived);

    if (projects.length === 0) {
      return ctx.reply('У тебя пока нет проектов. Создай первый в приложении 📋');
    }

    if (projects.length === 1) {
      // Один проект — сразу предлагаем написать задачу
      const p = projects[0];
      this.sessions.set(ctx.from!.id, {
        step: 'input_task',
        projectId: p.id,
        projectTitle: p.title,
      });
      return ctx.reply(
        `📂 Проект: *${p.title}*\n\nНапиши задачу в свободной форме:\n_Например: Поставь Илье задачу подготовить презентацию до пятницы 18:00_`,
        { parse_mode: 'Markdown' },
      );
    }

    // Несколько проектов — выбор
    const keyboard = new InlineKeyboard();
    for (const p of projects) {
      keyboard.text(p.title, `choose_project_${p.id}`).row();
    }

    this.sessions.set(ctx.from!.id, { step: 'choose_project' });
    await ctx.reply('В какой проект добавить задачу?', { reply_markup: keyboard });
  }

  // ─── Выбор проекта ─────────────────────────────────────────
  private async handleChooseProject(ctx: Context) {
    const projectId = parseInt(ctx.match![1]);
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return;

    this.sessions.set(ctx.from!.id, {
      step: 'input_task',
      projectId: project.id,
      projectTitle: project.title,
    });

    await ctx.editMessageText(
      `📂 Проект: *${project.title}*\n\nНапиши задачу в свободной форме:\n_Например: Поставь Илье подготовить презентацию до пятницы_`,
      { parse_mode: 'Markdown' },
    );
  }

  // ─── Текстовые сообщения ───────────────────────────────────
  private async handleTextMessage(ctx: Context) {
    const uid = ctx.from!.id;
    const session = this.sessions.get(uid);
    if (!session) return;

    const text = ctx.message!.text;

    if (session.step === 'input_task') {
      // Парсим задачу
      const parsed = this.taskParser.parse(text);
      session.parsed = parsed;
      session.step = 'confirm';
      this.sessions.set(uid, session);

      // Показываем подтверждение
      const confirmText = this.taskParser.formatConfirmation(parsed, session.projectTitle);

      const keyboard = new InlineKeyboard()
        .text('✅ Создать', `task_confirm_${Date.now()}`)
        .text('✏️ Изменить', `task_edit_${Date.now()}`)
        .row()
        .text('❌ Отмена', 'task_cancel');

      await ctx.reply(confirmText, { parse_mode: 'Markdown', reply_markup: keyboard });
    } else if (session.step === 'fix_field') {
      // Исправление конкретного поля
      const field = session.fixField;
      if (field === 'title') session.parsed.title = text;
      if (field === 'assignee') session.parsed.assigneeHint = text;
      if (field === 'deadline') {
        const reParsed = this.taskParser.parse(text);
        session.parsed.deadlineAt = reParsed.deadlineAt;
      }
      session.step = 'confirm';
      this.sessions.set(uid, session);

      const confirmText = this.taskParser.formatConfirmation(session.parsed, session.projectTitle);
      const keyboard = new InlineKeyboard()
        .text('✅ Создать', `task_confirm_${Date.now()}`)
        .text('✏️ Изменить', `task_edit_${Date.now()}`)
        .row()
        .text('❌ Отмена', 'task_cancel');

      await ctx.reply(confirmText, { parse_mode: 'Markdown', reply_markup: keyboard });
    }
  }

  // ─── Подтверждение создания задачи ────────────────────────
  private async handleTaskConfirm(ctx: Context) {
    const uid = ctx.from!.id;
    const session = this.sessions.get(uid);
    if (!session?.parsed || !session.projectId) return;

    const user = await this.getOrCreateUser(ctx);
    if (!user) return;

    const { parsed, projectId } = session;

    // Ищем исполнителя по имени
    let assigneeId: number | undefined;
    if (parsed.assigneeHint) {
      const member = await this.prisma.user.findFirst({
        where: {
          OR: [
            { firstName: { contains: parsed.assigneeHint, mode: 'insensitive' } },
            { username: { contains: parsed.assigneeHint, mode: 'insensitive' } },
          ],
          projectMembers: { some: { projectId } },
        },
      });
      assigneeId = member?.id;
    }

    // Находим дефолтную колонку
    const column = await this.prisma.column.findFirst({
      where: { projectId, isDefault: true },
    });
    if (!column) return ctx.editMessageText('❌ Не найдена колонка для создания задачи.');

    await this.tasksService.create(projectId, {
      title: parsed.title ?? 'Новая задача',
      columnId: column.id,
      assigneeId,
      deadlineAt: parsed.deadlineAt?.toISOString(),
      priority: parsed.priority ?? 'MEDIUM',
    }, user.id);

    this.sessions.delete(uid);
    await ctx.editMessageText('✅ Задача создана!');
  }

  // ─── Редактирование задачи ─────────────────────────────────
  private async handleTaskEdit(ctx: Context) {
    const uid = ctx.from!.id;
    const session = this.sessions.get(uid);
    if (!session) return;

    const keyboard = new InlineKeyboard()
      .text('📌 Название', 'fix_title')
      .text('👤 Исполнитель', 'fix_assignee')
      .row()
      .text('📅 Дедлайн', 'fix_deadline')
      .text('⚡ Приоритет', 'fix_priority');

    await ctx.editMessageText('Что изменить?', { reply_markup: keyboard });
  }

  private async handleFixField(ctx: Context) {
    const uid = ctx.from!.id;
    const field = ctx.match![1];
    const session = this.sessions.get(uid);
    if (!session) return;

    session.step = 'fix_field';
    session.fixField = field;
    this.sessions.set(uid, session);

    const prompts: Record<string, string> = {
      title: 'Введи новое название задачи:',
      assignee: 'Введи имя исполнителя:',
      deadline: 'Введи дедлайн (например: завтра 18:00, в пятницу, через 2 дня):',
      priority: 'Введи приоритет (низкий / средний / высокий / критический):',
    };

    await ctx.editMessageText(prompts[field] ?? 'Введи значение:');
  }

  private async handleOpenBoard(ctx: Context) {
    const projectId = parseInt(ctx.match![1]);
    const webappUrl = this.config.get('WEBAPP_URL');
    const keyboard = new InlineKeyboard().webApp(
      '📋 Открыть доску',
      `${webappUrl}/board/${projectId}`,
    );
    await ctx.reply('Открываю проект...', { reply_markup: keyboard });
  }

  // ─── Утилиты ──────────────────────────────────────────────
  private formatTaskLine(task: any): string {
    const emoji = { LOW: '🔵', MEDIUM: '⚪', HIGH: '🔴', CRITICAL: '⚫' };
    let line = `${emoji[task.priority as keyof typeof emoji] ?? '⚪'} ${task.title}`;
    if (task.deadlineAt) {
      const d = new Date(task.deadlineAt).toLocaleString('ru-RU', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
        timeZone: 'Europe/Moscow',
      });
      line += `\n   📅 ${d} МСК`;
    }
    if (task.project?.title) line += `\n   📂 ${task.project.title}`;
    return line;
  }

  private progressBar(percent: number): string {
    const filled = Math.round(percent / 10);
    return '█'.repeat(filled) + '░'.repeat(10 - filled);
  }

  private async getOrCreateUser(ctx: Context) {
    const tg = ctx.from!;
    return this.authService.findOrCreateByTelegramId(String(tg.id), {
      username: tg.username,
      firstName: tg.first_name,
      lastName: tg.last_name,
    });
  }
}
