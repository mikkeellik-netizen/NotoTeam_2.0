import { Bot, InlineKeyboard, type Context } from "grammy";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BotConfig } from "../config.js";
import type { WorkspaceRepository } from "../ports.js";
import { escapeMarkdown, formatMskDate, formatMyTasksMessage } from "../services/formatters.js";
import { buildWeeklyReportText } from "../services/reportService.js";
import { NotificationService } from "../services/notificationService.js";
import { TaskParser } from "../services/taskParser.js";
import { createSpeechToTextProvider } from "../services/speechToText.js";
import { VoiceIntentParser, voiceIntentLabel } from "../services/voiceIntentParser.js";
import { parseDateTime, stripDateTimePhrases } from "../services/dateParser.js";
import type { PageNode, Project, User } from "../types.js";
import { buildWebAppUrl } from "../webAppLinks.js";

type TaskTarget = {
  projectId?: string;
  boardPageId?: string;
};

type Session =
  | ({ mode: "new_task"; switching?: boolean } & TaskTarget)
  | ({ mode: "task_draft"; step: "title" | "assignee" | "deadline"; draft: ReturnType<TaskParser["parse"]> } & Required<TaskTarget>)
  | { mode: "inbox_note"; projectId: string }
  | { mode: "reminder_text"; projectId: string }
  | { mode: "reminder_assignee"; projectId: string; title: string; remindAt?: string; description?: string; assigneeUsername?: string }
  | { mode: "reminder_date"; projectId: string; title: string; targetUserId?: string; description?: string }
  | { mode: "new_project" }
  | { mode: "join_project" };

type BotProjectRoleName = "owner" | "admin" | "editor" | "viewer";
type BotProjectPermission = "viewProject" | "createTask" | "createPage" | "manageReminders" | "viewAnalytics";

const BOT_NO_PERMISSIONS: Record<BotProjectPermission, boolean> = {
  viewProject: false,
  createTask: false,
  createPage: false,
  manageReminders: false,
  viewAnalytics: false,
};

const BOT_ROLE_PERMISSIONS: Record<BotProjectRoleName, Record<BotProjectPermission, boolean>> = {
  owner: {
    viewProject: true,
    createTask: true,
    createPage: true,
    manageReminders: true,
    viewAnalytics: true,
  },
  admin: {
    viewProject: true,
    createTask: true,
    createPage: true,
    manageReminders: true,
    viewAnalytics: true,
  },
  editor: {
    viewProject: true,
    createTask: true,
    createPage: true,
    manageReminders: true,
    viewAnalytics: false,
  },
  viewer: {
    viewProject: true,
    createTask: false,
    createPage: false,
    manageReminders: false,
    viewAnalytics: false,
  },
};

export class TelegramWorkspaceBot {
  private bot: Bot;
  private parser = new TaskParser();
  private speechToText = createSpeechToTextProvider();
  private voiceIntentParser = new VoiceIntentParser();
  private voiceLimits = readVoiceLimits();
  private voiceAttempts = new Map<number, number[]>();
  private voiceInFlight = 0;
  private sessions = new Map<number, Session>();
  private defaultTargets = new Map<number, Required<TaskTarget>>();

  constructor(
    private config: BotConfig,
    private repo: WorkspaceRepository,
    private notifications?: NotificationService,
  ) {
    this.bot = new Bot(config.botToken);
    this.registerHandlers();
  }

  get instance() {
    return this.bot;
  }

  setNotificationService(notifications: NotificationService) {
    this.notifications = notifications;
  }

  // Общая подготовка — вызывается независимо от способа получения апдейтов (polling/webhook).
  private async prepare() {
    // ОБЯЗАТЕЛЬНО: без init() метод handleUpdate() (используется в webhook-режиме)
    // падает с "Bot information unavailable" и команды не обрабатываются.
    await this.bot.init();
    this.bot.catch((error) => {
      console.error("Telegram bot error", error.message);
    });
    await this.bot.api.setMyCommands([
      { command: "start", description: "Запуск и регистрация" },
      { command: "id", description: "Получить мой ID" },
      { command: "menu", description: "Главное меню" },
      { command: "new", description: "Создать задачу" },
      { command: "my", description: "Мои активные задачи" },
      { command: "events", description: "События на неделю" },
      { command: "weekly", description: "Еженедельный отчет проекта" },
      { command: "projects", description: "Мои проекты" },
      { command: "where", description: "Куда бот кладет задачи" },
      { command: "switch", description: "Сменить проект или доску" },
      { command: "newproject", description: "Создать проект" },
      { command: "join", description: "Ввести код проекта" },
      { command: "help", description: "Справка" },
    ]);
  }

  // Long polling — для локальной разработки. Держит соединение с Telegram открытым,
  // поэтому не подходит для бесплатных PaaS, которые усыпляют процесс без входящих HTTP-запросов.
  async start() {
    await this.prepare();
    await this.bot.api.deleteWebhook({ drop_pending_updates: false });
    await this.bot.start({
      onStart: () => {
        console.log("Telegram Workspace Bot started (polling)");
      },
    });
  }

  // Webhook — Telegram сам присылает апдейты HTTP-запросом. Не требует постоянно
  // открытого соединения, поэтому переживает усыпление бесплатного хостинга:
  // входящее сообщение — это и есть запрос, который "будит" процесс.
  async startWebhook(publicUrl: string, path: string, secretToken: string) {
    await this.prepare();
    const webhookUrl = `${publicUrl.replace(/\/$/, "")}${path}`;
    await this.bot.api.setWebhook(webhookUrl, { drop_pending_updates: true, secret_token: secretToken });
    console.log(`Telegram Workspace Bot started (webhook): ${webhookUrl}`);
  }

  private registerHandlers() {
    this.bot.command("start", (ctx) => this.handleStart(ctx));
    this.bot.command("id", (ctx) => this.handleGetId(ctx));
    this.bot.command("menu", (ctx) => this.handleMenu(ctx));
    this.bot.command("help", (ctx) => this.handleHelp(ctx));
    this.bot.command("my", (ctx) => this.handleMyTasks(ctx));
    this.bot.command("events", (ctx) => this.handleWeekEvents(ctx));
    this.bot.command("weekly", (ctx) => this.handleWeeklyReport(ctx));
    this.bot.command("projects", (ctx) => this.handleProjects(ctx));
    this.bot.command("new", (ctx) => this.handleNewTask(ctx));
    this.bot.command("task", (ctx) => this.handleNewTask(ctx));
    this.bot.command("note", (ctx) => this.handleInboxNote(ctx));
    this.bot.command("remind", (ctx) => this.handleReminder(ctx));
    this.bot.command("where", (ctx) => this.handleWhere(ctx));
    this.bot.command("switch", (ctx) => this.handleSwitch(ctx));
    this.bot.command("newproject", (ctx) => this.askNewProjectTitle(ctx));
    this.bot.command("join", (ctx) => this.askJoinCode(ctx));

    this.bot.callbackQuery("get_id", (ctx) => this.handleGetId(ctx));
    this.bot.callbackQuery("menu", (ctx) => this.handleMenu(ctx));
    this.bot.callbackQuery("my_tasks", (ctx) => this.handleMyTasks(ctx));
    this.bot.callbackQuery("week_events", (ctx) => this.handleWeekEvents(ctx));
    this.bot.callbackQuery("weekly_report", (ctx) => this.handleWeeklyReport(ctx));
    this.bot.callbackQuery("projects", (ctx) => this.handleProjects(ctx));
    this.bot.callbackQuery("new_task", (ctx) => this.handleNewTask(ctx));
    this.bot.callbackQuery("new_inbox_note", (ctx) => this.handleInboxNote(ctx));
    this.bot.callbackQuery("new_reminder", (ctx) => this.handleReminder(ctx));
    this.bot.callbackQuery("switch_target", (ctx) => this.handleSwitch(ctx));
    this.bot.callbackQuery("new_project", (ctx) => this.askNewProjectTitle(ctx));
    this.bot.callbackQuery("join_project", (ctx) => this.askJoinCode(ctx));
    this.bot.callbackQuery(/^choose_project:(.+)$/, (ctx) => this.handleChooseProject(ctx));
    this.bot.callbackQuery(/^note_project:(.+)$/, (ctx) => this.handleChooseInboxProject(ctx));
    this.bot.callbackQuery(/^reminder_project:(.+)$/, (ctx) => this.handleChooseReminderProject(ctx));
    this.bot.callbackQuery(/^choose_board:([^:]+):(.+)$/, (ctx) => this.handleChooseBoard(ctx));
    this.bot.callbackQuery(/^task_assignee:(.+)$/, (ctx) => this.handleTaskAssignee(ctx));
    this.bot.callbackQuery(/^task_deadline:(skip)$/, (ctx) => this.handleTaskDeadlineSkip(ctx));
    this.bot.callbackQuery(/^reminder_assignee:(.+)$/, (ctx) => this.handleReminderAssignee(ctx));
    this.bot.callbackQuery("cancel_session", (ctx) => this.cancelSession(ctx));

    this.bot.on("message:voice", (ctx) => this.handleVoice(ctx));
    this.bot.on("message:text", (ctx) => this.handleText(ctx));
  }

