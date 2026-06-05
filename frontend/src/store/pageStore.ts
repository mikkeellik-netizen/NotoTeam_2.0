import { create } from 'zustand';
import { apiRequest } from '../api/httpClient';
import type { Block, BlockType, PageNode, PageNodeType, PageProperties, Template } from '../types';

interface PersistedProjectSpace {
  nodes: PageNode[];
  blocks: Block[];
  collapsedIds: string[];
  recentPages?: string[];
  dailyNotes?: Record<string, string>;
}

interface HistorySnapshot {
  nodes: PageNode[];
  blocks: Block[];
  selectedPageId: string | null;
  collapsedIds: string[];
  recentPages: string[];
  dailyNotes: Record<string, string>;
}

interface PageState {
  nodes: PageNode[];
  blocks: Block[];
  selectedPageId: string | null;
  collapsedIds: Set<string>;
  recentPages: string[];
  dailyNotes: Record<string, string>;
  undoStack: HistorySnapshot[];
  redoStack: HistorySnapshot[];

  loadProjectSpace: (projectId: string, projectTitle?: string) => void;
  undo: () => void;
  redo: () => void;
  selectPage: (pageId: string) => void;
  toggleCollapsed: (pageId: string) => void;
  togglePinned: (pageId: string) => void;
  movePinned: (pageId: string, direction: -1 | 1) => void;
  moveNode: (nodeId: string, parentId: string | null, order: number) => void;
  duplicateNode: (nodeId: string) => PageNode | null;
  createNode: (input: CreateNodeInput) => PageNode;
  createPageFromTemplate: (projectId: string, parentId: string | null, template: Template) => PageNode;
  renameNode: (id: string, title: string) => void;
  updateNodeIcon: (id: string, icon: string) => void;
  updatePageProperties: (id: string, properties: PageProperties) => void;
  deleteNode: (id: string) => void;
  restoreNode: (id: string) => void;
  purgeNode: (id: string) => void;
  ensureDailyNote: (projectId: string, date?: Date) => PageNode;
  ensureInbox: (projectId: string) => PageNode;
  createBlock: (pageId: string, type: BlockType, order?: number, options?: { skipHistory?: boolean }) => Block;
  createBlockWithContent: (pageId: string, type: BlockType, content: any, order?: number) => Block;
  updateBlock: (id: string, content: any, type?: BlockType) => void;
  moveBlock: (id: string, direction: -1 | 1) => void;
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
  recentPages: [],
  dailyNotes: {},
  undoStack: [],
  redoStack: [],

  loadProjectSpace: (projectId, projectTitle = 'Проект') => {
    set({
      nodes: [],
      blocks: [],
      selectedPageId: null,
      collapsedIds: new Set(),
      recentPages: [],
      dailyNotes: {},
      undoStack: [],
      redoStack: [],
    });

    void apiRequest<PersistedProjectSpace>(`/projects/${projectId}/space`)
      .then((remote) => {
        const remoteFirstOpenNode = getProjectEntryNode(remote.nodes);
        set({
          nodes: remote.nodes,
          blocks: remote.blocks,
          selectedPageId: remoteFirstOpenNode?.id ?? null,
          collapsedIds: new Set(remote.collapsedIds),
          recentPages: remote.recentPages ?? [],
          dailyNotes: remote.dailyNotes ?? {},
          undoStack: [],
          redoStack: [],
        });
      })
      .catch(() => {
        const fallback = createDefaultSpace(projectId, projectTitle);
        set({
          ...restoreHistorySnapshot({
            nodes: fallback.nodes,
            blocks: fallback.blocks,
            collapsedIds: fallback.collapsedIds,
            recentPages: fallback.recentPages ?? [],
            dailyNotes: fallback.dailyNotes ?? {},
            selectedPageId: null,
          }),
          selectedPageId: null,
        });
      });
  },

