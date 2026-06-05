import { Bot, InlineKeyboard, type Context } from "grammy";
import type { BotConfig } from "../config.js";
import type { WorkspaceRepository } from "../ports.js";
import { escapeMarkdown, formatMskDate, formatMyTasksMessage } from "../services/formatters.js";
import { buildWeeklyReportText } from "../services/reportService.js";
import { NotificationService } from "../services/notificationService.js";
import { TaskParser } from "../services/taskParser.js";
import type { PageNode, Project, User } from "../types.js";

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

export class TelegramWorkspaceBot {
  private bot: Bot;
  private parser = new TaskParser();
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

  async start() {
    this.bot.catch((error) => {
      console.error("Telegram bot error", error.message);
    });
    await this.bot.api.setMyCommands([
      { command: "start", description: "Запуск и регистрация" },
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
    await this.bot.start({
      onStart: () => {
        console.log("Telegram Workspace Bot started");
      },
    });
  }

  private registerHandlers() {
    this.bot.command("start", (ctx) => this.handleStart(ctx));
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
          `Привет, ${name}!`,
          "",
          "Я связал твой Telegram с Workspace.",
          "У тебя пока нет проектов. Создай проект или подключись к командному по коду.",
        ].join("\n"),
        { reply_markup: this.emptyProjectsKeyboard() },
      );
      return;
    }