  private async handleStart(ctx: Context) {
    const user = await this.getOrCreateUser(ctx);
    const startCode = this.getStartCode(ctx);
    if (startCode) {
      await this.createJoinRequest(ctx, user, startCode);
      return;
    }

    const projects = await this.repo.getUserProjects(user.id);
    const name = user.firstName ?? user.username ?? "друг";

    if (!projects.length) {
      await ctx.reply(
        [
          `👋 Добро пожаловать, ${name}!`,
          "",
          "🧠 NotoTeam — цифровая операционная система для команд.",
          "Храните знания, управляйте проектами, ведите задачи, стройте связи между идеями и работайте вместе в едином пространстве внутри Telegram.",
          "",
          "У вас пока нет проектов — создайте новый или войдите по коду.",
        ].join("\n"),
        { reply_markup: this.emptyProjectsKeyboard() },
      );
      return;
    }

    await this.ensureDefaultTarget(ctx.from?.id, user.id, projects);
    await this.showMenu(
      ctx,
      projects,
      [`👋 С возвращением, ${name}!`, "", "📁 Ваши проекты:", ...projects.map((p, i) => `${i + 1}. ${p.title}`)].join("\n"),
    );
  }

  private async handleGetId(ctx: Context) {
    if (!ctx.from) return;
    await this.answerCallbackIfNeeded(ctx);
    const username = ctx.from.username ? `@${ctx.from.username}` : "—";
    await ctx.reply(
      [
        "🪪 ВАШИ ДАННЫЕ ДЛЯ ВХОДА",
        "",
        `🆔 ID: ${ctx.from.id}`,
        `👤 Ник: ${username}`,
        "",
        "На сайте укажите ник — пришлю одноразовый код.",
      ].join("\n"),
      { reply_markup: this.mainKeyboard() },
    );
  }

  private async handleMenu(ctx: Context) {
    const user = await this.getOrCreateUser(ctx);
    const projects = await this.repo.getUserProjects(user.id);
    await this.ensureDefaultTarget(ctx.from?.id, user.id, projects);
    await this.answerCallbackIfNeeded(ctx);
    await this.showMenu(ctx, projects);
  }

  private async handleHelp(ctx: Context) {
    await ctx.reply(
      [
        "📖 КОМАНДЫ",
        "",
        "/start — главное меню",
        "/id — мои данные для входа на сайт",
        "/projects — мои проекты",
        "/new — создать задачу",
        "/my — мои активные задачи",
        "/where — куда бот кладёт задачи",
        "/switch — сменить проект или доску",
        "/events — события на неделю",
        "/weekly — еженедельный отчёт",
        "/newproject — создать проект",
        "/join — войти в проект по коду",
        "",
        "💡 Пример задачи:",
        "@ник сделать афишу до 01.01.2026 18:00",
      ].join("\n"),
      { reply_markup: this.mainKeyboard() },
    );
  }

  private async handleProjects(ctx: Context) {
    const user = await this.getOrCreateUser(ctx);
    const projects = await this.repo.getUserProjects(user.id);
    await this.ensureDefaultTarget(ctx.from?.id, user.id, projects);
    await this.answerCallbackIfNeeded(ctx);
    await ctx.reply(this.projectsMessage(projects), { reply_markup: this.mainKeyboard(projects) });
  }

  private async handleMyTasks(ctx: Context) {
    const user = await this.getOrCreateUser(ctx);
    const tasks = await this.repo.getAssignedActiveTasks(user.id);
    const projects = await this.repo.getUserProjects(user.id);
    const projectById = new Map(projects.map((project) => [project.id, project]));
    const columns = (await Promise.all(projects.map((project) => this.repo.getProjectColumns(project.id)))).flat();
    const allAssignedTasks = (await Promise.all(projects.map((project) => this.repo.getTasksByProject(project.id))))
      .flat()
      .filter((task) => task.assigneeId === user.id);

    await this.answerCallbackIfNeeded(ctx);
    await ctx.reply(formatMyTasksMessage(tasks, columns, projectById, allAssignedTasks), {
      parse_mode: "MarkdownV2",
      reply_markup: this.mainKeyboard(projects),
    });
  }

  private async handleWeekEvents(ctx: Context) {
    if (!ctx.from) return;
    const user = await this.getOrCreateUser(ctx);
    const projects = await this.repo.getUserProjects(user.id);
    const target = await this.ensureDefaultTarget(ctx.from.id, user.id, projects);
    const project = projects.find((item) => item.id === target?.projectId) ?? projects[0];
    await this.answerCallbackIfNeeded(ctx);
    if (!project) {
      await ctx.reply("📭 Сначала создайте проект или войдите по коду.", { reply_markup: this.emptyProjectsKeyboard() });
      return;
    }

    const now = Date.now();
    const weekEnd = now + 7 * 24 * 3600000;
    const events = (await this.repo.getProjectCalendarEvents(project.id))
      .filter((event) => event.sourceType !== "kanban_deadline")
      .filter((event) => {
        const time = new Date(event.startsAt).getTime();
        return Number.isFinite(time) && time >= now && time <= weekEnd;
      })
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

    const lines = [`📅 *События на неделю — ${escapeMarkdown(project.title)}*`, ""];
    if (!events.length) lines.push("На ближайшую неделю событий нет.");
    for (const event of events.slice(0, 20)) {
      lines.push(`• *${escapeMarkdown(event.title)}*`);
      lines.push(`  ${escapeMarkdown(formatMskDate(event.startsAt))}`);
      if (event.categoryLabel || event.type) lines.push(`  ${escapeMarkdown(event.categoryLabel || event.type)}`);
      if (event.description) lines.push(`  ${escapeMarkdown(event.description.slice(0, 160))}`);
    }

    await ctx.reply(lines.join("\n"), { parse_mode: "MarkdownV2", reply_markup: this.mainKeyboard(projects) });
  }

  private async handleWeeklyReport(ctx: Context) {
    if (!ctx.from) return;
    const user = await this.getOrCreateUser(ctx);
    const projects = await this.repo.getUserProjects(user.id);
    const target = await this.ensureDefaultTarget(ctx.from.id, user.id, projects);
    const project = projects.find((item) => item.id === target?.projectId) ?? projects[0];
    await this.answerCallbackIfNeeded(ctx);
    if (!project) {
      await ctx.reply("📭 Сначала создайте проект или войдите по коду.", { reply_markup: this.emptyProjectsKeyboard() });
      return;
    }
    const canViewAnalytics = this.hasProjectPermission(project, user.id, "viewAnalytics");
    if (!canViewAnalytics) {
      await ctx.reply("🔒 Еженедельный отчёт доступен только владельцу или администратору проекта.");
      return;
    }

    await ctx.reply(await buildWeeklyReportText(this.repo, project), { parse_mode: "MarkdownV2", reply_markup: this.mainKeyboard(projects) });
  }