  undo: () => {
    const state = get();
    const current = createHistorySnapshot(state);
    const previousIndex = findLastDifferentSnapshotIndex(state.undoStack, current);
    const previous = previousIndex >= 0 ? state.undoStack[previousIndex] : undefined;
    if (!previous) return;
    set({
      ...restoreHistorySnapshot(previous),
      undoStack: state.undoStack.slice(0, previousIndex),
      redoStack: [...state.redoStack, current].slice(-50),
    });
    persistCurrentProject();
  },

  redo: () => {
    const state = get();
    const current = createHistorySnapshot(state);
    const nextIndex = findLastDifferentSnapshotIndex(state.redoStack, current);
    const next = nextIndex >= 0 ? state.redoStack[nextIndex] : undefined;
    if (!next) return;
    set({
      ...restoreHistorySnapshot(next),
      undoStack: [...state.undoStack, current].slice(-50),
      redoStack: state.redoStack.slice(0, nextIndex),
    });
    persistCurrentProject();
  },

  selectPage: (pageId) => {
    set((s) => ({
      selectedPageId: pageId,
      recentPages: [pageId, ...s.recentPages.filter((id) => id !== pageId)].slice(0, 20),
    }));
    persistCurrentProject();
  },

  toggleCollapsed: (pageId) => {
    recordHistory(set, get);
    const next = new Set(get().collapsedIds);
    if (next.has(pageId)) next.delete(pageId);
    else next.add(pageId);
    set({ collapsedIds: next });
    persistCurrentProject();
  },

  togglePinned: (pageId) => {
    recordHistory(set, get);
    set((s) => {
      const pinned = s.nodes
        .filter((node) => node.isPinned && node.id !== pageId)
        .sort((a, b) => (a.pinnedOrder ?? 0) - (b.pinnedOrder ?? 0));
      const target = s.nodes.find((node) => node.id === pageId);
      const shouldPin = !target?.isPinned;
      return {
        nodes: s.nodes.map((node) => {
          if (node.id !== pageId) return node;
          return {
            ...node,
            isPinned: shouldPin,
            pinnedOrder: shouldPin ? pinned.length : undefined,
            updatedAt: new Date().toISOString(),
          };
        }),
      };
    });
    persistCurrentProject();
  },

  movePinned: (pageId, direction) => {
    recordHistory(set, get);
    set((s) => {
      const pinned = s.nodes
        .filter((node) => node.isPinned)
        .sort((a, b) => (a.pinnedOrder ?? 0) - (b.pinnedOrder ?? 0));
      const index = pinned.findIndex((node) => node.id === pageId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= pinned.length) return s;
      const reordered = [...pinned];
      const [item] = reordered.splice(index, 1);
      reordered.splice(nextIndex, 0, item);
      const orderById = new Map(reordered.map((node, order) => [node.id, order]));
      return {
        nodes: s.nodes.map((node) =>
          orderById.has(node.id) ? { ...node, pinnedOrder: orderById.get(node.id) } : node,
        ),
      };
    });
    persistCurrentProject();
  },

  moveNode: (nodeId, parentId, order) => {
    recordHistory(set, get);
    set((s) => {
      if (parentId === nodeId || isDescendant(s.nodes, parentId, nodeId)) return s;
      const moving = s.nodes.find((node) => node.id === nodeId);
      if (!moving) return s;
      const targetSiblings = s.nodes
        .filter((node) => node.parentId === parentId && node.id !== nodeId)
        .sort((a, b) => a.order - b.order);
      const clampedOrder = Math.max(0, Math.min(order, targetSiblings.length));
      targetSiblings.splice(clampedOrder, 0, { ...moving, parentId });
      const orderById = new Map(targetSiblings.map((node, index) => [node.id, index]));
      const updatedAt = new Date().toISOString();
      return {
        nodes: s.nodes.map((node) => {
          if (node.id === nodeId) return { ...node, parentId, order: clampedOrder, updatedAt };
          if (node.parentId === parentId && orderById.has(node.id)) {
            return { ...node, order: orderById.get(node.id)! };
          }
          return node;
        }),
      };
    });
    persistCurrentProject();
  },