    await this.ensureDefaultTarget(ctx.from?.id, user.id, projects);
    await this.showMenu(ctx, projects, this.projectsMessage(projects));
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
        "Команды:",
        "",
        "/start - регистрация и главное меню",
        "/projects - мои проекты",
        "/task или /new - создать задачу текстом",
        "/where - показать, куда бот сейчас кладет задачи",
        "/switch - сменить проект или Kanban-доску по умолчанию",
        "/my - мои активные задачи",
        "/newproject - создать проект",
        "/join - подключиться к проекту по коду",
        "",
        "Пример задачи:",
        "@svyat сделать пригласительную до 12.01 18:00",
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
      await ctx.reply("Сначала создай проект или подключись к существующему.", { reply_markup: this.emptyProjectsKeyboard() });
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
      await ctx.reply("Сначала создай проект или подключись к существующему.", { reply_markup: this.emptyProjectsKeyboard() });
      return;
    }
    const role = project.members.find((member) => member.userId === user.id)?.role;
    if (project.ownerId !== user.id && role !== "owner" && role !== "admin") {
      await ctx.reply("Еженедельный отчет может запросить только владелец или администратор проекта.");
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
      await ctx.reply("Пока некуда складывать задачи. Создай проект или введи код приглашения.", {
        reply_markup: this.emptyProjectsKeyboard(),
      });
      return;
    }

    const project = projects.find((item) => item.id === target.projectId);
    const board = await this.getBoardById(target.projectId, target.boardPageId);
    await ctx.reply(
      [
        "Задачи по умолчанию будут создаваться здесь:",
        "",
        `Проект: ${project?.title ?? target.projectId}`,
        `Kanban-доска: ${board?.title ?? "Основная доска"}`,
      ].join("\n"),
      { reply_markup: new InlineKeyboard().text("Сменить", "switch_target").row().text("Меню", "menu") },
    );
  }

  private async handleSwitch(ctx: Context) {
    if (!ctx.from) return;
    const user = await this.getOrCreateUser(ctx);
    const projects = await this.repo.getUserProjects(user.id);
    await this.answerCallbackIfNeeded(ctx);
    await this.askProjectForTask(ctx, projects, true);
  }

  private async askNewProjectTitle(ctx: Context) {
    if (!ctx.from) return;
    this.sessions.set(ctx.from.id, { mode: "new_project" });
    await this.answerCallbackIfNeeded(ctx);
    await this.replyOrEdit(ctx, "Напиши название нового проекта.", this.cancelKeyboard());
  }

  private async askJoinCode(ctx: Context) {
    if (!ctx.from) return;
    this.sessions.set(ctx.from.id, { mode: "join_project" });
    await this.answerCallbackIfNeeded(ctx);
    await this.replyOrEdit(ctx, "Введи код проекта. Например: P1-ABC123", this.cancelKeyboard());
  }

  private async handleNewTask(ctx: Context) {
    if (!ctx.from) return;
    const user = await this.getOrCreateUser(ctx);
    const projects = await this.repo.getUserProjects(user.id);

    if (!projects.length) {
      await ctx.reply("Сначала создай проект или подключись к существующему.", {
        reply_markup: this.emptyProjectsKeyboard(),
      });
      return;
    }

    const target = await this.ensureDefaultTarget(ctx.from.id, user.id, projects);
    if (target) {
      this.sessions.set(ctx.from.id, { mode: "new_task", ...target });
      await this.askTaskText(ctx, target);
      return;
    }

    await this.askProjectForTask(ctx, projects, false);
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
    await this.replyOrEdit(ctx, "Выбери проект для задач:", keyboard);
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
    const boards = await this.getProjectBoards(projectId);

    if (boards.length <= 1) {
      const user = await this.getOrCreateUser(ctx);
      const boardPageId = boards[0]?.id;
      const target = { projectId, boardPageId };
      await this.saveDefaultTarget(ctx.from.id, user.id, target);
      if (switching) {
        this.sessions.delete(ctx.from.id);
        await this.replyOrEdit(ctx, "Готово. Теперь задачи будут создаваться в этой Kanban-доске.", this.mainKeyboard());
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
    await this.replyOrEdit(ctx, "В проекте несколько Kanban-досок. Выбери, куда создать задачу:", keyboard);
  }

  private async handleChooseBoard(ctx: Context) {
    if (!ctx.from || !("match" in ctx) || !ctx.match) return;
    const projectId = String(ctx.match[1]);
    const boardPageId = String(ctx.match[2]);
    const session = this.sessions.get(ctx.from.id);
    const switching = session?.mode === "new_task" ? Boolean(session.switching) : false;
    const user = await this.getOrCreateUser(ctx);
    const target = { projectId, boardPageId };
    await this.saveDefaultTarget(ctx.from.id, user.id, target);
    await ctx.answerCallbackQuery();
    if (switching) {
      this.sessions.delete(ctx.from.id);
      await this.replyOrEdit(ctx, "Готово. Теперь задачи будут создаваться в выбранной Kanban-доске.", this.mainKeyboard());
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
        board ? `Kanban-доска: ${board.title}` : "Kanban-доска выбрана.",
        "",
        "Напиши задачу свободным текстом.",
        "Например: @svyat сделать пригласительную до 12.01 18:00",
      ].join("\n"),
      this.cancelKeyboard(),
    );
  }

  private async handleInboxNote(ctx: Context) {
    if (!ctx.from) return;
    const user = await this.getOrCreateUser(ctx);
    const projects = await this.repo.getUserProjects(user.id);
    const projectId = await this.resolveProjectForBotCapture(ctx, projects, "note_project");
    if (!projectId) return;
    this.sessions.set(ctx.from.id, { mode: "inbox_note", projectId });
    await this.answerCallbackIfNeeded(ctx);
    await this.replyOrEdit(ctx, "Напиши текст заметки. Я сохраню ее в Inbox выбранного проекта.", this.cancelKeyboard());
  }

  private async handleReminder(ctx: Context) {
    if (!ctx.from) return;
    const user = await this.getOrCreateUser(ctx);
    const projects = await this.repo.getUserProjects(user.id);
    const projectId = await this.resolveProjectForBotCapture(ctx, projects, "reminder_project");
    if (!projectId) return;
    this.sessions.set(ctx.from.id, { mode: "reminder_text", projectId });
    await this.answerCallbackIfNeeded(ctx);
    await this.replyOrEdit(
      ctx,
      [
        "Напиши, о чем напомнить.",
        "Можно сразу с датой: написать отцу завтра 18:00",
      ].join("\n"),
      this.cancelKeyboard(),
    );
  }

  private async resolveProjectForBotCapture(ctx: Context, projects: Project[], callbackPrefix: "note_project" | "reminder_project") {
    if (!projects.length) {
      await this.replyOrEdit(ctx, "Сначала создай проект или подключись к существующему.", this.emptyProjectsKeyboard());
      return undefined;
    }
    if (projects.length === 1) return projects[0].id;
    const keyboard = new InlineKeyboard();
    for (const project of projects) keyboard.text(project.title, `${callbackPrefix}:${project.id}`).row();
    keyboard.text("Отмена", "cancel_session");
    await this.replyOrEdit(ctx, "Выбери проект, куда сохранить:", keyboard);
    return undefined;
  }

  private async handleChooseInboxProject(ctx: Context) {
    if (!ctx.from || !("match" in ctx) || !ctx.match) return;
    const projectId = String(ctx.match[1]);
    this.sessions.set(ctx.from.id, { mode: "inbox_note", projectId });
    await ctx.answerCallbackQuery();
    await this.replyOrEdit(ctx, "Напиши текст заметки. Я сохраню ее в Inbox выбранного проекта.", this.cancelKeyboard());
  }

  private async handleChooseReminderProject(ctx: Context) {
    if (!ctx.from || !("match" in ctx) || !ctx.match) return;
    const projectId = String(ctx.match[1]);
    this.sessions.set(ctx.from.id, { mode: "reminder_text", projectId });
    await ctx.answerCallbackQuery();
    await this.replyOrEdit(ctx, "Напиши, о чем напомнить. Можно сразу с датой: написать отцу завтра 18:00", this.cancelKeyboard());
  }

  private async handleText(ctx: Context) {
    if (!ctx.from || !ctx.message || !("text" in ctx.message)) return;
    const text = ctx.message.text;
    if (!text) return;
    const session = this.sessions.get(ctx.from.id);
    if (!session) {
      const user = await this.getOrCreateUser(ctx);
      const projects = await this.repo.getUserProjects(user.id);
      await this.showMenu(
        ctx,
        projects,
        "Я не понял, что нужно сделать. Выбери действие в меню или напиши /new, чтобы создать задачу.",
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
          await ctx.reply("Не смог разобрать дату. Напиши в формате DD.MM.YYYY 00:00, например 12.01.2026 18:00.");
          return;
        }
        session.draft.deadlineAt = deadlineAt;
        await this.createTaskFromDraft(ctx, session);
        return;
      }
      return;
    }

    await ctx.reply("Не хватает проекта или Kanban-доски для задачи. Выбери место, куда ее сохранить.", {
      reply_markup: new InlineKeyboard().text("Выбрать место", "switch_target").row().text("Меню", "menu"),
    });
  }

  private async createProjectFromText(ctx: Context, title: string) {
    if (!ctx.from) return;
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      await ctx.reply("Название пустое. Напиши название проекта.");
      return;
    }

    const user = await this.getOrCreateUser(ctx);
    const project = await this.repo.createProject({ title: cleanTitle, ownerId: user.id });
    const target = await this.ensureDefaultTarget(ctx.from.id, user.id, [project]);
    this.sessions.delete(ctx.from.id);

    const keyboard = this.addWebAppButton(new InlineKeyboard(), "Открыть проект", `${this.config.webAppUrl}/project/${project.id}/workspace`)
      .text(target ? "Создать задачу" : "Выбрать доску", "new_task")
      .text("Меню", "menu")
      .row()
      .text("Мои проекты", "projects");

    await ctx.reply(`Проект создан: ${project.title}`, { reply_markup: keyboard });
  }

  private async createInboxNote(ctx: Context, projectId: string, text: string) {
    if (!ctx.from) return;
    const cleanText = text.trim();
    if (!cleanText) {
      await ctx.reply("Заметка пустая. Напиши текст, который нужно сохранить в Inbox.");
      return;
    }

    const space = await this.repo.getProjectSpace(projectId);
    const nowIso = new Date().toISOString();
    let inbox = (space.nodes ?? []).find((node) => node.projectId === projectId && node.title === "Inbox");
    if (!inbox) {
      inbox = {
        id: `inbox_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        projectId,
        parentId: null,
        type: "folder",
        title: "Inbox",
        icon: "📥",
        order: space.nodes?.length ?? 0,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      space.nodes = [...(space.nodes ?? []), inbox];
    }

    const notePage = {
      id: `page_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      projectId,
      parentId: inbox.id,
      type: "page" as const,
      title: cleanText.slice(0, 42) || "Заметка",
      icon: "📥",
      order: (space.nodes ?? []).filter((node) => node.parentId === inbox?.id).length,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    space.nodes = [...(space.nodes ?? []), notePage];
    const pageId = notePage.id;
    const blocks = space.blocks ?? [];
    const order = blocks.filter((block) => block.pageId === pageId).length;
    space.blocks = [
      ...blocks,
      {
        id: `block_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        pageId,
        type: "paragraph",
        content: {
          text: cleanText,
          source: "telegram_bot",
          createdByTelegramId: String(ctx.from.id),
        },
        order,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ];
    await this.repo.saveProjectSpace(projectId, space);
    this.sessions.delete(ctx.from.id);
    await ctx.reply("Готово. Сохранил заметку в Inbox.", {
      reply_markup: this.addWebAppButton(new InlineKeyboard(), "Открыть Inbox", `${this.config.webAppUrl}/project/${projectId}/inbox`)
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

    const currentUser = await this.getOrCreateUser(ctx);
    const assigneeUsername = cleanText.match(/@([a-zA-Z0-9_]{3,})/)?.[1];
    const parsedDate = parseReminderDate(cleanText);
    const title =
      removeMention(removeDatePhrase(cleanText), assigneeUsername).trim() ||
      removeMention(cleanText, assigneeUsername).trim() ||
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
    }

    if (parsedDate) {
      await this.createOneTimeReminder(ctx, projectId, title, parsedDate.toISOString(), cleanText, targetUserId);
      return;
    }

    this.sessions.set(ctx.from.id, { mode: "reminder_date", projectId, title, targetUserId, description: cleanText });
    await ctx.reply("Когда напомнить? Напиши дату и время. Например: завтра 18:00 или 12.01.2026 18:00.", {
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
        ? `Я не нашел пользователя @${session.assigneeUsername}. Кому поставить напоминание?`
        : "Кому поставить напоминание?",
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
      "Когда напомнить? Напиши дату и время. Например: завтра 18:00 или 12.01.2026 18:00.",
      this.cancelKeyboard(),
    );
  }

  private async createOneTimeReminder(ctx: Context, projectId: string, title: string, dateText: string, description = "", targetUserId?: string) {
    if (!ctx.from) return;
    const user = await this.getOrCreateUser(ctx);
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
        "Готово. Создал разовое напоминание.",
        `Когда: ${new Date(reminder.remindAt ?? remindAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })} МСК`,
        `Текст: ${reminder.title}`,
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
      await ctx.reply("Заявка отправлена владельцу проекта. Когда ее подтвердят, проект появится в Mini App.", {
        reply_markup: this.mainKeyboard(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/already a member|уже/i.test(message)) {
        await ctx.reply("Ты уже участник этого проекта. Открой Mini App, проект должен быть в списке.", {
          reply_markup: this.addWebAppButton(new InlineKeyboard(), "Открыть Mini App", this.config.webAppUrl),
        });
        return;
      }
      await ctx.reply("Не удалось отправить заявку. Проверь код проекта и попробуй еще раз.", {
        reply_markup: new InlineKeyboard().text("Ввести код еще раз", "join_project").row().text("Меню", "menu"),
      });
    }
  }

  private async prepareTaskDraft(ctx: Context, projectId: string, boardPageId: string | undefined, text: string) {
    if (!ctx.from) return;
    if (!boardPageId) {
      await ctx.reply("Сначала выбери Kanban-доску, куда сохранить задачу.");
      await this.askBoardForTask(ctx, projectId, false);
      return;
    }
    const draft = this.parser.parse(text);
    const session: Session = { mode: "task_draft", step: "title", projectId, boardPageId, draft };
    this.sessions.set(ctx.from.id, session);

    if (!draft.title || draft.title === "Новая задача") {
      await ctx.reply("Я не понял название задачи. Напиши коротко, что нужно сделать.", {
        reply_markup: this.cancelKeyboard(),
      });
      return;
    }

    await this.askDraftAssignee(ctx, session);
  }

  private async askDraftAssignee(ctx: Context, session: Extract<Session, { mode: "task_draft" }>) {
    if (!ctx.from) return;
    const username = session.draft.assigneeUsername;
    const recognized = username ? await this.repo.getUserByUsername(username) : undefined;
    if (recognized) {
      (session.draft as any).assigneeId = recognized.id;
      await this.askDraftDeadline(ctx, session);
      return;
    }

    session.step = "assignee";
    this.sessions.set(ctx.from.id, session);
    const members = await this.repo.getProjectMembers(session.projectId);
    const keyboard = new InlineKeyboard();
    for (const member of members.slice(0, 20)) {
      const label = member.username ? `@${member.username}` : [member.firstName, member.lastName].filter(Boolean).join(" ") || `User ${member.id}`;
      keyboard.text(label, `task_assignee:${member.id}`).row();
    }
    keyboard.text("Не назначен", "task_assignee:none").row().text("Отмена", "cancel_session");

    await ctx.reply(
      username
        ? `Я не нашел пользователя @${username}. Выбери исполнителя из списка или оставь задачу без исполнителя.`
        : "Я не понял исполнителя. Выбери пользователя или оставь задачу без исполнителя.",
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
      "Я не понял дедлайн. Напиши дату и время в формате DD.MM.YYYY 00:00 или выбери “Без дедлайна”.",
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

    const creator = await this.getOrCreateUser(ctx);
    const assignee = assigneeId
      ? await this.repo.getUserById(assigneeId)
      : parsed.assigneeUsername
        ? await this.repo.getUserByUsername(parsed.assigneeUsername)
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
        `Готово. Задача создана: ${task.title}`,
        board ? `Доска: ${board.title}` : undefined,
      ].filter(Boolean).join("\n"),
      {
        reply_markup: this.addWebAppButton(
          new InlineKeyboard(),
          "Открыть Kanban",
          `${this.config.webAppUrl}/project/${projectId}/workspace/page/${boardPageId ?? ""}`,
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
    await ctx.editMessageText("Действие отменено.", { reply_markup: this.mainKeyboard() });
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
        await ctx.reply("Доступ к приложению и боту заблокирован. Обратитесь к владельцу приложения.");
      }
      throw error;
    }
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
    const space = await this.repo.getProjectSpace(projectId);
    return [...(space.nodes ?? [])]
      .filter((node) => node.type === "kanban")
      .sort((left, right) => left.order - right.order);
  }

  private async getBoardById(projectId: string, boardPageId: string) {
    const boards = await this.getProjectBoards(projectId);
    return boards.find((board) => board.id === boardPageId);
  }

  private async showMenu(ctx: Context, projects: Project[], intro?: string) {
    const text = [
      intro ?? "Главное меню.",
      "",
      projects.length
        ? "Выбери действие ниже. Если у тебя несколько проектов, сначала проверь, куда бот кладет задачи."
        : "Пока нет проектов. Создай новый проект или введи код приглашения.",
    ].join("\n");

    const keyboard = projects.length ? this.mainKeyboard(projects) : this.emptyProjectsKeyboard();
    await this.replyOrEdit(ctx, text, keyboard);
  }

  private mainKeyboard(projects: Array<{ id?: string; title: string }> = []) {
    const keyboard = this.addWebAppButton(new InlineKeyboard(), "Открыть Mini App", this.config.webAppUrl);

    for (const project of projects.slice(0, 6)) {
      if (!project.id) continue;
      if (this.isHttpsUrl(this.config.webAppUrl)) {
        keyboard.row().webApp(`Открыть: ${project.title}`, `${this.config.webAppUrl}/project/${project.id}/workspace`);
      }
    }

    return keyboard
      .row()
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
      this.config.webAppUrl,
    );
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
      return "У тебя пока нет проектов. Создай проект или введи код приглашения.";
    }
    return ["Твои проекты:", "", ...projects.map((project, index) => `${index + 1}. ${project.title}`)].join("\n");
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

function parseReminderDate(text: string) {
  const normalized = text.trim().toLowerCase();
  const timeMatch = normalized.match(/(?:^|\s)(\d{1,2})[:.](\d{2})(?:\s|$)/);
  const hours = timeMatch ? Number(timeMatch[1]) : 9;
  const minutes = timeMatch ? Number(timeMatch[2]) : 0;
  const now = new Date();

  if (/\bзавтра\b/i.test(normalized)) {
    const date = new Date(now);
    date.setDate(date.getDate() + 1);
    date.setHours(hours, minutes, 0, 0);
    return date;
  }

  if (/\bсегодня\b/i.test(normalized)) {
    const date = new Date(now);
    date.setHours(hours, minutes, 0, 0);
    return date;
  }

  const dateMatch = normalized.match(/(\d{1,2})[.\-/](\d{1,2})(?:[.\-/](\d{2,4}))?/);
  if (dateMatch) {
    const day = Number(dateMatch[1]);
    const month = Number(dateMatch[2]) - 1;
    const rawYear = dateMatch[3] ? Number(dateMatch[3]) : now.getFullYear();
    const year = rawYear < 100 ? 2000 + rawYear : rawYear;
    const date = new Date(year, month, day, hours, minutes, 0, 0);
    if (Number.isFinite(date.getTime())) return date;
  }

  return undefined;
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
