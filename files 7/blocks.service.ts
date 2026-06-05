import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';

type BlockType =
  | 'PARAGRAPH'
  | 'HEADING_1'
  | 'HEADING_2'
  | 'HEADING_3'
  | 'TODO'
  | 'BULLETED_LIST'
  | 'NUMBERED_LIST'
  | 'SIMPLE_TABLE'
  | 'CODE'
  | 'LINK_TO_PAGE'
  | 'KANBAN_EMBED';

@Injectable()
export class BlocksService {
  constructor(
    private prisma: PrismaService,
    private projectsService: ProjectsService,
  ) {}

  async findByPage(pageId: string, userId: number) {
    await this.getPageAndCheckAccess(pageId, userId);
    return this.prisma.block.findMany({
      where: { pageId },
      orderBy: { order: 'asc' },
    });
  }

  async create(pageId: string, userId: number, type: BlockType, content: any = {}) {
    await this.getPageAndCheckAccess(pageId, userId);

    const last = await this.prisma.block.findFirst({
      where: { pageId },
      orderBy: { order: 'desc' },
    });

    return this.prisma.block.create({
      data: {
        pageId,
        type,
        content,
        order: (last?.order ?? -1) + 1,
      },
    });
  }

  async update(blockId: string, userId: number, data: { type?: BlockType; content?: any }) {
    const block = await this.prisma.block.findUnique({
      where: { id: blockId },
      include: { page: true },
    });
    if (!block) throw new NotFoundException('Блок не найден');
    await this.projectsService.assertMember(block.page.projectId, userId);

    return this.prisma.block.update({
      where: { id: blockId },
      data,
    });
  }

  async remove(blockId: string, userId: number) {
    const block = await this.prisma.block.findUnique({
      where: { id: blockId },
      include: { page: true },
    });
    if (!block) throw new NotFoundException('Блок не найден');
    await this.projectsService.assertMember(block.page.projectId, userId);

    await this.prisma.block.delete({ where: { id: blockId } });
    return { success: true };
  }

  private async getPageAndCheckAccess(pageId: string, userId: number) {
    const page = await this.prisma.pageNode.findUnique({ where: { id: pageId } });
    if (!page) throw new NotFoundException('Страница не найдена');
    await this.projectsService.assertMember(page.projectId, userId);
    return page;
  }
}