  duplicateNode: (nodeId) => {
    const source = get().nodes.find((node) => node.id === nodeId);
    if (!source) return null;
    recordHistory(set, get);
    const now = new Date().toISOString();
    const allNodes = get().nodes;
    const allBlocks = get().blocks;
    const sourceIds = [source.id, ...collectDescendantIds(allNodes, source.id)];
    const idMap = new Map<string, string>();
    for (const id of sourceIds) idMap.set(id, makeId(id.startsWith('folder') ? 'folder' : id.startsWith('kanban') ? 'kanban' : 'page'));
    const siblings = allNodes.filter((node) => node.parentId === source.parentId && node.id !== source.id);
    const duplicatedNodes = sourceIds
      .map((id) => allNodes.find((node) => node.id === id))
      .filter((node): node is PageNode => Boolean(node))
      .map((node) => ({
        ...node,
        id: idMap.get(node.id)!,
        parentId: node.id === source.id ? source.parentId : idMap.get(node.parentId ?? '') ?? node.parentId,
        title: node.id === source.id ? `${node.title} копия` : node.title,
        order: node.id === source.id ? source.order + 1 : node.order,
        isPinned: false,
        pinnedOrder: undefined,
        isDeleted: false,
        deletedAt: undefined,
        createdAt: now,
        updatedAt: now,
      }));
    const duplicatedBlocks = allBlocks
      .filter((block) => idMap.has(block.pageId))
      .map((block) => createBlock(idMap.get(block.pageId)!, block.type, block.order, structuredCloneSafe(block.content)));

    set((s) => ({
      nodes: [
        ...s.nodes.map((node) =>
          node.parentId === source.parentId && node.order > source.order ? { ...node, order: node.order + 1 } : node,
        ),
        ...duplicatedNodes,
      ],
      blocks: [...s.blocks, ...duplicatedBlocks],
      selectedPageId: duplicatedNodes[0]?.type === 'folder' ? s.selectedPageId : duplicatedNodes[0]?.id ?? s.selectedPageId,
    }));
    persistCurrentProject();
    return duplicatedNodes[0] ?? null;
  },

