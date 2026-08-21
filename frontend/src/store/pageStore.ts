import { create } from 'zustand';
import { workspaceApi } from '../api/workspace';
import type { Block, BlockType, PageNode, PageNodeType, PageProperties, Template } from '../types';

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
  isPartialSpace: boolean;
  loadedTreeParentIds: Set<string>;
  loadingTreeParentIds: Set<string>;
  loadedBlockPageIds: Set<string>;
  loadingBlockPageIds: Set<string>;
  selectedPageId: string | null;
  collapsedIds: Set<string>;
  recentPages: string[];
  dailyNotes: Record<string, string>;
  undoStack: HistorySnapshot[];
  redoStack: HistorySnapshot[];

  loadProjectSpace: (projectId: string, projectTitle?: string) => void;
  ensureFolderChildrenLoaded: (projectId: string, parentId: string | null) => Promise<void>;
  ensureNodeLoaded: (projectId: string, nodeId: string) => Promise<void>;
  ensurePageBlocksLoaded: (projectId: string, pageId: string) => Promise<void>;
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
  properties?: PageProperties;
  initialBlocks?: Array<{ type: BlockType; content: any; order?: number }>;
}

let projectSpaceLoadSeq = 0;
const ROOT_PARENT_KEY = '__root__';

export const usePageStore = create<PageState>((set, get) => ({
  nodes: [],
  blocks: [],
  isPartialSpace: false,
  loadedTreeParentIds: new Set(),
  loadingTreeParentIds: new Set(),
  loadedBlockPageIds: new Set(),
  loadingBlockPageIds: new Set(),
  selectedPageId: null,
  collapsedIds: new Set(),
  recentPages: [],
  dailyNotes: {},
  undoStack: [],
  redoStack: [],

  loadProjectSpace: (projectId, projectTitle = 'Проект') => {
    const loadSeq = ++projectSpaceLoadSeq;
    set({
      nodes: [],
      blocks: [],
      isPartialSpace: true,
      loadedTreeParentIds: new Set(),
      loadingTreeParentIds: new Set(),
      loadedBlockPageIds: new Set(),
      loadingBlockPageIds: new Set(),
      selectedPageId: null,
      collapsedIds: new Set(),
      recentPages: [],
      dailyNotes: {},
      undoStack: [],
      redoStack: [],
    });

    void Promise.all([
      workspaceApi.getTree(projectId, null),
      workspaceApi.getMeta(projectId).catch(() => ({
        collapsedIds: [],
        recentPages: [],
        dailyNotes: {},
      })),
    ])
      .then(([tree, meta]) => {
        if (loadSeq !== projectSpaceLoadSeq) return;
        const entryNode = getProjectEntryNode(tree.nodes);
        set({
          nodes: tree.nodes,
          blocks: [],
          isPartialSpace: true,
          loadedTreeParentIds: new Set([parentLoadKey(null)]),
          loadingTreeParentIds: new Set(),
          loadedBlockPageIds: new Set(),
          loadingBlockPageIds: new Set(),
          selectedPageId: entryNode?.id ?? null,
          collapsedIds: new Set(meta.collapsedIds),
          recentPages: meta.recentPages,
          dailyNotes: meta.dailyNotes,
          undoStack: [],
          redoStack: [],
        });
        void Promise.all(meta.recentPages.slice(0, 8).map((id) => get().ensureNodeLoaded(projectId, id))).catch(() => undefined);
      })
      .catch(() => {
        if (loadSeq !== projectSpaceLoadSeq) return;
        set({
          nodes: [],
          blocks: [],
          isPartialSpace: true,
          loadedTreeParentIds: new Set(),
          loadingTreeParentIds: new Set(),
          loadedBlockPageIds: new Set(),
          loadingBlockPageIds: new Set(),
          selectedPageId: null,
          collapsedIds: new Set(),
          recentPages: [],
          dailyNotes: {},
          undoStack: [],
          redoStack: [],
        });
      });
  },

  ensureFolderChildrenLoaded: async (projectId, parentId) => {
    const key = parentLoadKey(parentId);
    const state = get();
    if (state.loadedTreeParentIds.has(key) || state.loadingTreeParentIds.has(key)) return;

    set((s) => ({ loadingTreeParentIds: new Set([...s.loadingTreeParentIds, key]) }));

    try {
      const tree = await workspaceApi.getTree(projectId, parentId);
      set((s) => {
        if (!isSameProject(s, projectId)) return s;
        const loadingTreeParentIds = new Set(s.loadingTreeParentIds);
        loadingTreeParentIds.delete(key);
        return {
          nodes: mergeNodes(s.nodes, tree.nodes),
          loadedTreeParentIds: new Set([...s.loadedTreeParentIds, key]),
          loadingTreeParentIds,
        };
      });
    } catch {
      set((s) => {
        const loadingTreeParentIds = new Set(s.loadingTreeParentIds);
        loadingTreeParentIds.delete(key);
        return { loadingTreeParentIds };
      });
    }
  },

  ensureNodeLoaded: async (projectId, nodeId) => {
    if (get().nodes.some((node) => node.id === nodeId)) return;

    try {
      const loaded: PageNode[] = [];
      let currentId: string | null | undefined = nodeId;
      const seen = new Set<string>();
      while (currentId && !seen.has(currentId) && !get().nodes.some((node) => node.id === currentId)) {
        seen.add(currentId);
        const node = await workspaceApi.getNode(projectId, currentId);
        loaded.push(node);
        currentId = node.parentId;
      }
      if (loaded.length > 0) {
        set((s) => (isSameProject(s, projectId) ? { nodes: mergeNodes(s.nodes, loaded) } : s));
      }
    } catch {
      // Initial project load uses granular workspace endpoints only.
    }
  },

  ensurePageBlocksLoaded: async (projectId, pageId) => {
    const state = get();
    if (state.loadedBlockPageIds.has(pageId) || state.loadingBlockPageIds.has(pageId)) return;

    set((s) => ({ loadingBlockPageIds: new Set([...s.loadingBlockPageIds, pageId]) }));

    try {
      const response = await workspaceApi.getPageBlocks(projectId, pageId);
      set((s) => {
        if (!isSameProject(s, projectId)) return s;
        const loadingBlockPageIds = new Set(s.loadingBlockPageIds);
        loadingBlockPageIds.delete(pageId);
        return {
          blocks: mergePageBlocks(s.blocks, pageId, response.blocks),
          loadedBlockPageIds: new Set([...s.loadedBlockPageIds, pageId]),
          loadingBlockPageIds,
        };
      });
    } catch {
      set((s) => {
        const loadingBlockPageIds = new Set(s.loadingBlockPageIds);
        loadingBlockPageIds.delete(pageId);
        return { loadingBlockPageIds };
      });
    }
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
    let recentPages: string[] = [];
    set((s) => ({
      selectedPageId: pageId,
      recentPages: (recentPages = [pageId, ...s.recentPages.filter((id) => id !== pageId)].slice(0, 20)),
    }));
    persistCurrentProjectMeta({ recentPages });
  },

  toggleCollapsed: (pageId) => {
    recordHistory(set, get);
    const next = new Set(get().collapsedIds);
    if (next.has(pageId)) next.delete(pageId);
    else next.add(pageId);
    set({ collapsedIds: next });
    persistCurrentProjectMeta({ collapsedIds: [...next] });
  },

  togglePinned: (pageId) => {
    recordHistory(set, get);
    let updatedNode: PageNode | undefined;
    set((s) => {
      const pinned = s.nodes
        .filter((node) => node.isPinned && node.id !== pageId)
        .sort((a, b) => (a.pinnedOrder ?? 0) - (b.pinnedOrder ?? 0));
      const target = s.nodes.find((node) => node.id === pageId);
      const shouldPin = !target?.isPinned;
      updatedNode = target
        ? {
            ...target,
            isPinned: shouldPin,
            pinnedOrder: shouldPin ? pinned.length : undefined,
            updatedAt: new Date().toISOString(),
          }
        : undefined;
      return {
        nodes: s.nodes.map((node) => {
          if (node.id !== pageId) return node;
          return updatedNode ?? node;
        }),
      };
    });
    if (updatedNode) {
      void workspaceApi
        .updateNode(updatedNode.projectId, updatedNode.id, {
          isPinned: updatedNode.isPinned,
          pinnedOrder: updatedNode.pinnedOrder,
        })
        .catch(() => undefined);
    }
  },

  movePinned: (pageId, direction) => {
    recordHistory(set, get);
    let updatedNodes: PageNode[] = [];
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
      updatedNodes = s.nodes
        .filter((node) => orderById.has(node.id) && node.pinnedOrder !== orderById.get(node.id))
        .map((node) => ({ ...node, pinnedOrder: orderById.get(node.id) }));
      return {
        nodes: s.nodes.map((node) =>
          orderById.has(node.id) ? { ...node, pinnedOrder: orderById.get(node.id) } : node,
        ),
      };
    });
    for (const node of updatedNodes) {
      void workspaceApi
        .updateNode(node.projectId, node.id, { pinnedOrder: node.pinnedOrder })
        .catch(() => undefined);
    }
  },

  moveNode: (nodeId, parentId, order) => {
    recordHistory(set, get);
    const moving = get().nodes.find((node) => node.id === nodeId);
    let shouldPersistMove = false;
    set((s) => {
      if (parentId === nodeId || isDescendant(s.nodes, parentId, nodeId)) return s;
      if (!moving) return s;
      shouldPersistMove = true;
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
    if (moving && shouldPersistMove) {
      void workspaceApi.moveNode(moving.projectId, nodeId, { parentId, order }).catch(() => undefined);
    }
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
    const duplicateTitle = getUniqueNodeTitle(`${source.title} копия`, allNodes, source.projectId, source.parentId);
    const duplicatedNodes = sourceIds
      .map((id) => allNodes.find((node) => node.id === id))
      .filter((node): node is PageNode => Boolean(node))
      .map((node) => ({
        ...node,
        id: idMap.get(node.id)!,
        parentId: node.id === source.id ? source.parentId : idMap.get(node.parentId ?? '') ?? node.parentId,
        title: node.id === source.id ? duplicateTitle : node.title,
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
      loadedTreeParentIds: new Set([
        ...s.loadedTreeParentIds,
        ...duplicatedNodes.filter((node) => node.type === 'folder').map((node) => parentLoadKey(node.id)),
      ]),
      loadedBlockPageIds: new Set([
        ...s.loadedBlockPageIds,
        ...duplicatedNodes.filter((node) => node.type === 'page').map((node) => node.id),
      ]),
      selectedPageId: duplicatedNodes[0]?.type === 'folder' ? s.selectedPageId : duplicatedNodes[0]?.id ?? s.selectedPageId,
    }));
    for (const node of duplicatedNodes.sort((a, b) => getNodeDepth(duplicatedNodes, a) - getNodeDepth(duplicatedNodes, b))) {
      void workspaceApi
        .createNode(node.projectId, {
          id: node.id,
          parentId: node.parentId,
          type: node.type,
          title: node.title,
          icon: node.icon,
          order: node.order,
          properties: node.properties,
          initialBlocks:
            node.type === 'page'
              ? duplicatedBlocks
                  .filter((block) => block.pageId === node.id)
                  .map((block) => ({
                    id: block.id,
                    type: block.type,
                    content: block.content,
                    order: block.order,
                  }))
              : undefined,
        })
        .catch(() => undefined);
    }
    return duplicatedNodes[0] ?? null;
  },

  createNode: (input) => {
    recordHistory(set, get);
    const now = new Date().toISOString();
    const parentId = input.parentId ?? null;
    const siblings = get().nodes.filter((n) => n.projectId === input.projectId && n.parentId === parentId && !n.isDeleted);
    const title = getUniqueNodeTitle(input.title ?? defaultTitle(input.type), get().nodes, input.projectId, parentId);
    const node: PageNode = {
      id: makeId(input.type),
      projectId: input.projectId,
      parentId,
      type: input.type,
      title,
      icon: input.icon ?? defaultIcon(input.type),
      order: siblings.length,
      properties: input.properties,
      createdAt: now,
      updatedAt: now,
    };
    const explicitInitialBlocks = input.initialBlocks ?? [];
    const hasExplicitInitialBlocks = explicitInitialBlocks.length > 0;
    const initialBlocks =
      input.type === 'page'
        ? hasExplicitInitialBlocks
          ? explicitInitialBlocks.map((block, index) =>
              createBlock(node.id, block.type, block.order ?? index, structuredCloneSafe(block.content)),
            )
          : [createInitialBlock(node.id)]
        : [];

    set((s) => ({
      nodes: [...s.nodes, node],
      blocks: initialBlocks.length > 0 ? [...s.blocks, ...initialBlocks] : s.blocks,
      loadedTreeParentIds:
        input.type === 'folder'
          ? new Set([...s.loadedTreeParentIds, parentLoadKey(node.id)])
          : s.loadedTreeParentIds,
      loadedBlockPageIds:
        input.type === 'page'
          ? new Set([...s.loadedBlockPageIds, node.id])
          : s.loadedBlockPageIds,
      selectedPageId: input.type === 'folder' ? s.selectedPageId : node.id,
    }));
    void workspaceApi
      .createNode(input.projectId, {
        id: node.id,
        parentId: node.parentId,
        type: node.type,
        title: node.title,
        icon: node.icon,
        order: node.order,
        properties: node.properties,
        initialBlockId: !hasExplicitInitialBlocks && initialBlocks.length === 1 ? initialBlocks[0].id : undefined,
        initialBlocks: hasExplicitInitialBlocks || initialBlocks.length > 1
          ? initialBlocks.map((block) => ({
              id: block.id,
              type: block.type,
              content: block.content,
              order: block.order,
            }))
          : undefined,
      })
      .then((createdNode) => {
        set((s) => ({
          nodes: s.nodes.map((item) => (item.id === node.id ? { ...item, ...createdNode } : item)),
        }));
      })
      .catch(() => {
        if (!get().isPartialSpace) persistCurrentProject();
      });
    return node;
  },

  createPageFromTemplate: (projectId, parentId, template) => {
    const node = get().createNode({
      projectId,
      parentId,
      type: template.nodeType ?? (template.id === 'kanban' ? 'kanban' : 'page'),
      title: template.title,
      icon: template.icon,
      initialBlocks:
        (template.nodeType ?? (template.id === 'kanban' ? 'kanban' : 'page')) === 'page'
          ? template.blocks.map((block, order) => ({ type: block.type, content: block.content, order }))
          : undefined,
    });

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
    void workspaceApi.updateNode(current.projectId, id, { title }).catch(() => undefined);
  },

  updateNodeIcon: (id, icon) => {
    const current = get().nodes.find((node) => node.id === id);
    if (!current || current.icon === icon) return;

    recordHistory(set, get);
    const updatedAt = new Date().toISOString();
    set((s) => ({
      nodes: s.nodes.map((node) => (node.id === id ? { ...node, icon, updatedAt } : node)),
    }));
    void workspaceApi.updateNode(current.projectId, id, { icon }).catch(() => undefined);
  },

  updatePageProperties: (id, properties) => {
    const current = get().nodes.find((node) => node.id === id);
    if (!current) return;
    recordHistory(set, get);
    const updatedAt = new Date().toISOString();
    set((s) => ({
      nodes: s.nodes.map((node) =>
        node.id === id
          ? { ...node, properties: { ...(node.properties ?? {}), ...properties }, updatedAt }
        : node,
      ),
    }));
    void workspaceApi.updateNode(current.projectId, id, { properties }).catch(() => undefined);
  },

  deleteNode: (id) => {
    const target = get().nodes.find((node) => node.id === id);
    if (!target) return;
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
    void workspaceApi.trashNode(target.projectId, id).catch(() => undefined);
  },

  restoreNode: (id) => {
    const target = get().nodes.find((node) => node.id === id);
    if (!target) return;
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
    void workspaceApi.restoreNode(target.projectId, id).catch(() => undefined);
  },

  purgeNode: (id) => {
    const target = get().nodes.find((node) => node.id === id);
    if (!target) return;
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
    void workspaceApi.purgeNode(target.projectId, id).catch(() => undefined);
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
    persistCurrentProjectMeta({ dailyNotes: get().dailyNotes });
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
    const projectId = getProjectIdForPage(get(), pageId);
    if (projectId) {
      void workspaceApi
        .createBlock(projectId, pageId, {
          id: block.id,
          type: block.type,
          content: block.content,
          order: block.order,
        })
        .catch(() => {
          if (!get().isPartialSpace) persistCurrentProject();
        });
    } else if (!get().isPartialSpace) {
      persistCurrentProject();
    }
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
    const projectId = getProjectIdForPage(get(), pageId);
    if (projectId) {
      void workspaceApi
        .createBlock(projectId, pageId, {
          id: block.id,
          type: block.type,
          content: block.content,
          order: block.order,
        })
        .catch(() => {
          if (!get().isPartialSpace) persistCurrentProject();
        });
    } else if (!get().isPartialSpace) {
      persistCurrentProject();
    }
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
    const projectId = getProjectIdForPage(get(), current.pageId);
    if (projectId) {
      void workspaceApi.updateBlock(projectId, id, { type: nextType, content }).catch(() => undefined);
    } else if (!get().isPartialSpace) {
      persistCurrentProject();
    }
  },

  moveBlock: (id, direction) => {
    const block = get().blocks.find((item) => item.id === id);
    if (!block) return;
    const pageBlocks = get().getBlocksByPage(block.pageId);
    const index = pageBlocks.findIndex((item) => item.id === id);
    const target = pageBlocks[index + direction];
    if (!target) return;
    recordHistory(set, get);
    const updatedAt = new Date().toISOString();
    set((s) => ({
      blocks: s.blocks.map((item) => {
        if (item.id === block.id) return { ...item, order: target.order, updatedAt };
        if (item.id === target.id) return { ...item, order: block.order, updatedAt };
        return item;
      }),
    }));
    const projectId = getProjectIdForPage(get(), block.pageId);
    if (projectId) {
      void workspaceApi.moveBlock(projectId, id, { order: target.order }).catch(() => undefined);
    } else if (!get().isPartialSpace) {
      persistCurrentProject();
    }
  },

  deleteBlock: (id) => {
    const block = get().blocks.find((item) => item.id === id);
    if (!block) return;
    recordHistory(set, get);
    set((s) => ({ blocks: s.blocks.filter((b) => b.id !== id) }));
    const projectId = getProjectIdForPage(get(), block.pageId);
    if (projectId) {
      void workspaceApi.deleteBlock(projectId, id).catch(() => undefined);
    } else if (!get().isPartialSpace) {
      persistCurrentProject();
    }
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

function parentLoadKey(parentId: string | null) {
  return parentId ?? ROOT_PARENT_KEY;
}

function mergeNodes(current: PageNode[], incoming: PageNode[]) {
  const byId = new Map(current.map((node) => [node.id, node]));
  for (const node of incoming) byId.set(node.id, node);
  return [...byId.values()];
}

function mergePageBlocks(current: Block[], pageId: string, incoming: Block[]) {
  return [...current.filter((block) => block.pageId !== pageId), ...incoming];
}

function isSameProject(state: PageState, projectId: string | number) {
  const projectIds = state.nodes.map((node) => String(node.projectId));
  return projectIds.length === 0 || projectIds.includes(String(projectId));
}

function getProjectIdForPage(state: PageState, pageId: string) {
  return state.nodes.find((node) => node.id === pageId)?.projectId;
}

function getCurrentProjectId(state: PageState) {
  return state.nodes[0]?.projectId;
}

function persistCurrentProjectMeta(input: Parameters<typeof workspaceApi.updateMeta>[1]) {
  const state = usePageStore.getState();
  const projectId = getCurrentProjectId(state);
  if (!projectId) return;
  void workspaceApi.updateMeta(projectId, input).catch(() => undefined);
}

function persistCurrentProject() {
  // Legacy full-space persistence is intentionally disabled.
  // Mutations must go through granular workspaceApi endpoints.
}

function createDefaultSpace(projectId: string, projectTitle: string): {
  nodes: PageNode[];
  blocks: Block[];
  collapsedIds: string[];
  recentPages: string[];
  dailyNotes: Record<string, string>;
} {
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

function getUniqueNodeTitle(baseTitle: string, nodes: PageNode[], projectId: string, parentId: string | null) {
  const title = baseTitle.trim() || 'Новая страница';
  const existingTitles = new Set(
    nodes
      .filter((node) => !node.isDeleted && node.projectId === projectId && (node.parentId ?? null) === parentId)
      .map((node) => node.title.trim()),
  );
  if (!existingTitles.has(title)) return title;

  let index = 1;
  while (existingTitles.has(`${title}_${index}`)) index += 1;
  return `${title}_${index}`;
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

function getNodeDepth(nodes: PageNode[], node: PageNode) {
  let depth = 0;
  let parentId = node.parentId;
  const seen = new Set<string>();
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    depth += 1;
    parentId = nodes.find((item) => item.id === parentId)?.parentId ?? null;
  }
  return depth;
}

function structuredCloneSafe<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function makeId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
