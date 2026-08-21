import type { Project, ProjectJoinRequest, ResponsibilityArea } from '../types';
import { apiRequest, normalizeArray, normalizeNumberId } from './httpClient';

export const projectsApi = {
  async getAll(actorUserId: number | string): Promise<Project[]> {
    return normalizeArray(await apiRequest<Project[]>(`/users/${actorUserId}/projects`));
  },

  async getOne(id: number): Promise<Project> {
    const project = normalizeNumberId(await apiRequest<Project>(`/projects/${id}`));
    const columns = normalizeArray(await apiRequest<any[]>(`/projects/${id}/columns`));
    return { ...project, columns };
  },

  async create(data: { title: string; description?: string; ownerId?: number }): Promise<Project> {
    return normalizeNumberId(await apiRequest<Project>('/projects', { method: 'POST', body: data }));
  },

  async update(id: number, data: Partial<Project>): Promise<Project> {
    return normalizeNumberId(await apiRequest<Project>(`/projects/${id}`, { method: 'PATCH', body: data }));
  },

  async remove(id: number): Promise<{ success: true }> {
    return apiRequest<{ success: true }>(`/projects/${id}`, { method: 'DELETE' });
  },

  async getTrash(): Promise<Project[]> {
    return normalizeArray(await apiRequest<Project[]>('/projects-trash'));
  },

  async restore(id: number): Promise<Project> {
    return normalizeNumberId(await apiRequest<Project>(`/projects/${id}/restore`, { method: 'POST' }));
  },

  async purge(id: number, actorUserId: number | string): Promise<{ success: true }> {
    return apiRequest<{ success: true }>(`/projects/${id}/purge?actorUserId=${actorUserId}`, { method: 'DELETE' });
  },

  async getColumns(projectId: number, pageId?: string) {
    const query = pageId ? `?pageId=${encodeURIComponent(pageId)}` : '';
    return normalizeArray(await apiRequest<any[]>(`/projects/${projectId}/columns${query}`));
  },

  async getAllColumns(projectId: number) {
    return normalizeArray(await apiRequest<any[]>(`/projects/${projectId}/columns?allBoards=1`));
  },

  async createColumn(projectId: number, title: string, pageId?: string) {
    return normalizeNumberId(await apiRequest<any>(`/projects/${projectId}/columns`, {
      method: 'POST',
      body: { title, pageId },
    }));
  },

  async updateColumn(id: number, data: { title?: string }) {
    return normalizeNumberId(await apiRequest<any>(`/columns/${id}`, { method: 'PATCH', body: data }));
  },

  async deleteColumn(id: number) {
    return normalizeArray(await apiRequest<any[]>(`/columns/${id}`, { method: 'DELETE' }));
  },

  async reorderColumns(projectId: number, orderedIds: number[], pageId?: string) {
    return normalizeArray(await apiRequest<any[]>(`/projects/${projectId}/columns/reorder`, {
      method: 'POST',
      body: { orderedIds, pageId },
    }));
  },

  async addMember(projectId: number, username: string) {
    return normalizeNumberId(await apiRequest<Project>(`/projects/${projectId}/members`, {
      method: 'POST',
      body: { username },
    }));
  },

  async removeMember(projectId: number, memberId: number | string, actorUserId: number | string) {
    return normalizeNumberId(await apiRequest<Project>(
      `/projects/${projectId}/members/${memberId}?actorUserId=${actorUserId}`,
      { method: 'DELETE' },
    ));
  },

  async leaveProject(projectId: number, actorUserId: number | string) {
    return apiRequest<{ success: true }>(`/projects/${projectId}/leave`, {
      method: 'POST',
      body: { actorUserId },
    });
  },

  async transferOwnership(projectId: number, memberId: number | string, actorUserId: number | string) {
    return normalizeNumberId(await apiRequest<Project>(`/projects/${projectId}/transfer-ownership`, {
      method: 'POST',
      body: { memberId, actorUserId },
    }));
  },

  async setMemberAdmin(projectId: number, memberId: number | string, enabled: boolean, actorUserId: number | string) {
    return normalizeNumberId(await apiRequest<Project>(`/projects/${projectId}/members/${memberId}/admin`, {
      method: 'POST',
      body: { enabled, actorUserId },
    }));
  },

  async setMemberRole(projectId: number, memberId: number | string, role: string, actorUserId: number | string) {
    return normalizeNumberId(await apiRequest<Project>(`/projects/${projectId}/members/${memberId}/role`, {
      method: 'POST',
      body: { role, actorUserId },
    }));
  },

  async getMemberAdminNotes(projectId: number, memberId: number, actorUserId: number | string): Promise<string> {
    const response = await apiRequest<{ notes: string }>(
      `/projects/${projectId}/members/${memberId}/admin-notes?actorUserId=${actorUserId}`,
    );
    return response.notes ?? '';
  },

  async updateMemberAdminNotes(projectId: number, memberId: number, notes: string, actorUserId: number | string): Promise<string> {
    const response = await apiRequest<{ notes: string }>(`/projects/${projectId}/members/${memberId}/admin-notes`, {
      method: 'PATCH',
      body: { notes, actorUserId },
    });
    return response.notes ?? '';
  },

  async getResponsibilityAreas(projectId: number): Promise<ResponsibilityArea[]> {
    return (await apiRequest<ResponsibilityArea[]>(`/projects/${projectId}/responsibility-areas`)).map(normalizeResponsibilityArea);
  },

  async createResponsibilityArea(
    projectId: number,
    data: Partial<ResponsibilityArea>,
    actorUserId: number | string,
  ): Promise<ResponsibilityArea> {
    return normalizeResponsibilityArea(await apiRequest<ResponsibilityArea>(`/projects/${projectId}/responsibility-areas`, {
      method: 'POST',
      body: { ...data, actorUserId },
    }));
  },

  async updateResponsibilityArea(
    projectId: number,
    areaId: number | string,
    data: Partial<ResponsibilityArea>,
    actorUserId: number | string,
  ): Promise<ResponsibilityArea> {
    return normalizeResponsibilityArea(await apiRequest<ResponsibilityArea>(`/projects/${projectId}/responsibility-areas/${areaId}`, {
      method: 'PATCH',
      body: { ...data, actorUserId },
    }));
  },

  async deleteResponsibilityArea(projectId: number, areaId: number | string, actorUserId: number | string): Promise<{ success: true }> {
    return apiRequest<{ success: true }>(`/projects/${projectId}/responsibility-areas/${areaId}?actorUserId=${actorUserId}`, {
      method: 'DELETE',
    });
  },

  async getInviteCode(projectId: number, actorUserId: number | string) {
    const response = await apiRequest<{ inviteCode: string }>(`/projects/${projectId}/invite-code?actorUserId=${actorUserId}`);
    return response.inviteCode;
  },

  async rotateInviteCode(projectId: number, actorUserId: number | string) {
    const response = await apiRequest<{ inviteCode: string }>(`/projects/${projectId}/invite-code/rotate`, {
      method: 'POST',
      body: { actorUserId },
    });
    return response.inviteCode;
  },

  async requestJoinByCode(code: string, username: string, displayName?: string, userId?: number) {
    return apiRequest('/join-requests', { method: 'POST', body: { code, username, displayName, userId } });
  },

  async getJoinRequests(projectId: number, actorUserId: number | string) {
    return apiRequest<ProjectJoinRequest[]>(`/projects/${projectId}/join-requests?actorUserId=${actorUserId}`);
  },

  async approveJoinRequest(projectId: number, requestId: number, actorUserId: number | string) {
    return normalizeNumberId(await apiRequest<Project>(`/projects/${projectId}/join-requests/${requestId}/approve`, {
      method: 'POST',
      body: { actorUserId },
    }));
  },

  async rejectJoinRequest(projectId: number, requestId: number, actorUserId: number | string) {
    return apiRequest<{ success: true }>(`/projects/${projectId}/join-requests/${requestId}/reject`, {
      method: 'POST',
      body: { actorUserId },
    });
  },
};

function normalizeResponsibilityArea(area: ResponsibilityArea): ResponsibilityArea {
  return {
    ...area,
    projectId: Number.isFinite(Number(area.projectId)) ? Number(area.projectId) : area.projectId,
  };
}