  createNode: (input) => {
    recordHistory(set, get);
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

  createPageFromTemplate: (projectId, parentId, template) => {
    const node = get().createNode({
      projectId,
      parentId,
      type: template.nodeType ?? (template.id === 'kanban' ? 'kanban' : 'page'),
      title: template.title,
      icon: template.icon,
    });

    if (node.type === 'page') {
      const initialBlockIds = get().blocks.filter((block) => block.pageId === node.id).map((block) => block.id);
      set((s) => ({
        blocks: [
          ...s.blocks.filter((block) => !initialBlockIds.includes(block.id)),
          ...template.blocks.map((block, order) => createBlock(node.id, block.type, order, block.content)),
        ],
      }));
      persistCurrentProject();
    }

    return node;
  },

  renameNode: (id, title) => {
    const current = get().nodes.find((node) => node.id === id);
    if (!current || current.title === title) return;

    recordHistory(set, get);
    const updatedAt = new Date().toISOString();
    set((s) => ({
      nodes: s.nodes.map((n) => (n.id === id ? { ...n, title, updatedAt } : n)),
    }));
    persistCurrentProject();
  },

  updateNodeIcon: (id, icon) => {
    const current = get().nodes.find((node) => node.id === id);
    if (!current || current.icon === icon) return;

    recordHistory(set, get);
    const updatedAt = new Date().toISOString();
    set((s) => ({
      nodes: s.nodes.map((node) => (node.id === id ? { ...node, icon, updatedAt } : node)),
    }));
    persistCurrentProject();
  },

  updatePageProperties: (id, properties) => {
    recordHistory(set, get);
    const updatedAt = new Date().toISOString();
    set((s) => ({
      nodes: s.nodes.map((node) =>
        node.id === id
          ? { ...node, properties: { ...(node.properties ?? {}), ...properties }, updatedAt }
          : node,
      ),
    }));
    persistCurrentProject();
  },

  deleteNode: (id) => {
    recordHistory(set, get);
    const idsToDelete = collectDescendantIds(get().nodes, id);
    idsToDelete.add(id);
    const deletedAt = new Date().toISOString();
    set((s) => {
      const nodes = s.nodes.map((node) =>
        idsToDelete.has(node.id)
          ? { ...node, isDeleted: true, deletedAt, isPinned: false, pinnedOrder: undefined }
          : node,
      );
      const blocks = s.blocks;
      const selectedPageId = s.selectedPageId && idsToDelete.has(s.selectedPageId)
        ? nodes.find((n) => !n.isDeleted && n.type !== 'folder')?.id ?? null
        : s.selectedPageId;
      return { nodes, blocks, selectedPageId };
    });
    persistCurrentProject();
  },

  restoreNode: (id) => {
    recordHistory(set, get);
    const idsToRestore = collectDescendantIds(get().nodes, id);
    idsToRestore.add(id);
    const existingNodes = get().nodes;
    set((s) => ({
      nodes: s.nodes.map((node) => {
        if (!idsToRestore.has(node.id)) return node;
        const parentDeleted = node.parentId
          ? existingNodes.find((parent) => parent.id === node.parentId)?.isDeleted
          : false;
        return {
          ...node,
          parentId: parentDeleted ? null : node.parentId,
          isDeleted: false,
          deletedAt: undefined,
          updatedAt: new Date().toISOString(),
        };
      }),
    }));
    persistCurrentProject();
  },

  purgeNode: (id) => {
    recordHistory(set, get);
    const idsToPurge = collectDescendantIds(get().nodes, id);
    idsToPurge.add(id);
    set((s) => {
      const selectedPageId = s.selectedPageId && idsToPurge.has(s.selectedPageId)
        ? s.nodes.find((node) => !node.isDeleted && !idsToPurge.has(node.id) && node.type !== 'folder')?.id ?? null
        : s.selectedPageId;
      const dailyNotes = { ...s.dailyNotes };
      for (const [date, pageId] of Object.entries(dailyNotes)) {
        if (idsToPurge.has(pageId)) delete dailyNotes[date];
      }
      return {
        nodes: s.nodes.filter((node) => !idsToPurge.has(node.id)),
        blocks: s.blocks.filter((block) => !idsToPurge.has(block.pageId)),
        recentPages: s.recentPages.filter((pageId) => !idsToPurge.has(pageId)),
        dailyNotes,
        selectedPageId,
      };
    });
    persistCurrentProject();
  },

  ensureDailyNote: (projectId, date = new Date()) => {
    const key = date.toISOString().slice(0, 10);
    const existingId = get().dailyNotes[key];
    const existing = existingId ? get().nodes.find((node) => node.id === existingId) : undefined;
    if (existing) return existing;

    const inbox = get().ensureInbox(projectId);
    const title = date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' });
    const node = get().createNode({
      projectId,
      parentId: inbox.id,
      type: 'page',
      title,
      icon: '📅',
    });
    const initialBlock = get().blocks.find((block) => block.pageId === node.id);
    if (initialBlock) {
      recordHistory(set, get);
      get().updateBlock(initialBlock.id, { text: `Заметка дня: ${title}` }, 'heading_2');
      get().createBlockWithContent(node.id, 'todo', { text: 'Главный фокус дня', checked: false }, 1);
      get().createBlockWithContent(node.id, 'paragraph', { text: '' }, 2);
    }
    set((s) => ({ dailyNotes: { ...s.dailyNotes, [key]: node.id } }));
    persistCurrentProject();
    return node;
  },

  ensureInbox: (projectId) => {
    const existing = get().nodes.find((node) => node.projectId === projectId && node.title === 'Inbox');
    if (existing) return existing;
    return get().createNode({
      projectId,
      parentId: null,
      type: 'folder',
      title: 'Inbox',
      icon: '📥',
    });
  },

  createBlock: (pageId, type, order, options) => {
    if (!options?.skipHistory) recordHistory(set, get);
    const pageBlocks = get().getBlocksByPage(pageId);
    const insertOrder = order ?? pageBlocks.length;
    const block = createBlock(pageId, type, insertOrder);
    set((s) => ({
      blocks: [
        ...s.blocks.map((item) =>
          item.pageId === pageId && item.order >= insertOrder
            ? { ...item, order: item.order + 1 }
            : item,
        ),
        block,
      ],
    }));
    persistCurrentProject();
    return block;
  },

  createBlockWithContent: (pageId, type, content, order) => {
    recordHistory(set, get);
    const pageBlocks = get().getBlocksByPage(pageId);
    const insertOrder = order ?? pageBlocks.length;
    const block = createBlock(pageId, type, insertOrder, content);
    set((s) => ({
      blocks: [
        ...s.blocks.map((item) =>
          item.pageId === pageId && item.order >= insertOrder
            ? { ...item, order: item.order + 1 }
            : item,
        ),
        block,
      ],
    }));
    persistCurrentProject();
    return block;
  },

  updateBlock: (id, content, type) => {
    const current = get().blocks.find((block) => block.id === id);
    if (!current) return;
    const nextType = type ?? current.type;
    if (current.type === nextType && isEqualContent(current.content, content)) return;

    recordHistory(set, get);
    const updatedAt = new Date().toISOString();
    set((s) => ({
      blocks: s.blocks.map((b) => (b.id === id ? { ...b, type: nextType, content, updatedAt } : b)),
    }));
    persistCurrentProject();
  },

  moveBlock: (id, direction) => {
    const block = get().blocks.find((item) => item.id === id);
    if (!block) return;
    const pageBlocks = get().getBlocksByPage(block.pageId);
    const index = pageBlocks.findIndex((item) => item.id === id);
    const target = pageBlocks[index + direction];
    if (!target) return;
    recordHistory(set, get);
    set((s) => ({
      blocks: s.blocks.map((item) => {
        if (item.id === block.id) return { ...item, order: target.order, updatedAt: new Date().toISOString() };
        if (item.id === target.id) return { ...item, order: block.order, updatedAt: new Date().toISOString() };
        return item;
      }),
    }));
    persistCurrentProject();
  },

  deleteBlock: (id) => {
    recordHistory(set, get);
    set((s) => ({ blocks: s.blocks.filter((b) => b.id !== id) }));
    persistCurrentProject();
  },

  getBlocksByPage: (pageId) =>
    get().blocks.filter((b) => b.pageId === pageId).sort((a, b) => a.order - b.order),
}));

