import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { CreateTaskDto, UpdateTaskDto, MoveTaskDto, ReorderTasksDto } from './tasks.dto';
import { addHours } from 'date-fns';

const TASK_INCLUDE = {
  assignee: true,
  subtasks: { orderBy: { position: 'asc' as const } },
  tags: { include: { tag: true } },
  creator: true,
};

@Injectable()
export class TasksService {
  constructor(
    private prisma: PrismaService,
    private projectsService: ProjectsService,
    @InjectQueue('notifications') private notifQueue: Queue,
  ) {}

  // ─── Все задачи проекта по колонкам ────────────────────────
  async findByProject(projectId: number, userId: number) {
    await this.projectsService.assertMember(projectId, userId);

    const tasks = await this.prisma.task.findMany({
      where: { projectId, isArchived: false },
      include: TASK_INCLUDE,
      orderBy: { position: 'asc' },
    });

    return tasks.map(this.formatTask);
  }

  // ─── Задачи конкретной колонки ──────────────────────────────
  async findByColumn(columnId: number, userId: number) {
    const column = await this.prisma.column.findUnique({ where: { id: columnId } });
    if (!column) throw new NotFoundException('Колонка не найдена');
    await this.projectsService.assertMember(column.projectId, userId);

    const tasks = await this.prisma.task.findMany({
      where: { columnId, isArchived: false },
      include: TASK_INCLUDE,
      orderBy: { position: 'asc' },
    });

    return tasks.map(this.formatTask);
  }

  // ─── Мои задачи ────────────────────────────────────────────
  async findMyTasks(userId: number) {
    const tasks = await this.prisma.task.findMany({
      where: {
        assigneeId: userId,
        isArchived: false,
        column: { isArchive: false },
      },
      include: { ...TASK_INCLUDE, project: true },
      orderBy: [{ deadlineAt: 'asc' }, { priority: 'desc' }],
    });

    const now = new Date();
    const red: any[] = [];
    const yellow: any[] = [];
    const green: any[] = [];
    const noDate: any[] = [];

    for (const task of tasks) {
      const formatted = this.formatTask(task);
      if (!task.deadlineAt) { noDate.push(formatted); continue; }
      const diffHours = (task.deadlineAt.getTime() - now.getTime()) / 3600000;
      if (diffHours < 12) red.push(formatted);
      else if (diffHours < 48) yellow.push(formatted);
      else green.push(formatted);
    }

    const completedCount = await this.prisma.task.count({
      where: { assigneeId: userId, column: { isArchive: true } },
    });
    const totalCount = tasks.length + completedCount;

    return { red, yellow, green, noDate, stats: { completed: completedCount, total: totalCount } };
  }