  private async handleWhere(ctx: Context) {
    if (!ctx.from) return;
    const user = await this.getOrCreateUser(ctx);
    const projects = await this.repo.getUserProjects(user.id);
    const target = await this.ensureDefaultTarget(ctx.from.id, user.id, projects);
    if (!target) {
      await ctx.reply("📭 Пока некуда сохранять задачи. Создайте проект или войдите по коду.", {
        reply_markup: this.emptyProjectsKeyboard(),
      });
      return;
    }

    const project = projects.find((item) => item.id === target.projectId);
    const board = await this.getBoardById(target.projectId, target.boardPageId);
    await ctx.reply(
      [
        "📍 КУДА СОХРАНЯЮТСЯ ЗАДАЧИ",
        "",
        `📁 Проект: ${project?.title ?? target.projectId}`,
        `📋 Доска: ${board?.title ?? "Основная доска"}`,
      ].join("\n"),
      { reply_markup: new InlineKeyboard().text("Сменить", "switch_target").row().text("Меню", "menu") },
    );
  }

  private async handleSwitch(ctx: Context) {
    if (!ctx.from) return;
    const user = await this.getOrCreateUser(ctx);
    const projects = await this.repo.getUserProjects(user.id);
    await this.answerCallbackIfNeeded(ctx);
    const writableProjects = this.filterProjectsByPermission(projects, user.id, "createTask");
    if (!writableProjects.length) {
      await this.denyProjectPermission(ctx, "createTask");
      return;
    }
    await this.askProjectForTask(ctx, writableProjects, true);
  }

  private async askNewProjectTitle(ctx: Context) {
    if (!ctx.from) return;
    this.sessions.set(ctx.from.id, { mode: "new_project" });
    await this.answerCallbackIfNeeded(ctx);
    await this.replyOrEdit(ctx, "✏️ Введите название нового проекта.", this.cancelKeyboard());
  }

  private async askJoinCode(ctx: Context) {
    if (!ctx.from) return;
    this.sessions.set(ctx.from.id, { mode: "join_project" });
    await this.answerCallbackIfNeeded(ctx);
    await this.replyOrEdit(ctx, "🔑 Введите код проекта. Например: P1-ABC123", this.cancelKeyboard());
  }

  private async handleNewTask(ctx: Context) {
    if (!ctx.from) return;
    const user = await this.getOrCreateUser(ctx);
    const projects = await this.repo.getUserProjects(user.id);

    if (!projects.length) {
      await ctx.reply("📭 Сначала создайте проект или войдите по коду.", {
        reply_markup: this.emptyProjectsKeyboard(),
      });
      return;
    }

    const writableProjects = this.filterProjectsByPermission(projects, user.id, "createTask");
    if (!writableProjects.length) {
      await this.denyProjectPermission(ctx, "createTask");
      return;
    }

    const target = await this.ensureDefaultTarget(ctx.from.id, user.id, writableProjects);
    if (target) {
      this.sessions.set(ctx.from.id, { mode: "new_task", ...target });
      await this.askTaskText(ctx, target);
      return;
    }

    await this.askProjectForTask(ctx, writableProjects, false);
  }

  private async askProjectForTask(ctx: Context, projects: Project[], switching: boolean) {
    if (!ctx.from) return;
    if (projects.length === 1) {
      await this.askBoardForTask(ctx, projects[0].id, switching);
      return;
    }

    const keyboard = new InlineKeyboard();
    for (const project of projects) keyboard.text(project.title, `choose_project:${project.id}`).row();
    keyboard.text("Отмена", "cancel_session");

    this.sessions.set(ctx.from.id, { mode: "new_task", switching });
    await this.replyOrEdit(ctx, "📁 Выберите проект:", keyboard);
  }

  private async handleChooseProject(ctx: Context) {
    if (!ctx.from || !("match" in ctx) || !ctx.match) return;
    const projectId = String(ctx.match[1]);
    const session = this.sessions.get(ctx.from.id);
    const switching = session?.mode === "new_task" ? Boolean(session.switching) : false;
    await ctx.answerCallbackQuery();
    await this.askBoardForTask(ctx, projectId, switching);
  }

  private async askBoardForTask(ctx: Context, projectId: string, switching: boolean) {
    if (!ctx.from) return;
    const access = await this.requireProjectPermission(ctx, projectId, "createTask");
    if (!access) return;
    const boards = await this.getProjectBoards(projectId);

    if (boards.length <= 1) {
      const boardPageId = boards[0]?.id;
      const target = { projectId, boardPageId };
      await this.saveDefaultTarget(ctx.from.id, access.user.id, target);
      if (switching) {
        this.sessions.delete(ctx.from.id);
        await this.replyOrEdit(ctx, "✅ Готово. Теперь задачи создаются в этой доске.", this.mainKeyboard());
        return;
      }
      this.sessions.set(ctx.from.id, { mode: "new_task", ...target });
      await this.askTaskText(ctx, target);
      return;
    }

    const keyboard = new InlineKeyboard();
    for (const board of boards) keyboard.text(board.title, `choose_board:${projectId}:${board.id}`).row();
    keyboard.text("Отмена", "cancel_session");

    this.sessions.set(ctx.from.id, { mode: "new_task", projectId, switching });
    await this.replyOrEdit(ctx, "📋 В проекте несколько досок. Куда создать задачу?", keyboard);
  }

  private async handleChooseBoard(ctx: Context) {
    if (!ctx.from || !("match" in ctx) || !ctx.match) return;
    const projectId = String(ctx.match[1]);
    const boardPageId = String(ctx.match[2]);
    const session = this.sessions.get(ctx.from.id);
    const switching = session?.mode === "new_task" ? Boolean(session.switching) : false;
    const access = await this.requireProjectPermission(ctx, projectId, "createTask");
    if (!access) return;
    const target = { projectId, boardPageId };
    await this.saveDefaultTarget(ctx.from.id, access.user.id, target);
    await ctx.answerCallbackQuery();
    if (switching) {
      this.sessions.delete(ctx.from.id);
      await this.replyOrEdit(ctx, "✅ Готово. Теперь задачи создаются в выбранной доске.", this.mainKeyboard());
      return;
    }
    this.sessions.set(ctx.from.id, { mode: "new_task", ...target });
    await this.askTaskText(ctx, target);
  }

  private async askTaskText(ctx: Context, target: TaskTarget) {
    const board = target.projectId && target.boardPageId ? await this.getBoardById(target.projectId, target.boardPageId) : undefined;
    await this.replyOrEdit(
      ctx,
      [
        board ? `📋 Доска: ${board.title}` : "📋 Доска выбрана.",
        "",
        "📝 Опишите задачу одним сообщением.",
        "Например: @ник сделать афишу до 01.01.2026 18:00",
      ].join("\n"),
      this.cancelKeyboard(),
    );
  }

  private async handleInboxNote(ctx: Context) {
    if (!ctx.from) return;
    const user = await this.getOrCreateUser(ctx);
    const projects = await this.repo.getUserProjects(user.id);
    const projectId = await this.resolveProjectForBotCapture(ctx, projects, "note_project", "createPage");
    if (!projectId) return;
    this.sessions.set(ctx.from.id, { mode: "inbox_note", projectId });
    await this.answerCallbackIfNeeded(ctx);
    await this.replyOrEdit(ctx, "📥 Напишите текст заметки — сохраню в Inbox проекта.", this.cancelKeyboard());
  }