function createHistorySnapshot(state: PageState): HistorySnapshot {
  return {
    nodes: state.nodes,
    blocks: state.blocks,
    selectedPageId: state.selectedPageId,
    collapsedIds: [...state.collapsedIds],
    recentPages: state.recentPages,
    dailyNotes: state.dailyNotes,
  };
}

function restoreHistorySnapshot(snapshot: HistorySnapshot) {
  return {
    nodes: snapshot.nodes,
    blocks: snapshot.blocks,
    selectedPageId: snapshot.selectedPageId,
    collapsedIds: new Set(snapshot.collapsedIds),
    recentPages: snapshot.recentPages,
    dailyNotes: snapshot.dailyNotes,
  };
}

function recordHistory(set: (partial: Partial<PageState>) => void, get: () => PageState) {
  const state = get();
  const snapshot = createHistorySnapshot(state);
  const lastSnapshot = state.undoStack[state.undoStack.length - 1];
  if (lastSnapshot && areSnapshotsEqual(lastSnapshot, snapshot)) return;
  set({
    undoStack: [...state.undoStack, snapshot].slice(-50),
    redoStack: [],
  });
}

function isEqualContent(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function findLastDifferentSnapshotIndex(stack: HistorySnapshot[], current: HistorySnapshot) {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    if (!areSnapshotsEqual(stack[index], current)) return index;
  }
  return -1;
}

