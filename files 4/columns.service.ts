import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';

@Injectable()
export class ColumnsService {
  constructor(
    private prisma: PrismaService,
    private projectsService: ProjectsService,
  ) {}

  async findAll(projectId: number, userId: number) {
    await this.projectsService.assertMember(projectId, userId);
    return this.prisma.column.findMany({
      where: { projectId, isHidden: false },
      orderBy: { position: 'asc' },
    });
  }

  async create(projectId: number, title: string, userId: number) {
    await this.projectsService.assertOwner(projectId, userId);

    const last = await this.prisma.column.findFirst({
      where: { projectId },
      orderBy: { position: 'desc' },
    });

    return this.prisma.column.create({
      data: { projectId, title, position: (last?.position ?? -1) + 1 },
    });
  }

  async update(columnId: number, data: { title?: string; isHidden?: boolean }, userId: number) {
    const column = await this.prisma.column.findUnique({ where: { id: columnId } });
    if (!column) throw new NotFoundException('Колонка не найдена');
    await this.projectsService.assertOwner(column.projectId, userId);

    return this.prisma.column.update({ where: { id: columnId }, data });
  }

  async reorder(projectId: number, orderedIds: number[], userId: number) {
    await this.projectsService.assertOwner(projectId, userId);

    await Promise.all(
      orderedIds.map((id, position) =>
        this.prisma.column.update({ where: { id }, data: { position } }),
      ),
    );
    return this.findAll(projectId, userId);
  }

  async remove(columnId: number, userId: number) {
    const column = await this.prisma.column.findUnique({ where: { id: columnId } });
    if (!column) throw new NotFoundException('Колонка не найдена');
    await this.projectsService.assertOwner(column.projectId, userId);

    // Нельзя удалить дефолтную колонку
    if (column.isDefault) throw new ForbiddenException('Нельзя удалить дефолтную колонку');

    await this.prisma.column.delete({ where: { id: columnId } });
    return { success: true };
  }
}
