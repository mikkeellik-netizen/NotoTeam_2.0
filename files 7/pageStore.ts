import { create } from 'zustand';
import type { Block, BlockType, PageNode, PageNodeType } from '../types';

const STORAGE_KEY = 'notion-lite-pages-v1';

interface PersistedProjectSpace {
  nodes: PageNode[];
  blocks: Block[];
  collapsedIds: string[];
}

interface PageState {
  nodes: PageNode[];
  blocks: Block[];
  selectedPageId: string | null;
  collapsedIds: Set<string>;

  loadProjectSpace: (projectId: string, projectTitle?: string) => void;
  selectPage: (pageId: string) => void;
  toggleCollapsed: (pageId: string) => void;
  createNode: (input: CreateNodeInput) => PageNode;
  renameNode: (id: string, title: string) => void;
  deleteNode: (id: string) => void;
  createBlock: (pageId: string, type: BlockType, order?: number) => Block;
  updateBlock: (id: string, content: any, type?: BlockType) => void;
  deleteBlock: (id: string) => void;
  getBlocksByPage: (pageId: string) => Block[];
}

interface CreateNodeInput {
  projectId: string;
  parentId?: string | null;
  type: PageNodeType;
  title?: string;
  icon?: string;
}

export const usePageStore = create<PageState>((set, get) => ({
  nodes: [],
  blocks: [],
  selectedPageId: null,
  collapsedIds: new Set(),

  loadProjectSpace: (projectId, projectTitle = 'Проект') => {
    const all = readStorage();
    const existing = all[projectId] ?? createDefaultSpace(projectId, projectTitle);
    all[projectId] = existing;
    writeStorage(all);

    const firstOpenNode =
      existing.nodes.find((n) => n.type === 'page') ??
      existing.nodes.find((n) => n.type === 'kanban') ??
      null;

    set({
      nodes: existing.nodes,
      blocks: existing.blocks,
      selectedPageId: firstOpenNode?.id ?? null,
      collapsedIds: new Set(existing.collapsedIds),
    });
  },

  selectPage: (pageId) => set({ selectedPageId: pageId }),

  toggleCollapsed: (pageId) => {
    const next = new Set(get().collapsedIds);
    if (next.has(pageId)) next.delete(pageId);
    else next.add(pageId);
    set({ collapsedIds: next });
    persistCurrentProject();
  },

  createNode: (input) => {
    const now = new Date().toISOString();
    const siblings = get().nodes.filter((n) => n.parentId === (input.parentId ?? null));
    const node: PageNode = {
      id: makeId('page'),
      projectId: input.projectId,
      parentId: input.parentId ?? null,
      type: input.type,
      title: input.title ?? defaultTitle(input.type),
      icon: input.icon ?? defaultIcon(input.type),
      order: siblings.length,
      createdAt: now,
      updatedAt: now,
    };

    set((s) => ({
      nodes: [...s.nodes, node],
      blocks: input.type === 'page' ? [...s.blocks, createInitialBlock(node.id)] : s.blocks,
      selectedPageId: input.type === 'folder' ? s.selectedPageId : node.id,
    }));
    persistCurrentProject();
    return node;
  },

  renameNode: (id, title) => {
    const updatedAt = new Date().toISOString();
    set((s) => ({
      nodes: s.nodes.map((n) => (n.id === id ? { ...n, title, updatedAt } : n)),
    }));
    persistCurrentProject();
  },

  deleteNode: (id) => {
    const idsToDelete = collectDescendantIds(get().nodes, id);
    idsToDelete.add(id);
    set((s) => {
      const nodes = s.nodes.filter((n) => !idsToDelete.has(n.id));
      const blocks = s.blocks.filter((b) => !idsToDelete.has(b.pageId));
      const selectedPageId = s.selectedPageId && idsToDelete.has(s.selectedPageId)
        ? nodes.find((n) => n.type !== 'folder')?.id ?? null
        : s.selectedPageId;
      return { nodes, blocks, selectedPageId };
    });
    persistCurrentProject();
  },

  createBlock: (pageId, type, order) => {
    const pageBlocks = get().getBlocksByPage(pageId);
    const block = createBlock(pageId, type, order ?? pageBlocks.length);
    set((s) => ({ blocks: [...s.blocks, block] }));
    persistCurrentProject();
    return block;
  },

  updateBlock: (id, content, type) => {
    const updatedAt = new Date().toISOString();
    set((s) => ({
      blocks: s.blocks.map((b) => (b.id === id ? { ...b, type: type ?? b.type, content, updatedAt } : b)),
    }));
    persistCurrentProject();
  },

  deleteBlock: (id) => {
    set((s) => ({ blocks: s.blocks.filter((b) => b.id !== id) }));
    persistCurrentProject();
  },

  getBlocksByPage: (pageId) =>
    get().blocks.filter((b) => b.pageId === pageId).sort((a, b) => a.order - b.order),
}));