function areSnapshotsEqual(a: HistorySnapshot, b: HistorySnapshot) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function purgeExpiredDeletedNodes(space: PersistedProjectSpace) {
  const expiredIds = new Set(
    space.nodes
      .filter((node) => node.isDeleted && isOlderThan30Days(node.deletedAt))
      .map((node) => node.id),
  );
  for (const id of [...expiredIds]) {
    for (const childId of collectDescendantIds(space.nodes, id)) expiredIds.add(childId);
  }
  if (expiredIds.size === 0) return;
  space.nodes = space.nodes.filter((node) => !expiredIds.has(node.id));
  space.blocks = space.blocks.filter((block) => !expiredIds.has(block.pageId));
  space.recentPages = (space.recentPages ?? []).filter((id) => !expiredIds.has(id));
  for (const [date, pageId] of Object.entries(space.dailyNotes ?? {})) {
    if (expiredIds.has(pageId)) delete space.dailyNotes?.[date];
  }
}

function getProjectEntryNode(nodes: PageNode[]) {
  return (
    nodes
      .filter((node) => !node.isDeleted && node.parentId === null && node.type === 'folder')
      .sort((a, b) => a.order - b.order)[0] ??
    nodes
      .filter((node) => !node.isDeleted && node.parentId === null)
      .sort((a, b) => a.order - b.order)[0] ??
    nodes.find((node) => !node.isDeleted && node.type === 'page') ??
    nodes.find((node) => !node.isDeleted && node.type === 'kanban') ??
    null
  );
}

function isOlderThan30Days(date?: string) {
  if (!date) return false;
  return Date.now() - new Date(date).getTime() > 30 * 24 * 3600000;
}

function persistCurrentProject() {
  const state = usePageStore.getState();
  const projectId = state.nodes[0]?.projectId;
  if (!projectId) return;
  const space = {
    nodes: state.nodes,
    blocks: state.blocks,
    collapsedIds: [...state.collapsedIds],
    recentPages: state.recentPages,
    dailyNotes: state.dailyNotes,
  };
  void apiRequest(`/projects/${projectId}/space`, { method: 'PUT', body: space }).catch(() => undefined);
}

function createDefaultSpace(projectId: string, projectTitle: string): PersistedProjectSpace {
  const now = new Date().toISOString();
  const rootFolder: PageNode = {
    id: makeId('folder'),
    projectId,
    parentId: null,
    type: 'folder',
    title: 'Новая папка',
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
    recentPages: [],
    dailyNotes: {},
  };
}

function createInitialBlock(pageId: string): Block {
  return createBlock(pageId, 'paragraph', 0);
}

function createBlock(pageId: string, type: BlockType, order: number, content = defaultBlockContent(type)): Block {
  const now = new Date().toISOString();
  return {
    id: makeId('block'),
    pageId,
    type,
    content,
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
  if (type === 'web_embed') return { url: '', mode: 'auto', provider: 'generic', height: 280 };
  if (type === 'smart_summary') return {};
  if (type === 'collapsible') return { title: 'Новый раздел', text: '', collapsed: false };
  if (type === 'page_properties') return {};
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

function isDescendant(nodes: PageNode[], possibleChildId: string | null, parentId: string) {
  if (!possibleChildId) return false;
  let current = nodes.find((node) => node.id === possibleChildId);
  while (current) {
    if (current.parentId === parentId) return true;
    current = current.parentId ? nodes.find((node) => node.id === current?.parentId) : undefined;
  }
  return false;
}

function structuredCloneSafe<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function makeId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