  private async handleReminder(ctx: Context) {
    if (!ctx.from) return;
    const user = await this.getOrCreateUser(ctx);
    const projects = await this.repo.getUserProjects(user.id);
    const projectId = await this.resolveProjectForBotCapture(ctx, projects, "reminder_project", "manageReminders");
    if (!projectId) return;
    this.sessions.set(ctx.from.id, { mode: "reminder_text", projectId });
    await this.answerCallbackIfNeeded(ctx);
    await this.replyOrEdit(
      ctx,
      [
        "⏰ О чём напомнить?",
        "Можно сразу с датой: «позвонить отцу 01.01.2026 18:00».",
      ].join("\n"),
      this.cancelKeyboard(),
    );
  }

  private async resolveProjectForBotCapture(
    ctx: Context,
    projects: Project[],
    callbackPrefix: "note_project" | "reminder_project",
    permission: BotProjectPermission,
  ) {
    if (!projects.length) {
      await this.replyOrEdit(ctx, "📭 Сначала создайте проект или войдите по коду.", this.emptyProjectsKeyboard());
      return undefined;
    }
    const user = await this.getOrCreateUser(ctx);
    const allowedProjects = this.filterProjectsByPermission(projects, user.id, permission);
    if (!allowedProjects.length) {
      await this.denyProjectPermission(ctx, permission);
      return undefined;
    }
    if (allowedProjects.length === 1) return allowedProjects[0].id;
    const keyboard = new InlineKeyboard();
    for (const project of allowedProjects) keyboard.text(project.title, `${callbackPrefix}:${project.id}`).row();
    keyboard.text("Отмена", "cancel_session");
    await this.replyOrEdit(ctx, "📁 Выберите проект:", keyboard);
    return undefined;
  }

  private async handleChooseInboxProject(ctx: Context) {
    if (!ctx.from || !("match" in ctx) || !ctx.match) return;
    const projectId = String(ctx.match[1]);
    const access = await this.requireProjectPermission(ctx, projectId, "createPage");
    if (!access) return;
    this.sessions.set(ctx.from.id, { mode: "inbox_note", projectId });
    await ctx.answerCallbackQuery();
    await this.replyOrEdit(ctx, "📥 Напишите текст заметки — сохраню в Inbox проекта.", this.cancelKeyboard());
  }

  private async handleChooseReminderProject(ctx: Context) {
    if (!ctx.from || !("match" in ctx) || !ctx.match) return;
    const projectId = String(ctx.match[1]);
    const access = await this.requireProjectPermission(ctx, projectId, "manageReminders");
    if (!access) return;
    this.sessions.set(ctx.from.id, { mode: "reminder_text", projectId });
    await ctx.answerCallbackQuery();
    await this.replyOrEdit(ctx, "⏰ О чём напомнить? Можно сразу с датой: «позвонить отцу 01.01.2026 18:00».", this.cancelKeyboard());
  }

  private async handleVoice(ctx: Context) {
    if (!ctx.from || !ctx.message || !("voice" in ctx.message)) return;
    const voice = ctx.message.voice;
    if (!voice) return;

    if (voice.duration > this.voiceLimits.maxDurationSeconds) {
      await ctx.reply(`Голосовое слишком длинное. Максимум: ${this.voiceLimits.maxDurationSeconds} сек.`);
      return;
    }
    if (voice.file_size && voice.file_size > this.voiceLimits.maxFileBytes) {
      await ctx.reply(`Голосовой файл слишком большой. Максимум: ${Math.floor(this.voiceLimits.maxFileBytes / 1024 / 1024)} МБ.`);
      return;
    }
    if (!this.takeVoiceAttempt(ctx.from.id)) {
      await ctx.reply("Слишком много голосовых подряд. Подождите несколько минут и попробуйте снова.");
      return;
    }
    if (this.voiceInFlight >= this.voiceLimits.maxConcurrent) {
      await ctx.reply("Распознаватель сейчас занят. Попробуйте отправить голосовое чуть позже.");
      return;
    }

    this.voiceInFlight += 1;
    let tempDirectory: string | undefined;
    try {
      await ctx.reply("Распознаю голосовое локально...");
      const telegramFile = await this.bot.api.getFile(voice.file_id);
      if (!telegramFile.file_path) throw new Error("Telegram did not return a voice file path.");

      const response = await fetch(`https://api.telegram.org/file/bot${this.config.botToken}/${telegramFile.file_path}`);
      if (!response.ok) throw new Error(`Telegram file download failed with status ${response.status}.`);
      const contentLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > this.voiceLimits.maxFileBytes) {
        throw new Error("Voice file is larger than the configured limit.");
      }

      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > this.voiceLimits.maxFileBytes) {
        throw new Error("Voice file is larger than the configured limit.");
      }

      tempDirectory = await mkdtemp(join(tmpdir(), "nototime-voice-"));
      const voicePath = join(tempDirectory, "voice.ogg");
      await writeFile(voicePath, bytes);
      const transcript = await this.speechToText.transcribe(voicePath);

