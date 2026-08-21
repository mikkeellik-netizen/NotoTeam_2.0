import type { Block, PageNode } from '../types';
import { apiRequest } from './httpClient';

export interface PageTreeResponse {
  projectId: string;
  parentId: string | null;
  nodes: PageNode[];
}

export interface PageNodesResponse {
  projectId: string;
  nodes: PageNode[];
}

export interface PageBlocksResponse {
  projectId: string;
  pageId: string;
  offset: number;
  limit: number;
  total: number;
  blocks: Block[];
}

export interface ProjectSpaceMeta {
  collapsedIds: string[];
  recentPages: string[];
  dailyNotes: Record<string, string>;
}

export interface CreatePageNodeInput {
  id?: string;
  initialBlockId?: string;
  initialBlocks?: CreateBlockInput[];
  parentId?: string | null;
  type: PageNode['type'];
  title?: string;
  icon?: string;
  order?: number;
  properties?: PageNode['properties'];
}

export interface UpdatePageNodeInput {
  title?: string;
  icon?: string;
  properties?: PageNode['properties'];
  isPinned?: boolean;
  pinnedOrder?: number;
}

export interface MovePageNodeInput {
  parentId?: string | null;
  order?: number;
}

export interface NodeMutationResult {
  success: boolean;
  deletedIds?: string[];
  restoredIds?: string[];
  purgedIds?: string[];
}

export interface CreateBlockInput {
  id?: string;
  type: Block['type'];
  content?: Block['content'];
  order?: number;
}

export interface UpdateBlockInput {
  type?: Block['type'];
  content?: Block['content'];
}

export interface MoveBlockInput {
  order: number;
}

export const workspaceApi = {
  getMeta(projectId: string | number): Promise<ProjectSpaceMeta> {
    return apiRequest<ProjectSpaceMeta>(`/projects/${projectId}/space/meta`);
  },

  updateMeta(projectId: string | number, input: Partial<ProjectSpaceMeta>): Promise<ProjectSpaceMeta> {
    return apiRequest<ProjectSpaceMeta>(`/projects/${projectId}/space/meta`, {
      method: 'PATCH',
      body: input,
    });
  },

  getTree(projectId: string | number, parentId: string | null = null): Promise<PageTreeResponse> {
    const query = parentId === null ? '?parentId=null' : `?parentId=${encodeURIComponent(parentId)}`;
    return apiRequest<PageTreeResponse>(`/projects/${projectId}/space/tree${query}`);
  },

  getNodes(projectId: string | number, options: { includeDeleted?: boolean } = {}): Promise<PageNodesResponse> {
    const query = options.includeDeleted ? '?includeDeleted=1' : '';
    return apiRequest<PageNodesResponse>(`/projects/${projectId}/space/nodes${query}`);
  },

  getNode(projectId: string | number, nodeId: string): Promise<PageNode> {
    return apiRequest<PageNode>(`/projects/${projectId}/space/nodes/${encodeURIComponent(nodeId)}`);
  },

  createNode(projectId: string | number, input: CreatePageNodeInput): Promise<PageNode> {
    return apiRequest<PageNode>(`/projects/${projectId}/space/nodes`, {
      method: 'POST',
      body: input,
    });
  },

  updateNode(projectId: string | number, nodeId: string, input: UpdatePageNodeInput): Promise<PageNode> {
    return apiRequest<PageNode>(`/projects/${projectId}/space/nodes/${encodeURIComponent(nodeId)}`, {
      method: 'PATCH',
      body: input,
    });
  },

  moveNode(projectId: string | number, nodeId: string, input: MovePageNodeInput): Promise<PageNode> {
    return apiRequest<PageNode>(`/projects/${projectId}/space/nodes/${encodeURIComponent(nodeId)}/move`, {
      method: 'POST',
      body: input,
    });
  },

  trashNode(projectId: string | number, nodeId: string): Promise<NodeMutationResult> {
    return apiRequest<NodeMutationResult>(`/projects/${projectId}/space/nodes/${encodeURIComponent(nodeId)}/trash`, {
      method: 'POST',
    });
  },

  restoreNode(projectId: string | number, nodeId: string): Promise<NodeMutationResult> {
    return apiRequest<NodeMutationResult>(`/projects/${projectId}/space/nodes/${encodeURIComponent(nodeId)}/restore`, {
      method: 'POST',
    });
  },

  purgeNode(projectId: string | number, nodeId: string): Promise<NodeMutationResult> {
    return apiRequest<NodeMutationResult>(`/projects/${projectId}/space/nodes/${encodeURIComponent(nodeId)}`, {
      method: 'DELETE',
    });
  },

  getPageBlocks(
    projectId: string | number,
    pageId: string,
    options: { offset?: number; limit?: number } = {},
  ): Promise<PageBlocksResponse> {
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 100;
    return apiRequest<PageBlocksResponse>(
      `/projects/${projectId}/space/pages/${encodeURIComponent(pageId)}/blocks?offset=${offset}&limit=${limit}`,
    );
  },

  createBlock(projectId: string | number, pageId: string, input: CreateBlockInput): Promise<Block> {
    return apiRequest<Block>(`/projects/${projectId}/space/pages/${encodeURIComponent(pageId)}/blocks`, {
      method: 'POST',
      body: input,
    });
  },

  updateBlock(projectId: string | number, blockId: string, input: UpdateBlockInput): Promise<Block> {
    return apiRequest<Block>(`/projects/${projectId}/space/blocks/${encodeURIComponent(blockId)}`, {
      method: 'PATCH',
      body: input,
    });
  },

  moveBlock(projectId: string | number, blockId: string, input: MoveBlockInput): Promise<Block> {
    return apiRequest<Block>(`/projects/${projectId}/space/blocks/${encodeURIComponent(blockId)}/move`, {
      method: 'POST',
      body: input,
    });
  },

  deleteBlock(projectId: string | number, blockId: string): Promise<{ success: boolean }> {
    return apiRequest<{ success: boolean }>(`/projects/${projectId}/space/blocks/${encodeURIComponent(blockId)}`, {
      method: 'DELETE',
    });
  },
};
