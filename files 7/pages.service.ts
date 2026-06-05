import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';

type PageNodeType = 'PAGE' | 'FOLDER' | 'KANBAN';

@Injectable()
export class PagesService {
  constructor(
    private prisma: PrismaService,
    private projectsService: ProjectsService,
  ) {}

  async findTree(projectId: number, userId: number) {
    await this.projectsService.assertMember(projectId, userId);
    return this.prisma.pageNode.findMany({
      where: { projectId },
      orderBy: [{ parentId: 'asc' }, { order: 'asc' }],
    });
  }

  async createDefaultSpace(projectId: number, userId: number) {
    await this.projectsService.assertMember(projectId, userId);

    const existing = await this.prisma.pageNode.count({ where: { projectId } });
    if (existing > 0) return this.findTree(projectId, userId);

    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Проект не найден');

    return this.prisma.$transaction(async (tx) => {
      const root = await tx.pageNode.create({
        data: {
          projectId,
          type: 'FOLDER',
          title: project.title,
          icon: '📁',
          order: 0,
        },
      });

      await tx.pageNode.create({
        data: {
          projectId,
          parentId: root.id,
          type: 'PAGE',
          title: 'Обзор',
          icon: '📝',
          order: 0,
          blocks: {
            create: {
              type: 'PARAGRAPH',
              content: { text: 'Рабочая страница проекта.' },
              order: 0,
            },
          },
        },
      });

      const kanbanPage = await tx.pageNode.create({
        data: {
          projectId,
          parentId: root.id,
          type: 'KANBAN',
          title: 'Kanban-доска',
          icon: '📋',
          order: 1,
        },
      });

      await tx.column.updateMany({
        where: { projectId, pageId: null },
        data: { pageId: kanbanPage.id },
      });

      await tx.task.updateMany({
        where: { projectId, pageId: null },
        data: { pageId: kanbanPage.id },
      });

      return tx.pageNode.findMany({
        where: { projectId },
        orderBy: [{ parentId: 'asc' }, { order: 'asc' }],
      });
    });
  }

  async create(
    projectId: number,
    userId: number,
    data: { parentId?: string | null; type: PageNodeType; title: string; icon?: string },
  ) {
    await this.projectsService.assertMember(projectId, userId);

    const last = await this.prisma.pageNode.findFirst({
      where: { projectId, parentId: data.parentId ?? null },
      orderBy: { order: 'desc' },
    });

    return this.prisma.pageNode.create({
      data: {
        projectId,
        parentId: data.parentId ?? null,
        type: data.type,
        title: data.title,
        icon: data.icon ?? (data.type === 'FOLDER' ? '📁' : data.type === 'KANBAN' ? '📋' : '📝'),
        order: (last?.order ?? -1) + 1,
      },
    });
  }

  async rename(pageId: string, userId: number, title: string) {
    const page = await this.getPageAndCheckAccess(pageId, userId);
    return this.prisma.pageNode.update({ where: { id: page.id }, data: { title } });
  }

  async remove(pageId: string, userId: number) {
    const page = await this.getPageAndCheckAccess(pageId, userId);
    await this.prisma.pageNode.delete({ where: { id: page.id } });
    return { success: true };
  }

  private async getPageAndCheckAccess(pageId: string, userId: number) {
    const page = await this.prisma.pageNode.findUnique({ where: { id: pageId } });
    if (!page) throw new NotFoundException('Страница не найдена');
    await this.projectsService.assertMember(page.projectId, userId);
    return page;
  }
}