      await ctx.reply(`Распознано: ${transcript}`);
      await this.handleRecognizedVoice(ctx, transcript);
    } catch (error) {
      console.error("Voice recognition failed", error instanceof Error ? error.message : error);
      await ctx.reply("Не удалось распознать голосовое. Проверьте сервис распознавания или попробуйте ещё раз позже.");
    } finally {
      this.voiceInFlight = Math.max(0, this.voiceInFlight - 1);
      if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async handleRecognizedVoice(ctx: Context, transcript: string) {
    if (!ctx.from) return;
    if (this.sessions.has(ctx.from.id)) {
      await this.handleTextValue(ctx, transcript);
      return;
    }

    const intent = this.voiceIntentParser.parse(transcript);
    const user = await this.getOrCreateUser(ctx);
    const projects = await this.repo.getUserProjects(user.id);
    const permission: BotProjectPermission =
      intent.kind === "task"
        ? "createTask"
        : intent.kind === "note"
          ? "createPage"
          : "manageReminders";
    const allowedProjects = this.filterProjectsByPermission(projects, user.id, permission);
    const savedTarget = await this.ensureDefaultTarget(ctx.from.id, user.id, allowedProjects);
    const projectId = savedTarget?.projectId ?? (allowedProjects.length === 1 ? allowedProjects[0].id : undefined);

    if (!projectId) {
      await ctx.reply(
        `Распознал тип: ${voiceIntentLabel(intent)}. Сначала выберите проект${intent.kind === "task" ? " и доску" : ""} командой /switch, затем отправьте голосовое ещё раз.`,
      );
      return;
    }

    if (intent.kind === "task") {
      if (!savedTarget?.boardPageId) {
        await ctx.reply("Сначала выберите канбан-доску командой /switch, затем отправьте голосовое ещё раз.");
        return;
      }
      await this.prepareTaskDraft(ctx, projectId, savedTarget.boardPageId, intent.originalText);
      return;
    }

    if (intent.kind === "note") {
      await this.createInboxNote(ctx, projectId, intent.text);
      return;
    }

    if (intent.kind === "reminder") {
      await this.prepareReminder(ctx, projectId, intent.originalText);
      return;
    }

    await this.createVoiceNotification(ctx, projectId, intent.title, intent.description ?? intent.originalText, intent.assigneeUsername);
  }

  private async createVoiceNotification(
    ctx: Context,
    projectId: string,
    title: string,
    text: string,
    assigneeUsername?: string,
  ) {
    const access = await this.requireProjectPermission(ctx, projectId, "manageReminders");
    if (!access) return;
    const members = await this.repo.getProjectMembers(projectId);
    let recipient = access.user;

    if (assigneeUsername) {
      const candidate = await this.repo.getUserByUsername(assigneeUsername);
      const member = candidate && members.find((item) => String(item.id) === String(candidate.id));
      if (!member) {
        await ctx.reply(`Не нашёл участника @${assigneeUsername} в выбранном проекте.`);
        return;
      }
      recipient = member;
    }

    await this.repo.createNotification({
      projectId,
      userId: recipient.id,
      type: "voice_note",
      entityType: "project",
      entityId: `voice-${ctx.from?.id ?? "unknown"}-${Date.now()}`,
      sendAt: new Date().toISOString(),
      payload: { title, text },
    });
    await ctx.reply(`Уведомление поставлено в очередь${recipient.username ? ` для @${recipient.username}` : ""}.`);
  }

  private takeVoiceAttempt(telegramUserId: number) {
    const threshold = Date.now() - this.voiceLimits.rateWindowMs;
    const recent = (this.voiceAttempts.get(telegramUserId) ?? []).filter((timestamp) => timestamp >= threshold);
    if (recent.length >= this.voiceLimits.rateMax) {
      this.voiceAttempts.set(telegramUserId, recent);
      return false;
    }
    recent.push(Date.now());
    this.voiceAttempts.set(telegramUserId, recent);
    return true;
  }

  private async handleText(ctx: Context) {
    if (!ctx.from || !ctx.message || !("text" in ctx.message)) return;
    const text = ctx.message.text;
    if (!text) return;
    await this.handleTextValue(ctx, text);
  }

  private async handleTextValue(ctx: Context, text: string) {
    if (!ctx.from) return;
    const session = this.sessions.get(ctx.from.id);
    if (!session) {
      const user = await this.getOrCreateUser(ctx);
      const projects = await this.repo.getUserProjects(user.id);
      await this.showMenu(
        ctx,
        projects,
        "🤔 Не понял команду. Выберите действие в меню или напишите /new, чтобы создать задачу.",
      );
      return;
    }

    if (session.mode === "new_project") {
      await this.createProjectFromText(ctx, text);
      return;
    }

    if (session.mode === "join_project") {
      await this.joinProjectFromText(ctx, text);
      return;
    }

    if (session.mode === "inbox_note") {
      await this.createInboxNote(ctx, session.projectId, text);
      return;
    }

    if (session.mode === "reminder_text") {
      await this.prepareReminder(ctx, session.projectId, text);
      return;
    }

    if (session.mode === "reminder_date") {
      await this.createOneTimeReminder(ctx, session.projectId, session.title, text, session.description, session.targetUserId);
      return;
    }

    if (session.mode === "new_task" && session.projectId) {
      await this.prepareTaskDraft(ctx, session.projectId, session.boardPageId, text);
      return;
    }

    if (session.mode === "task_draft") {
      if (session.step === "title") {
        session.draft.title = text.trim();
        session.draft.description = text.trim();
        await this.askDraftAssignee(ctx, session);
        return;
      }
      if (session.step === "deadline") {
        const deadlineAt = this.parser.parse(`до ${text}`).deadlineAt;
        if (!deadlineAt) {
          await ctx.reply("🗓 Не понял дату. Формат: 01.01.2026 18:00.");
          return;
        }
        session.draft.deadlineAt = deadlineAt;
        await this.createTaskFromDraft(ctx, session);
        return;
      }
      return;
    }

    await ctx.reply("📍 Не выбрано место для задачи. Укажите проект и доску.", {
      reply_markup: new InlineKeyboard().text("Выбрать место", "switch_target").row().text("Меню", "menu"),
    });
  }

  private async createProjectFromText(ctx: Context, title: string) {
    if (!ctx.from) return;
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      await ctx.reply("⚠️ Название пустое. Напишите название проекта.");
      return;
    }

    const user = await this.getOrCreateUser(ctx);
    const project = await this.repo.createProject({ title: cleanTitle, ownerId: user.id });
    const target = await this.ensureDefaultTarget(ctx.from.id, user.id, [project]);
    this.sessions.delete(ctx.from.id);

    const keyboard = this.addWebAppButton(new InlineKeyboard(), "Открыть проект", this.webAppLink(`/project/${project.id}/workspace`))
      .text(target ? "Создать задачу" : "Выбрать доску", "new_task")
      .text("Меню", "menu")
      .row()
      .text("Мои проекты", "projects");

    await ctx.reply(["🎉 ПРОЕКТ СОЗДАН", "", `📁 ${project.title}`].join("\n"), { reply_markup: keyboard });
  }

  private async createInboxNote(ctx: Context, projectId: string, text: string) {
    if (!ctx.from) return;
    const cleanText = text.trim();
    if (!cleanText) {
      await ctx.reply("⚠️ Заметка пустая. Напишите текст для сохранения.");
      return;
    }

    const access = await this.requireProjectPermission(ctx, projectId, "createPage");
    if (!access) return;
    const currentUser = access.user;
    const nodes = await this.repo.getProjectNodes(projectId);
    let inbox = nodes.find((node) => node.projectId === projectId && node.title === "Inbox" && !node.isDeleted);
    if (!inbox) {
      inbox = await this.repo.createProjectNode(projectId, {
        actorUserId: currentUser.id,
        parentId: null,
        type: "folder",
        title: "Inbox",
        icon: "📥",
        order: nodes.filter((node) => (node.parentId ?? null) === null && !node.isDeleted).length,
        properties: { author: currentUser.id },
      });
    }

    await this.repo.createProjectNode(projectId, {
      actorUserId: currentUser.id,
      parentId: inbox.id,
      type: "page",
      title: cleanText.slice(0, 42) || "Заметка",
      icon: "📥",
      order: nodes.filter((node) => node.parentId === inbox?.id && !node.isDeleted).length,
      properties: { author: currentUser.id },
      initialBlocks: [
        {
          type: "paragraph",
          content: {
            text: cleanText,
            source: "telegram_bot",
            createdByTelegramId: String(ctx.from.id),
          },
          order: 0,
        },
      ],
    });
    this.sessions.delete(ctx.from.id);
    await ctx.reply(["📥 ЗАМЕТКА СОХРАНЕНА", "", "Добавил в Inbox проекта."].join("\n"), {
      reply_markup: this.addWebAppButton(new InlineKeyboard(), "Открыть Inbox", this.webAppLink(`/project/${projectId}/inbox`))
        .text("Еще заметку", "new_inbox_note")
        .text("Меню", "menu"),
    });
  }

  private async prepareReminder(ctx: Context, projectId: string, text: string) {
    if (!ctx.from) return;
    const cleanText = text.trim();
    if (!cleanText) {
      await ctx.reply("Напоминание пустое. Напиши, о чем напомнить.");
      return;
    }

    const access = await this.requireProjectPermission(ctx, projectId, "manageReminders");
    if (!access) return;
    const currentUser = access.user;
    const assigneeUsername = cleanText.match(/@([a-zA-Z0-9_]{3,})/)?.[1];
    const parsedDate = parseReminderDate(cleanText);
    const members = await this.repo.getProjectMembers(projectId);
    const mentionedMember = findMentionedUser(cleanText, members);
    const title =
      removeUserNameFromTitle(removeMention(stripDateTimePhrases(cleanText), assigneeUsername), mentionedMember).trim() ||
      removeUserNameFromTitle(removeMention(cleanText, assigneeUsername), mentionedMember).trim() ||
      cleanText;
    let targetUserId = currentUser.id;

    if (assigneeUsername) {
      const target = await this.repo.getUserByUsername(assigneeUsername);
      if (!target) {
        const session: Extract<Session, { mode: "reminder_assignee" }> = {
          mode: "reminder_assignee",
          projectId,
          title,
          remindAt: parsedDate?.toISOString(),
          description: cleanText,
          assigneeUsername,
        };
        this.sessions.set(ctx.from.id, session);
        await this.askReminderAssignee(ctx, session);
        return;
      }
      targetUserId = target.id;
    } else if (mentionedMember) {
      targetUserId = mentionedMember.id;
    }

    if (parsedDate) {
      await this.createOneTimeReminder(ctx, projectId, title, parsedDate.toISOString(), cleanText, targetUserId);
      return;
    }

    this.sessions.set(ctx.from.id, { mode: "reminder_date", projectId, title, targetUserId, description: cleanText });
    await ctx.reply("🗓 Когда? Например: «01.01.2026 18:00».", {
      reply_markup: this.cancelKeyboard(),
    });
  }

  private async askReminderAssignee(ctx: Context, session: Extract<Session, { mode: "reminder_assignee" }>) {
    if (!ctx.from) return;
    const members = await this.repo.getProjectMembers(session.projectId);
    const keyboard = new InlineKeyboard();
    keyboard.text("Себе", "reminder_assignee:self").row();
    for (const member of members.slice(0, 20)) {
      const label = member.username ? `@${member.username}` : [member.firstName, member.lastName].filter(Boolean).join(" ") || `User ${member.id}`;
      keyboard.text(label, `reminder_assignee:${member.id}`).row();
    }
    keyboard.text("Отмена", "cancel_session");

    await ctx.reply(
      session.assigneeUsername
        ? `👤 Не нашёл @${session.assigneeUsername}. Кому поставить напоминание?`
        : "👤 Кому поставить напоминание?",
      { reply_markup: keyboard },
    );
  }

  private async handleReminderAssignee(ctx: Context) {
    if (!ctx.from || !("match" in ctx) || !ctx.match) return;
    const session = this.sessions.get(ctx.from.id);
    if (!session || session.mode !== "reminder_assignee") return;
    const value = String(ctx.match[1]);
    const currentUser = await this.getOrCreateUser(ctx);
    const targetUserId = value === "self" ? currentUser.id : value;
    await ctx.answerCallbackQuery();

    if (session.remindAt) {
      await this.createOneTimeReminder(ctx, session.projectId, session.title, session.remindAt, session.description, targetUserId);
      return;
    }

    this.sessions.set(ctx.from.id, {
      mode: "reminder_date",
      projectId: session.projectId,
      title: session.title,
      targetUserId,
      description: session.description,
    });
    await this.replyOrEdit(
      ctx,
      "🗓 Когда? Например: «01.01.2026 18:00».",
      this.cancelKeyboard(),
    );
  }

  private async createOneTimeReminder(ctx: Context, projectId: string, title: string, dateText: string, description = "", targetUserId?: string) {
    if (!ctx.from) return;
    const access = await this.requireProjectPermission(ctx, projectId, "manageReminders");
    if (!access) return;
    const user = access.user;
    const isoDate = /^\d{4}-\d{2}-\d{2}/.test(dateText.trim()) ? new Date(dateText) : undefined;
    const remindAt = isoDate && Number.isFinite(isoDate.getTime()) ? isoDate : parseReminderDate(dateText) ?? new Date(dateText);
    if (!Number.isFinite(remindAt.getTime())) {
      await ctx.reply("Не смог разобрать дату. Напиши в формате DD.MM.YYYY 00:00, например 12.01.2026 18:00.");
      return;
    }

    const reminder = await this.repo.createReminder(projectId, {
      creatorUserId: user.id,
      targetUserId: targetUserId ?? user.id,
      sourceType: "bot",
      title,
      description,
      scheduleType: "once",
      remindAt: remindAt.toISOString(),
      channels: {
        app: true,
        telegramBot: true,
      },
    });
    this.sessions.delete(ctx.from.id);
    await ctx.reply(
      [
        "⏰ НАПОМИНАНИЕ СОЗДАНО",
        "",
        `🔔 ${reminder.title}`,
        `🗓 Когда: ${new Date(reminder.remindAt ?? remindAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })} МСК`,
      ].join("\n"),
      { reply_markup: this.mainKeyboard() },
    );
  }

  private async joinProjectFromText(ctx: Context, code: string) {
    if (!ctx.from) return;
    const user = await this.getOrCreateUser(ctx);
    await this.createJoinRequest(ctx, user, code);
    this.sessions.delete(ctx.from.id);
  }

  private async createJoinRequest(ctx: Context, user: User, code: string) {
    try {
      await this.repo.requestJoinByCode({
        code: code.trim(),
        userId: user.id,
        username: user.username,
        displayName: [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username,
      });
      await ctx.reply(
        ["📨 ЗАЯВКА ОТПРАВЛЕНА", "", "Отправил владельцу проекта.", "Как одобрят — проект появится в приложении."].join("\n"),
        { reply_markup: this.mainKeyboard() },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/already a member|уже/i.test(message)) {
        await ctx.reply("✅ Вы уже участник этого проекта — он есть в приложении.", {
          reply_markup: this.addWebAppButton(new InlineKeyboard(), "Открыть Mini App", this.webAppLink()),
        });
        return;
      }
      await ctx.reply("⚠️ Не удалось отправить заявку. Проверьте код и попробуйте снова.", {
        reply_markup: new InlineKeyboard().text("Ввести код еще раз", "join_project").row().text("Меню", "menu"),
      });
    }
  }

  private async prepareTaskDraft(ctx: Context, projectId: string, boardPageId: string | undefined, text: string) {
    if (!ctx.from) return;
    const access = await this.requireProjectPermission(ctx, projectId, "createTask");
    if (!access) return;
    if (!boardPageId) {
      await ctx.reply("📋 Сначала выберите доску для задачи.");
      await this.askBoardForTask(ctx, projectId, false);
      return;
    }
    const draft = this.parser.parse(text);
    const session: Session = { mode: "task_draft", step: "title", projectId, boardPageId, draft };
    this.sessions.set(ctx.from.id, session);

    if (!draft.title || draft.title === "Новая задача") {
      await ctx.reply("⚠️ Не понял название. Напишите коротко, что нужно сделать.", {
        reply_markup: this.cancelKeyboard(),
      });
      return;
    }

    await this.askDraftAssignee(ctx, session);
  }

  private async askDraftAssignee(ctx: Context, session: Extract<Session, { mode: "task_draft" }>) {
    if (!ctx.from) return;
    const username = session.draft.assigneeUsername;
    const members = await this.repo.getProjectMembers(session.projectId);
    const recognized = username ? await this.repo.getUserByUsername(username) : undefined;
    const recognizedMember = recognized ? members.find((member) => String(member.id) === String(recognized.id)) : undefined;
    if (recognizedMember) {
      (session.draft as any).assigneeId = recognizedMember.id;
      await this.askDraftDeadline(ctx, session);
      return;
    }

    const mentionedMember = findMentionedUser(session.draft.description ?? session.draft.title, members);
    if (mentionedMember) {
      (session.draft as any).assigneeId = mentionedMember.id;
      session.draft.title = removeUserNameFromTitle(session.draft.title, mentionedMember) || session.draft.title;
      await this.askDraftDeadline(ctx, session);
      return;
    }

    session.step = "assignee";
    this.sessions.set(ctx.from.id, session);
    const keyboard = new InlineKeyboard();
    for (const member of members.slice(0, 20)) {
      const label = member.username ? `@${member.username}` : [member.firstName, member.lastName].filter(Boolean).join(" ") || `User ${member.id}`;
      keyboard.text(label, `task_assignee:${member.id}`).row();
    }
    keyboard.text("Не назначен", "task_assignee:none").row().text("Отмена", "cancel_session");

    await ctx.reply(
      username
        ? `👤 Не нашёл @${username}. Выберите исполнителя из списка или оставьте без исполнителя.`
        : "👤 Не понял исполнителя. Выберите пользователя или оставьте без исполнителя.",
      { reply_markup: keyboard },
    );
  }

  private async handleTaskAssignee(ctx: Context) {
    if (!ctx.from || !("match" in ctx) || !ctx.match) return;
    const session = this.sessions.get(ctx.from.id);
    if (!session || session.mode !== "task_draft") return;
    const assigneeId = String(ctx.match[1]);
    if (assigneeId !== "none") (session.draft as any).assigneeId = assigneeId;
    else delete (session.draft as any).assigneeId;
    await ctx.answerCallbackQuery();
    await this.askDraftDeadline(ctx, session);
  }

  private async askDraftDeadline(ctx: Context, session: Extract<Session, { mode: "task_draft" }>) {
    if (!ctx.from) return;
    if (session.draft.deadlineAt) {
      await this.createTaskFromDraft(ctx, session);
      return;
    }

    session.step = "deadline";
    this.sessions.set(ctx.from.id, session);
    await this.replyOrEdit(
      ctx,
      "🗓 Не понял дедлайн. Формат: 01.01.2026 18:00 — или выберите «Без дедлайна».",
      new InlineKeyboard().text("Без дедлайна", "task_deadline:skip").row().text("Отмена", "cancel_session"),
    );
  }

  private async handleTaskDeadlineSkip(ctx: Context) {
    if (!ctx.from) return;
    const session = this.sessions.get(ctx.from.id);
    if (!session || session.mode !== "task_draft") return;
    delete session.draft.deadlineAt;
    await ctx.answerCallbackQuery();
    await this.createTaskFromDraft(ctx, session);
  }

  private async createTaskFromDraft(ctx: Context, session: Extract<Session, { mode: "task_draft" }>) {
    if (!ctx.from) return;
    await this.createTask(ctx, session.projectId, session.boardPageId, session.draft, (session.draft as any).assigneeId);
  }

  private async createTask(ctx: Context, projectId: string, boardPageId: string | undefined, parsed: ReturnType<TaskParser["parse"]>, assigneeId?: string) {
    if (!ctx.from) return;
    if (!this.notifications) throw new Error("Notification service is not configured");

    const access = await this.requireProjectPermission(ctx, projectId, "createTask");
    if (!access) return;
    const creator = access.user;
    const requestedAssignee = assigneeId
      ? await this.repo.getUserById(assigneeId)
      : parsed.assigneeUsername
        ? await this.repo.getUserByUsername(parsed.assigneeUsername)
        : undefined;
    const members = await this.repo.getProjectMembers(projectId);
    const assignee = requestedAssignee && members.some((member) => String(member.id) === String(requestedAssignee.id))
      ? requestedAssignee
      : undefined;

    const task = await this.repo.createTask({
      ...parsed,
      projectId,
      pageId: boardPageId,
      creatorId: creator.id,
      assigneeId: assignee?.id,
    });

    await this.notifications.scheduleTaskNotifications(task);
    await this.notifications.scanMentions(projectId, {
      entityType: "task",
      entityId: task.id,
      title: task.title,
      text: `${task.title} ${task.description ?? ""}`,
    });

    await this.saveDefaultTarget(ctx.from.id, creator.id, { projectId, boardPageId });
    this.sessions.delete(ctx.from.id);
    const board = boardPageId ? await this.getBoardById(projectId, boardPageId) : undefined;
    await ctx.reply(
      [
        "✅ ЗАДАЧА СОЗДАНА",
        "",
        `📌 ${task.title}`,
        board ? `📋 Доска: ${board.title}` : undefined,
      ].filter(Boolean).join("\n"),
      {
        reply_markup: this.addWebAppButton(
          new InlineKeyboard(),
          "Открыть Kanban",
          this.webAppLink(boardPageId
            ? `/project/${projectId}/workspace/page/${boardPageId}`
            : `/project/${projectId}/workspace`),
        )
          .text("Еще задачу", "new_task")
          .text("Меню", "menu")
          .row()
          .text("Мои задачи", "my_tasks"),
      },
    );
  }

  private async cancelSession(ctx: Context) {
    if (ctx.from) this.sessions.delete(ctx.from.id);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("❌ Действие отменено.", { reply_markup: this.mainKeyboard() });
  }

  private async getOrCreateUser(ctx: Context) {
    if (!ctx.from) throw new Error("Telegram user is missing");
    try {
      return await this.repo.findOrCreateTelegramUser({
        telegramId: String(ctx.from.id),
        username: ctx.from.username,
        firstName: ctx.from.first_name,
        lastName: ctx.from.last_name,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("User is blocked")) {
        await ctx.reply("⛔ Доступ к приложению заблокирован. Обратитесь к владельцу.");
      }
      throw error;
    }
  }

  private async requireProjectPermission(ctx: Context, projectId: string, permission: BotProjectPermission) {
    if (!ctx.from) return undefined;
    const user = await this.getOrCreateUser(ctx);
    const project = await this.repo.getProject(projectId);
    if (!project || !this.hasProjectPermission(project, user.id, "viewProject") || !this.hasProjectPermission(project, user.id, permission)) {
      await this.denyProjectPermission(ctx, permission);
      return undefined;
    }
    return { user, project };
  }

  private filterProjectsByPermission(projects: Project[], userId: string, permission: BotProjectPermission) {
    return projects.filter((project) => this.hasProjectPermission(project, userId, permission));
  }

  private hasProjectPermission(project: Project | undefined, userId: string | undefined, permission: BotProjectPermission) {
    return Boolean(this.projectPermissions(project, userId)[permission]);
  }

  private projectPermissions(project: Project | undefined, userId: string | undefined): Record<BotProjectPermission, boolean> {
    const roleName = this.projectRoleName(project, userId);
    if (!roleName) return { ...BOT_NO_PERMISSIONS };

    const member = (project?.members ?? []).find((item) => String(item.userId) === String(userId));
    const rawRole = member?.role as unknown;
    const explicitPermissions =
      rawRole && typeof rawRole === "object" && "permissions" in rawRole
        ? ((rawRole as { permissions?: Partial<Record<BotProjectPermission, boolean>> }).permissions ?? {})
        : {};

    return {
      ...BOT_ROLE_PERMISSIONS[roleName],
      ...explicitPermissions,
    };
  }

  private projectRoleName(project: Project | undefined, userId: string | undefined): BotProjectRoleName | undefined {
    if (!project || !userId) return undefined;
    if (String(project.ownerId) === String(userId)) return "owner";

    const member = (project.members ?? []).find((item) => String(item.userId) === String(userId));
    if (!member) return undefined;

    const rawRole = member.role as unknown;
    const rawRoleName = rawRole && typeof rawRole === "object" && "name" in rawRole ? (rawRole as { name?: unknown }).name : rawRole;
    return normalizeBotProjectRole(rawRoleName, "editor");
  }

  private async denyProjectPermission(ctx: Context, permission: BotProjectPermission) {
    if (ctx.from) this.sessions.delete(ctx.from.id);
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: "Нет прав для этого действия", show_alert: true }).catch(() => undefined);
    }
    await ctx.reply(botPermissionDeniedText(permission), { reply_markup: this.mainKeyboard() });
  }

  private async ensureDefaultTarget(telegramUserId: number | undefined, userId: string | undefined, projects: Project[]) {
    if (!telegramUserId || !projects.length) return undefined;
    const current = this.defaultTargets.get(telegramUserId);
    if (current && projects.some((project) => project.id === current.projectId)) return current;

    if (userId) {
      const preferences = await this.repo.getUserBotPreferences(userId);
      if (
        preferences.defaultProjectId &&
        preferences.defaultBoardPageId &&
        projects.some((project) => project.id === preferences.defaultProjectId)
      ) {
        const persisted = {
          projectId: preferences.defaultProjectId,
          boardPageId: preferences.defaultBoardPageId,
        };
        this.defaultTargets.set(telegramUserId, persisted);
        return persisted;
      }
    }

    if (projects.length !== 1) return undefined;
    const boards = await this.getProjectBoards(projects[0].id);
    if (boards.length !== 1) return undefined;

    const target = { projectId: projects[0].id, boardPageId: boards[0].id };
    await this.saveDefaultTarget(telegramUserId, userId, target);
    return target;
  }

  private async saveDefaultTarget(telegramUserId: number, userId: string | undefined, target: TaskTarget) {
    if (!target.projectId) return;
    const saved = {
      projectId: target.projectId,
      boardPageId: target.boardPageId ?? "",
    };
    this.defaultTargets.set(telegramUserId, saved);
    if (userId) {
      await this.repo.updateUserBotPreferences(userId, {
        defaultProjectId: saved.projectId,
        defaultBoardPageId: saved.boardPageId,
      });
    }
  }

  private async getProjectBoards(projectId: string) {
    const nodes = await this.repo.getProjectNodes(projectId);
    return [...nodes]
      .filter((node) => node.type === "kanban" && !node.isDeleted)
      .sort((left, right) => left.order - right.order);
  }

  private async getBoardById(projectId: string, boardPageId: string) {
    const boards = await this.getProjectBoards(projectId);
    return boards.find((board) => board.id === boardPageId);
  }

  private async showMenu(ctx: Context, projects: Project[], intro?: string) {
    const text = [
      intro ?? "🏠 ГЛАВНОЕ МЕНЮ",
      "",
      projects.length
        ? "Выберите действие ниже 👇"
        : "У вас пока нет проектов — создайте новый или войдите по коду.",
    ].join("\n");

    const keyboard = projects.length ? this.mainKeyboard(projects) : this.emptyProjectsKeyboard();
    await this.replyOrEdit(ctx, text, keyboard);
  }

  private mainKeyboard(_projects: Array<{ id?: string; title: string }> = []) {
    const keyboard = new InlineKeyboard();

    return keyboard
      .text("➕ Задача", "new_task")
      .text("📥 Inbox", "new_inbox_note")
      .row()
      .text("⏰ Напомнить", "new_reminder")
      .text("📍 Куда кладем?", "switch_target")
      .row()
      .text("📁 Проекты", "projects")
      .text("📋 Мои задачи", "my_tasks")
      .row()
      .text("📅 События", "week_events")
      .text("📊 Отчет", "weekly_report")
      .row()
      .text("🆕 Проект", "new_project")
      .text("🔑 Код", "join_project")
      .row()
      .text("🏠 Меню", "menu");
  }

  private emptyProjectsKeyboard() {
    return this.addWebAppButton(
      new InlineKeyboard()
      .text("Создать проект", "new_project")
      .row()
      .text("Ввести код проекта", "join_project"),
      "Открыть Mini App",
      this.webAppLink(),
    );
  }

  private webAppLink(target?: string) {
    return buildWebAppUrl(this.config.webAppUrl, target);
  }

  private addWebAppButton(keyboard: InlineKeyboard, label: string, url: string) {
    if (!this.isHttpsUrl(url)) return keyboard;
    return keyboard.row().webApp(label, url);
  }

  private isHttpsUrl(url: string) {
    return /^https:\/\//i.test(url);
  }

  private cancelKeyboard() {
    return new InlineKeyboard().text("Отмена", "cancel_session");
  }

  private projectsMessage(projects: Array<{ title: string }>) {
    if (!projects.length) {
      return "У вас пока нет проектов — создайте новый или войдите по коду.";
    }
    return ["📁 ВАШИ ПРОЕКТЫ", "", ...projects.map((project, index) => `${index + 1}. ${project.title}`)].join("\n");
  }

  private getStartCode(ctx: Context) {
    const text = ctx.message && "text" in ctx.message ? ctx.message.text ?? "" : "";
    const [, payload] = text.split(/\s+/, 2);
    if (!payload) return undefined;
    const normalized = payload.trim().replace(/^join[_-]/i, "");
    return normalized || undefined;
  }

  private async answerCallbackIfNeeded(ctx: Context) {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery();
  }

  private async replyOrEdit(ctx: Context, text: string, replyMarkup: InlineKeyboard) {
    if (ctx.callbackQuery?.message) {
      await ctx.editMessageText(text, { reply_markup: replyMarkup });
      return;
    }
    await ctx.reply(text, { reply_markup: replyMarkup });
  }
}

