import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';

@Injectable()
export class MembersService {
  constructor(
    private prisma: PrismaService,
    private projectsService: ProjectsService,
  ) {}

  // ─── Список участников ─────────────────────────────────────
  async findAll(projectId: number, userId: number) {
    await this.projectsService.assertMember(projectId, userId);

    return this.prisma.projectMember.findMany({
      where: { projectId },
      include: { user: true, role: true },
    });
  }

  // ─── Добавить участника по telegramId ──────────────────────
  async add(
    projectId: number,
    telegramId: string,
    roleId: number | undefined,
    requesterId: number,
  ) {
    await this.projectsService.assertOwner(projectId, requesterId);

    const user = await this.prisma.user.findUnique({ where: { telegramId } });
    if (!user) throw new NotFoundException('Пользователь не найден. Он должен сначала запустить бота.');

    const exists = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: user.id } },
    });
    if (exists) throw new ConflictException('Пользователь уже в проекте');

    return this.prisma.projectMember.create({
      data: { projectId, userId: user.id, roleId },
      include: { user: true, role: true },
    });
  }

  // ─── Изменить роль участника ───────────────────────────────
  async updateRole(
    projectId: number,
    memberId: number,
    roleId: number,
    requesterId: number,
  ) {
    await this.projectsService.assertOwner(projectId, requesterId);

    return this.prisma.projectMember.update({
      where: { id: memberId },
      data: { roleId },
      include: { user: true, role: true },
    });
  }

  // ─── Удалить участника ─────────────────────────────────────
  async remove(projectId: number, memberId: number, requesterId: number) {
    await this.projectsService.assertOwner(projectId, requesterId);

    await this.prisma.projectMember.delete({ where: { id: memberId } });
    return { success: true };
  }

  // ─── CRUD ролей ────────────────────────────────────────────
  async getRoles(projectId: number, userId: number) {
    await this.projectsService.assertMember(projectId, userId);
    return this.prisma.role.findMany({ where: { projectId } });
  }

  async createRole(
    projectId: number,
    name: string,
    permissions: Record<string, boolean>,
    requesterId: number,
  ) {
    await this.projectsService.assertOwner(projectId, requesterId);
    return this.prisma.role.create({ data: { projectId, name, permissions } });
  }

  async updateRole2(
    roleId: number,
    name: string,
    permissions: Record<string, boolean>,
    requesterId: number,
    projectId: number,
  ) {
    await this.projectsService.assertOwner(projectId, requesterId);
    return this.prisma.role.update({
      where: { id: roleId },
      data: { name, permissions },
    });
  }

  async deleteRole(roleId: number, requesterId: number, projectId: number) {
    await this.projectsService.assertOwner(projectId, requesterId);
    await this.prisma.role.delete({ where: { id: roleId } });
    return { success: true };
  }
}