  // ─── Одна задача ───────────────────────────────────────────
  async findOne(taskId: number, userId: number) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: { ...TASK_INCLUDE, history: { include: { user: true }, orderBy: { createdAt: 'desc' }, take: 20 } },
    });
    if (!task) throw new NotFoundException('Задача не найдена');
    await this.projectsService.assertMember(task.projectId, userId);
    return this.formatTask(task);
  }

  // ─── Создать задачу ────────────────────────────────────────
  async create(projectId: number, dto: CreateTaskDto, userId: number) {
    await this.projectsService.assertMember(projectId, userId);

    const column = await this.prisma.column.findUnique({ where: { id: dto.columnId } });
    if (!column || column.projectId !== projectId) throw new NotFoundException('Колонка не найдена');

    const lastTask = await this.prisma.task.findFirst({
      where: { columnId: dto.columnId },
      orderBy: { position: 'desc' },
    });

    const { tagIds, ...rest } = dto;

    const task = await this.prisma.task.create({
      data: {
        ...rest,
        projectId,
        creatorId: userId,
        position: (lastTask?.position ?? -1) + 1,
        deadlineAt: dto.deadlineAt ? new Date(dto.deadlineAt) : undefined,
        tags: tagIds?.length
          ? { create: tagIds.map((tagId) => ({ tag: { connect: { id: tagId } } })) }
          : undefined,
      },
      include: TASK_INCLUDE,
    });

    // Записываем историю
    await this.writeHistory(task.id, userId, 'created', null, { title: task.title });

    // Ставим уведомления если есть дедлайн и исполнитель
    if (task.deadlineAt && task.assigneeId) {
      await this.scheduleNotifications(task.id, task.assigneeId, task.deadlineAt);
      // Уведомление о назначении
      await this.notifQueue.add('send', {
        type: 'TASK_ASSIGNED',
        taskId: task.id,
        userId: task.assigneeId,
      });
    }

    return this.formatTask(task);
  }

  // ─── Обновить задачу ───────────────────────────────────────
  async update(taskId: number, dto: UpdateTaskDto, userId: number) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException('Задача не найдена');
    await this.projectsService.assertMember(task.projectId, userId);

    const { tagIds, ...rest } = dto;

    // Если меняется исполнитель или дедлайн — пересоздаём уведомления
    const assigneeChanged = dto.assigneeId !== undefined && dto.assigneeId !== task.assigneeId;
    const deadlineChanged = dto.deadlineAt !== undefined;

    const updated = await this.prisma.task.update({
      where: { id: taskId },
      data: {
        ...rest,
        deadlineAt: dto.deadlineAt ? new Date(dto.deadlineAt) : undefined,
        tags: tagIds !== undefined
          ? {
              deleteMany: {},
              create: tagIds.map((tagId) => ({ tag: { connect: { id: tagId } } })),
            }
          : undefined,
      },
      include: TASK_INCLUDE,
    });

    await this.writeHistory(taskId, userId, 'edited', task, updated);

    if ((assigneeChanged || deadlineChanged) && updated.deadlineAt && updated.assigneeId) {
      // Отменяем старые уведомления
      await this.prisma.notification.deleteMany({
        where: { taskId, isSent: false },
      });
      await this.scheduleNotifications(taskId, updated.assigneeId, updated.deadlineAt);

      if (assigneeChanged) {
        await this.notifQueue.add('send', {
          type: 'TASK_ASSIGNED',
          taskId,
          userId: updated.assigneeId,
        });
      }
    }

    return this.formatTask(updated);
  }

  // ─── Переместить задачу (drag & drop) ──────────────────────
  async move(taskId: number, dto: MoveTaskDto, userId: number) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException('Задача не найдена');
    await this.projectsService.assertMember(task.projectId, userId);

    const oldColumnId = task.columnId;

    const updated = await this.prisma.task.update({
      where: { id: taskId },
      data: {
        columnId: dto.columnId,
        position: dto.position ?? 0,
      },
      include: TASK_INCLUDE,
    });

    await this.writeHistory(taskId, userId, 'moved', { columnId: oldColumnId }, { columnId: dto.columnId });

    return this.formatTask(updated);
  }

  // ─── Переупорядочить задачи в колонке ──────────────────────
  async reorder(dto: ReorderTasksDto, userId: number) {
    const column = await this.prisma.column.findUnique({ where: { id: dto.columnId } });
    if (!column) throw new NotFoundException('Колонка не найдена');
    await this.projectsService.assertMember(column.projectId, userId);

    await Promise.all(
      dto.orderedIds.map((id, position) =>
        this.prisma.task.update({ where: { id }, data: { position } }),
      ),
    );

    return { success: true };
  }

  // ─── Архивировать задачу ───────────────────────────────────
  async archive(taskId: number, userId: number) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException('Задача не найдена');
    await this.projectsService.assertMember(task.projectId, userId);

    // Отменяем уведомления
    await this.prisma.notification.deleteMany({ where: { taskId, isSent: false } });

    const updated = await this.prisma.task.update({
      where: { id: taskId },
      data: { isArchived: true, archivedAt: new Date() },
    });

    await this.writeHistory(taskId, userId, 'archived', null, null);

    // Уведомление о завершении
    if (task.assigneeId) {
      await this.notifQueue.add('send', {
        type: 'TASK_COMPLETED',
        taskId,
        userId: task.assigneeId,
      });
    }

    return updated;
  }

  // ─── Восстановить из архива ────────────────────────────────
  async unarchive(taskId: number, columnId: number, userId: number) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException('Задача не найдена');
    await this.projectsService.assertMember(task.projectId, userId);

    return this.prisma.task.update({
      where: { id: taskId },
      data: { isArchived: false, archivedAt: null, columnId },
    });
  }

  // ─── Удалить задачу навсегда ───────────────────────────────
  async remove(taskId: number, userId: number) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException('Задача не найдена');
    await this.projectsService.assertOwner(task.projectId, userId);

    await this.prisma.task.delete({ where: { id: taskId } });
    return { success: true };
  }

  // ─── Архив проекта ─────────────────────────────────────────
  async getArchive(projectId: number, userId: number) {
    await this.projectsService.assertMember(projectId, userId);

    const tasks = await this.prisma.task.findMany({
      where: { projectId, isArchived: true },
      include: TASK_INCLUDE,
      orderBy: { archivedAt: 'desc' },
    });

    return tasks.map(this.formatTask);
  }

  // ─── Поиск ─────────────────────────────────────────────────
  async search(projectId: number, query: string, userId: number) {
    await this.projectsService.assertMember(projectId, userId);

    const tasks = await this.prisma.task.findMany({
      where: {
        projectId,
        isArchived: false,
        OR: [
          { title: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
          { tags: { some: { tag: { title: { contains: query, mode: 'insensitive' } } } } },
          { assignee: { username: { contains: query, mode: 'insensitive' } } },
          { assignee: { firstName: { contains: query, mode: 'insensitive' } } },
        ],
      },
      include: TASK_INCLUDE,
      take: 30,
    });

    return tasks.map(this.formatTask);
  }

  // ─── Планирование уведомлений ──────────────────────────────
  async scheduleNotifications(taskId: number, userId: number, deadline: Date) {
    const now = new Date();

    const schedule = [
      { type: 'HALF_TIME',       at: new Date((now.getTime() + deadline.getTime()) / 2) },
      { type: 'HOURS_15',        at: new Date(deadline.getTime() - 15 * 3600000) },
      { type: 'HOURS_2',         at: new Date(deadline.getTime() - 2 * 3600000) },
      { type: 'DEADLINE_REACHED', at: deadline },
    ];

    const future = schedule.filter((s) => s.at > now);

    await this.prisma.notification.createMany({
      data: future.map((s) => ({
        taskId,
        userId,
        type: s.type as any,
        scheduledAt: s.at,
      })),
    });
  }

  // ─── История изменений ─────────────────────────────────────
  private async writeHistory(
    taskId: number,
    userId: number,
    action: string,
    oldValue: any,
    newValue: any,
  ) {
    await this.prisma.taskHistory.create({
      data: { taskId, userId, action, oldValue, newValue },
    });
  }

  // ─── Форматирование задачи ─────────────────────────────────
  private formatTask(task: any) {
    const subtasks = task.subtasks ?? [];
    const completedSubtasks = subtasks.filter((s: any) => s.isCompleted).length;

    return {
      ...task,
      tags: task.tags?.map((tt: any) => tt.tag ?? tt) ?? [],
      subtasksProgress: {
        total: subtasks.length,
        completed: completedSubtasks,
        percent: subtasks.length ? Math.round((completedSubtasks / subtasks.length) * 100) : 0,
      },
    };
  }
}