function readVoiceLimits(env = process.env) {
  return {
    maxDurationSeconds: positiveInteger(env.VOICE_MAX_DURATION_SECONDS, 120),
    maxFileBytes: positiveInteger(env.VOICE_MAX_FILE_BYTES, 20 * 1024 * 1024),
    rateWindowMs: positiveInteger(env.VOICE_RATE_WINDOW_MS, 10 * 60 * 1000),
    rateMax: positiveInteger(env.VOICE_RATE_MAX, 5),
    maxConcurrent: positiveInteger(env.VOICE_MAX_CONCURRENT, 2),
  };
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseReminderDate(text: string) {
  // Единый парсер дат/времени. Для напоминаний час по умолчанию — 09:00.
  return parseDateTime(text, { defaultHour: 9 });
}

function removeDatePhrase(text: string) {
  return text
    .replace(/\bсегодня\b/gi, "")
    .replace(/\bзавтра\b/gi, "")
    .replace(/\d{1,2}[.\-/]\d{1,2}(?:[.\-/]\d{2,4})?/g, "")
    .replace(/\d{1,2}[:.]\d{2}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function removeMention(text: string, username?: string) {
  if (!username) return text;
  return text
    .replace(new RegExp(`@${escapeRegExp(username)}`, "i"), "")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findMentionedUser(text: string, users: User[]) {
  const normalizedText = normalizeSearchText(text);
  const candidates = users
    .flatMap((user) => userSearchKeys(user).map((key) => ({ user, key })))
    .sort((left, right) => right.key.length - left.key.length);

  return candidates.find(({ key }) => containsSearchToken(normalizedText, key))?.user;
}

function removeUserNameFromTitle(title: string, user?: User) {
  if (!user) return cleanupTitle(title);

  let result = title;
  for (const key of userSearchKeys(user)) {
    result = result.replace(new RegExp(`(^|[^\\p{L}\\p{N}_@])${escapeRegExp(key)}(?=$|[^\\p{L}\\p{N}_])`, "giu"), " ");
  }
  return cleanupTitle(result);
}

function userSearchKeys(user: User) {
  const keys = [
    user.username ? `@${user.username}` : "",
    user.username ?? "",
    [user.firstName, user.lastName].filter(Boolean).join(" "),
    user.firstName ?? "",
    user.lastName ?? "",
  ]
    .map((value) => normalizeSearchText(value))
    .filter((value) => value.length >= 2);

  return [...new Set(keys)].sort((left, right) => right.length - left.length);
}

function containsSearchToken(text: string, token: string) {
  if (!token) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}_@])${escapeRegExp(token)}(?=$|[^\\p{L}\\p{N}_])`, "iu").test(text);
}

function normalizeSearchText(value: string) {
  return value.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}

function cleanupTitle(value: string) {
  return value
    .replace(/^(напомни|напомнить)\s+(мне|ему|ей|нам|им)?\s*/iu, "")
    .replace(/\b(должен|должна|должны|надо|нужно)\b/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isBotCompletedTask(task: { isArchived?: boolean; completedAt?: string; columnId: string; projectId: string; pageId?: string }, columns: Array<{ id: string; position: number; projectId?: string; pageId?: string; isArchive?: boolean; isHidden?: boolean }>) {
  if (task.isArchived || task.completedAt) return true;
  const finalColumn = columns
    .filter((column) => (!column.projectId || column.projectId === task.projectId) && sameBotBoard(column.pageId, task.pageId) && !column.isArchive && !column.isHidden)
    .sort((a, b) => a.position - b.position)
    .at(-1);
  return finalColumn?.id === task.columnId;
}

function sameBotBoard(columnPageId: string | undefined, taskPageId: string | undefined) {
  return taskPageId ? columnPageId === taskPageId : !columnPageId;
}

function normalizeBotProjectRole(value: unknown, fallback: BotProjectRoleName = "viewer"): BotProjectRoleName {
  const role = String(value ?? "").trim().toLowerCase();
  if (role === "owner" || role === "admin" || role === "editor" || role === "viewer") return role;
  return fallback;
}

function botPermissionDeniedText(permission: BotProjectPermission) {
  const action =
    permission === "createTask"
      ? "создавать задачи"
      : permission === "createPage"
        ? "создавать заметки и страницы"
        : permission === "manageReminders"
          ? "создавать напоминания"
          : permission === "viewAnalytics"
            ? "смотреть отчеты"
            : "выполнять это действие";

  return `🔒 У вас нет прав ${action} в этом проекте. Попросите владельца изменить роль или выберите другой проект.`;
}