function readStorage(): Record<string, PersistedProjectSpace> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function writeStorage(value: Record<string, PersistedProjectSpace>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

function persistCurrentProject() {
  const state = usePageStore.getState();
  const projectId = state.nodes[0]?.projectId;
  if (!projectId) return;
  const all = readStorage();
  all[projectId] = {
    nodes: state.nodes,
    blocks: state.blocks,
    collapsedIds: [...state.collapsedIds],
  };
  writeStorage(all);
}

function createDefaultSpace(projectId: string, projectTitle: string): PersistedProjectSpace {
  const now = new Date().toISOString();
  const rootFolder: PageNode = {
    id: makeId('folder'),
    projectId,
    parentId: null,
    type: 'folder',
    title: projectTitle,
    icon: '📁',
    order: 0,
    createdAt: now,
    updatedAt: now,
  };
  const overviewPage: PageNode = {
    id: makeId('page'),
    projectId,
    parentId: rootFolder.id,
    type: 'page',
    title: 'Обзор',
    icon: '📝',
    order: 0,
    createdAt: now,
    updatedAt: now,
  };
  const kanbanPage: PageNode = {
    id: makeId('kanban'),
    projectId,
    parentId: rootFolder.id,
    type: 'kanban',
    title: 'Kanban-доска',
    icon: '📋',
    order: 1,
    createdAt: now,
    updatedAt: now,
  };

  return {
    nodes: [rootFolder, overviewPage, kanbanPage],
    blocks: [
      {
        ...createInitialBlock(overviewPage.id),
        content: { text: 'Рабочая страница проекта. Добавь блок через / или кнопку +.' },
      },
    ],
    collapsedIds: [],
  };
}

function createInitialBlock(pageId: string): Block {
  return createBlock(pageId, 'paragraph', 0);
}

function createBlock(pageId: string, type: BlockType, order: number): Block {
  const now = new Date().toISOString();
  return {
    id: makeId('block'),
    pageId,
    type,
    content: defaultBlockContent(type),
    order,
    createdAt: now,
    updatedAt: now,
  };
}

function defaultBlockContent(type: BlockType) {
  if (type === 'todo') return { text: '', checked: false };
  if (type === 'simple_table') return { rows: [['', ''], ['', '']] };
  if (type === 'link_to_page') return { displayText: '', targetPageId: '' };
  if (type === 'kanban_embed') return { projectId: '', pageId: '' };
  return { text: '' };
}

function collectDescendantIds(nodes: PageNode[], parentId: string): Set<string> {
  const result = new Set<string>();
  for (const child of nodes.filter((n) => n.parentId === parentId)) {
    result.add(child.id);
    for (const id of collectDescendantIds(nodes, child.id)) result.add(id);
  }
  return result;
}

function defaultTitle(type: PageNodeType) {
  if (type === 'folder') return 'Новая папка';
  if (type === 'kanban') return 'Kanban-доска';
  return 'Новая страница';
}

function defaultIcon(type: PageNodeType) {
  if (type === 'folder') return '📁';
  if (type === 'kanban') return '📋';
  return '📝';
}

function makeId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
