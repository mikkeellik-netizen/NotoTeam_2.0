import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';

@Injectable()
export class SubtasksService {
  constructor(
    private prisma: PrismaService,
    private projectsService: ProjectsService,
  ) {}

  private async getTaskAndCheckAccess(taskId: number, userId: number) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException('Задача не найдена');
    await this.projectsService.assertMember(task.projectId, userId);
    return task;
  }

  async findAll(taskId: number, userId: number) {
    await this.getTaskAndCheckAccess(taskId, userId);
    return this.prisma.subtask.findMany({
      where: { taskId },
      orderBy: { position: 'asc' },
    });
  }

  async create(taskId: number, title: string, userId: number) {
    await this.getTaskAndCheckAccess(taskId, userId);

    const last = await this.prisma.subtask.findFirst({
      where: { taskId },
      orderBy: { position: 'desc' },
    });

    return this.prisma.subtask.create({
      data: { taskId, title, position: (last?.position ?? -1) + 1 },
    });
  }

  async toggle(subtaskId: number, userId: number) {
    const subtask = await this.prisma.subtask.findUnique({ where: { id: subtaskId } });
    if (!subtask) throw new NotFoundException('Подзадача не найдена');
    await this.getTaskAndCheckAccess(subtask.taskId, userId);

    const completed = !subtask.isCompleted;

    const updated = await this.prisma.subtask.update({
      where: { id: subtaskId },
      data: {
        isCompleted: completed,
        completedAt: completed ? new Date() : null,
        completedById: completed ? userId : null,
      },
    });

    // Проверяем — все ли подзадачи выполнены
    const all = await this.prisma.subtask.findMany({ where: { taskId: subtask.taskId } });
    const allDone = all.every((s) => (s.id === subtaskId ? completed : s.isCompleted));

    return { subtask: updated, allCompleted: allDone };
  }

  async update(subtaskId: number, title: string, userId: number) {
    const subtask = await this.prisma.subtask.findUnique({ where: { id: subtaskId } });
    if (!subtask) throw new NotFoundException('Подзадача не найдена');
    await this.getTaskAndCheckAccess(subtask.taskId, userId);

    return this.prisma.subtask.update({ where: { id: subtaskId }, data: { title } });
  }

  async remove(subtaskId: number, userId: number) {
    const subtask = await this.prisma.subtask.findUnique({ where: { id: subtaskId } });
    if (!subtask) throw new NotFoundException('Подзадача не найдена');
    await this.getTaskAndCheckAccess(subtask.taskId, userId);

    await this.prisma.subtask.delete({ where: { id: subtaskId } });
    return { success: true };
  }

  async reorder(taskId: number, orderedIds: number[], userId: number) {
    await this.getTaskAndCheckAccess(taskId, userId);

    await Promise.all(
      orderedIds.map((id, position) =>
        this.prisma.subtask.update({ where: { id }, data: { position } }),
      ),
    );

    return this.findAll(taskId, userId);
  }
}
