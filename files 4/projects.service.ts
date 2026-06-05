import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateProjectDto, UpdateProjectDto } from './projects.dto';

// Дефолтные колонки для нового проекта
const DEFAULT_COLUMNS = [
  { title: 'Идея',     position: 0, isDefault: false, isArchive: false },
  { title: 'В работе', position: 1, isDefault: true,  isArchive: false },
  { title: 'Готово',   position: 2, isDefault: false, isArchive: false },
  { title: 'Архив',    position: 3, isDefault: false, isArchive: true  },
];

// Дефолтные роли
const DEFAULT_ROLES = [
  {
    name: 'Владелец',
    permissions: {
      createTask: true, deleteTask: true, manageColumns: true,
      manageMembers: true, viewAnalytics: true, manageProject: true,
    },
  },
  {
    name: 'Участник',
    permissions: {
      createTask: true, deleteTask: false, manageColumns: false,
      manageMembers: false, viewAnalytics: false, manageProject: false,
    },
  },
  {
    name: 'Наблюдатель',
    permissions: {
      createTask: false, deleteTask: false, manageColumns: false,
      manageMembers: false, viewAnalytics: false, manageProject: false,
    },
  },
];

@Injectable()
export class ProjectsService {
  constructor(private prisma: PrismaService) {}

  // ─── Получить все проекты пользователя ─────────────────────
  async findAllForUser(userId: number) {
    const members = await this.prisma.projectMember.findMany({
      where: { userId },
      include: {
        project: {
          include: {
            members: { include: { user: true, role: true } },
            _count: {
              select: {
                tasks: { where: { isArchived: false } },
              },
            },
          },
        },
      },
    });

    // Считаем просроченные задачи
    const projects = await Promise.all(
      members.map(async (m) => {
        const overdueCount = await this.prisma.task.count({
          where: {
            projectId: m.project.id,
            isArchived: false,
            deadlineAt: { lt: new Date() },
          },
        });
        return { ...m.project, overdueCount };
      }),
    );

    return projects.filter((p) => !p.isArchived);
  }

  // ─── Получить один проект ──────────────────────────────────
  async findOne(projectId: number, userId: number) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        members: { include: { user: true, role: true } },
        roles: true,
        columns: { orderBy: { position: 'asc' } },
      },
    });

    if (!project) throw new NotFoundException('Проект не найден');
    await this.assertMember(projectId, userId);

    return project;
  }

  // ─── Создать проект ────────────────────────────────────────
  async create(dto: CreateProjectDto, ownerId: number) {
    const project = await this.prisma.$transaction(async (tx) => {
      // 1. Создаём проект
      const proj = await tx.project.create({
        data: {
          ownerId,
          title: dto.title,
          description: dto.description,
          aiToneStyle: dto.aiToneStyle ?? 'FRIENDLY',
        },
      });

      // 2. Создаём дефолтные роли
      const roles = await Promise.all(
        DEFAULT_ROLES.map((r) =>
          tx.role.create({ data: { projectId: proj.id, ...r } }),
        ),
      );
      const ownerRole = roles[0]; // Первая роль — владелец

      // 3. Добавляем создателя как участника с ролью владельца
      await tx.projectMember.create({
        data: { projectId: proj.id, userId: ownerId, roleId: ownerRole.id },
      });

      // 4. Создаём дефолтные колонки
      await tx.column.createMany({
        data: DEFAULT_COLUMNS.map((c) => ({ projectId: proj.id, ...c })),
      });

      return proj;
    });

    return this.findOne(project.id, ownerId);
  }

  // ─── Обновить проект ───────────────────────────────────────
  async update(projectId: number, dto: UpdateProjectDto, userId: number) {
    await this.assertOwner(projectId, userId);

    return this.prisma.project.update({
      where: { id: projectId },
      data: dto,
    });
  }

  // ─── Удалить проект ────────────────────────────────────────
  async remove(projectId: number, userId: number) {
    await this.assertOwner(projectId, userId);

    await this.prisma.project.delete({ where: { id: projectId } });
    return { success: true };
  }

  // ─── Архивировать проект ───────────────────────────────────
  async archive(projectId: number, userId: number) {
    await this.assertOwner(projectId, userId);

    return this.prisma.project.update({
      where: { id: projectId },
      data: { isArchived: true },
    });
  }

  // ─── Проверка: является ли юзер участником ─────────────────
  async assertMember(projectId: number, userId: number) {
    const member = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
    });
    if (!member) throw new ForbiddenException('Нет доступа к проекту');
    return member;
  }

  // ─── Проверка: является ли юзер владельцем ─────────────────
  async assertOwner(projectId: number, userId: number) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) throw new NotFoundException('Проект не найден');
    if (project.ownerId !== userId)
      throw new ForbiddenException('Только владелец может выполнить это действие');
    return project;
  }

  // ─── Аналитика проекта ─────────────────────────────────────
  async getAnalytics(projectId: number, userId: number) {
    await this.assertMember(projectId, userId);

    const [total, completed, overdue, byMember] = await Promise.all([
      this.prisma.task.count({
        where: { projectId, isArchived: false },
      }),
      this.prisma.task.count({
        where: {
          projectId,
          column: { isArchive: true },
        },
      }),
      this.prisma.task.count({
        where: {
          projectId,
          isArchived: false,
          deadlineAt: { lt: new Date() },
          column: { isArchive: false },
        },
      }),
      this.prisma.task.groupBy({
        by: ['assigneeId'],
        where: { projectId, isArchived: false },
        _count: { id: true },
      }),
    ]);

    return { total, completed, overdue, byMember };
  }
}
