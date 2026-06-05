import type { Project, ProjectJoinRequest } from '../types';
import { activityApi } from './activity';
import { apiRequest, normalizeArray, normalizeNumberId, useWorkspaceBackend } from './httpClient';
import { nextId, readDb, refreshProjectCounts, writeDb } from './mockDb';

export const projectsApi = {
  async getAll(actorUserId = 1): Promise<Project[]> {
    if (useWorkspaceBackend) {
      return normalizeArray(await apiRequest<Project[]>(`/users/${actorUserId}/projects`));
    }
    const db = readDb();
    refreshProjectCounts(db);
    writeDb(db);
    return db.projects.filter(
      (project) =>
        !project.isArchived &&
        !project.isDeleted &&
        (project.ownerId === actorUserId || (project.members ?? []).some((member) => member.userId === actorUserId)),
    );
  },

  async getOne(id: number): Promise<Project> {
    if (useWorkspaceBackend) {
      const project = normalizeNumberId(await apiRequest<Project>(`/projects/${id}`));
      const columns = normalizeArray(await apiRequest<any[]>(`/projects/${id}/columns`));
      return { ...project, columns };
    }
    const db = readDb();
    refreshProjectCounts(db);
    const project = db.projects.find((item) => item.id === id && !item.isDeleted);
    if (!project) throw new Error('Project not found');
    return {
      ...project,
      columns: db.columns
        .filter((column) => column.projectId === id)
        .sort((a, b) => a.position - b.position),
    };
  },

  async create(data: { title: string; description?: string; ownerId?: number }): Promise<Project> {
    if (useWorkspaceBackend) {
      return normalizeNumberId(await apiRequest<Project>('/projects', { method: 'POST', body: data }));
    }
    const db = readDb();
    const id = nextId(db.projects);
    const createdAt = new Date().toISOString();
    const project: Project = {
      id,
      ownerId: data.ownerId ?? 1,
      title: data.title,
      description: data.description,
      aiToneStyle: 'FRIENDLY',
      isArchived: false,
      createdAt,
      members: [
        {
          id: 1,
          projectId: id,
          userId: data.ownerId ?? 1,
          user: db.users.find((user) => user.id === 1),
          role: createOwnerRole(id),
        },
      ],
      _count: { tasks: 0 },
    };

    db.projects.push(project);
    db.columns.push(
      { id: nextId(db.columns), projectId: id, title: 'Идея', position: 0, isDefault: false, isArchive: false, isHidden: false },
      { id: nextId(db.columns) + 1, projectId: id, title: 'В работе', position: 1, isDefault: true, isArchive: false, isHidden: false },
      { id: nextId(db.columns) + 2, projectId: id, title: 'Готово', position: 2, isDefault: false, isArchive: true, isHidden: false },
    );
    refreshProjectCounts(db);
    writeDb(db);
    return projectsApi.getOne(id);
  },

  async update(id: number, data: Partial<Project>): Promise<Project> {
    if (useWorkspaceBackend) {
      return normalizeNumberId(await apiRequest<Project>(`/projects/${id}`, { method: 'PATCH', body: data }));
    }
    const db = readDb();
    db.projects = db.projects.map((project) => (project.id === id ? { ...project, ...data } : project));
    writeDb(db);
    return projectsApi.getOne(id);
  },

  async remove(id: number): Promise<{ success: true }> {
    if (useWorkspaceBackend) {
      return apiRequest<{ success: true }>(`/projects/${id}`, { method: 'DELETE' });
    }
    const db = readDb();
    const project = db.projects.find((item) => item.id === id);
    if (!project) throw new Error('Project not found');
    if (project.ownerId !== 1) throw new Error('Only project owner can delete project');

    const deletedAt = new Date().toISOString();
    db.projects = db.projects.map((project) =>
      project.id === id ? { ...project, isDeleted: true, deletedAt } : project,
    );
    writeDb(db);
    return { success: true };
  },

  async getTrash(): Promise<Project[]> {
    if (useWorkspaceBackend) {
      return normalizeArray(await apiRequest<Project[]>('/projects-trash'));
    }
    const db = readDb();
    refreshProjectCounts(db);
    writeDb(db);
    return db.projects.filter((project) => project.isDeleted);
  },

  async restore(id: number): Promise<Project> {
    if (useWorkspaceBackend) {
      return normalizeNumberId(await apiRequest<Project>(`/projects/${id}/restore`, { method: 'POST' }));
    }
    const db = readDb();
    db.projects = db.projects.map((project) =>
      project.id === id ? { ...project, isDeleted: false, deletedAt: undefined } : project,
    );
    writeDb(db);
    return projectsApi.getOne(id);
  },

  async purge(id: number, actorUserId = 1): Promise<{ success: true }> {
    if (useWorkspaceBackend) {
      return apiRequest<{ success: true }>(`/projects/${id}/purge?actorUserId=${actorUserId}`, { method: 'DELETE' });
    }
    const db = readDb();
    const project = db.projects.find((item) => item.id === id);
    if (!project) throw new Error('Project not found');
    if (project.ownerId !== actorUserId) throw new Error('Only project owner can permanently delete project');

    db.projects = db.projects.filter((item) => item.id !== id);
    db.columns = db.columns.filter((column) => column.projectId !== id);
    db.tasks = db.tasks.filter((task) => task.projectId !== id);
    db.subtasks = db.subtasks.filter((subtask) => db.tasks.some((task) => task.id === subtask.taskId));
    writeDb(db);
    return { success: true };
  },

  async getColumns(projectId: number, pageId?: string) {
    if (useWorkspaceBackend) {
      const query = pageId ? `?pageId=${encodeURIComponent(pageId)}` : '';
      return normalizeArray(await apiRequest<any[]>(`/projects/${projectId}/columns${query}`));
    }
    const db = readDb();
    ensureBoardColumns(db, projectId, pageId);
    writeDb(db);
    return db.columns
      .filter((column) => column.projectId === projectId && sameBoard(column.pageId, pageId))
      .sort((a, b) => a.position - b.position);
  },

  async createColumn(projectId: number, title: string, pageId?: string) {
    if (useWorkspaceBackend) {
      return normalizeNumberId(await apiRequest<any>(`/projects/${projectId}/columns`, {
        method: 'POST',
        body: { title, pageId },
      }));
    }
    const db = readDb();
    const siblings = db.columns.filter((column) => column.projectId === projectId && sameBoard(column.pageId, pageId));
    const column = {
      id: nextId(db.columns),
      projectId,
      pageId,
      title,
      position: siblings.length,
      isDefault: false,
      isArchive: false,
      isHidden: false,
    };
    db.columns.push(column);
    writeDb(db);
    return column;
  },

  async updateColumn(id: number, data: { title?: string }) {
    if (useWorkspaceBackend) {
      return normalizeNumberId(await apiRequest<any>(`/columns/${id}`, { method: 'PATCH', body: data }));
    }
    const db = readDb();
    const column = db.columns.find((item) => item.id === id);
    if (!column) throw new Error('Column not found');

    const updated = {
      ...column,
      title: data.title?.trim() || column.title,
    };

    db.columns = db.columns.map((item) => (item.id === id ? updated : item));
    writeDb(db);
    return updated;
  },

  async deleteColumn(id: number) {
    if (useWorkspaceBackend) {
      return normalizeArray(await apiRequest<any[]>(`/columns/${id}`, { method: 'DELETE' }));
    }
    const db = readDb();
    const column = db.columns.find((item) => item.id === id);
    if (!column) throw new Error('Column not found');

    const siblings = db.columns
      .filter((item) => item.projectId === column.projectId && sameBoard(item.pageId, column.pageId))
      .sort((a, b) => a.position - b.position);

    if (siblings.length <= 1) throw new Error('Cannot delete the last column');

    const fallbackColumn =
      [...siblings].reverse().find((item) => item.id !== id && item.position < column.position) ??
      siblings.find((item) => item.id !== id);

    if (!fallbackColumn) throw new Error('Fallback column not found');

    let nextPosition = db.tasks.filter((task) => task.columnId === fallbackColumn.id).length;
    db.tasks = db.tasks.map((task) => {
      if (task.columnId !== id) return task;
      return { ...task, columnId: fallbackColumn.id, position: nextPosition++ };
    });

    db.columns = db.columns
      .filter((item) => item.id !== id)
      .map((item) => {
        if (item.projectId !== column.projectId || !sameBoard(item.pageId, column.pageId)) return item;
        const position = siblings.filter((sibling) => sibling.id !== id).findIndex((sibling) => sibling.id === item.id);
        return {
          ...item,
          position,
          isDefault: column.isDefault && item.id === fallbackColumn.id ? true : item.isDefault,
          isArchive: column.isArchive && item.id === fallbackColumn.id ? true : item.isArchive,
        };
      });

    writeDb(db);
    return projectsApi.getColumns(column.projectId, column.pageId);
  },

  async reorderColumns(projectId: number, orderedIds: number[], pageId?: string) {
    if (useWorkspaceBackend) {
      return normalizeArray(await apiRequest<any[]>(`/projects/${projectId}/columns/reorder`, {
        method: 'POST',
        body: { orderedIds, pageId },
      }));
    }
    const db = readDb();
    db.columns = db.columns.map((column) => {
      const position = orderedIds.indexOf(column.id);
      return column.projectId === projectId && position !== -1 ? { ...column, position } : column;
    });
    writeDb(db);
    return projectsApi.getColumns(projectId, pageId);
  },

  async addMember(projectId: number, username: string) {
    if (useWorkspaceBackend) {
      return normalizeNumberId(await apiRequest<Project>(`/projects/${projectId}/members`, { method: 'POST', body: { username } }));
    }
    const db = readDb();
    const cleanUsername = username.replace(/^@/, '').trim();
    if (!cleanUsername) throw new Error('Username is required');

    const existingUser = db.users.find((user) => user.username === cleanUsername);
    const user = existingUser ?? {
      id: nextId(db.users),
      telegramId: `mock-${cleanUsername}`,
      username: cleanUsername,
      firstName: cleanUsername,
    };
    if (!existingUser) db.users.push(user);

    db.projects = db.projects.map((project) => {
      if (project.id !== projectId) return project;
      const members = project.members ?? [];
      if (members.some((member) => member.user?.username === cleanUsername)) return project;
      return {
        ...project,
        members: [
          ...members,
          {
            id: members.length ? Math.max(...members.map((member) => member.id)) + 1 : 1,
            projectId,
            userId: user.id,
            user,
            role: createEditorRole(projectId),
          },
        ],
      };
    });

    writeDb(db);
    activityApi.log({
      projectId,
      type: 'member_add',
      title: `Добавил участника @${cleanUsername}`,
      entityType: 'member',
      entityId: String(user.id),
      context: 'Настройки проекта',
    });
    return projectsApi.getOne(projectId);
  },

  async removeMember(projectId: number, memberId: number, actorUserId = 1) {
    if (useWorkspaceBackend) {
      return normalizeNumberId(await apiRequest<Project>(`/projects/${projectId}/members/${memberId}?actorUserId=${actorUserId}`, { method: 'DELETE' }));
    }
    const db = readDb();
    const project = db.projects.find((item) => item.id === projectId);
    if (!project) throw new Error('Project not found');
    if (project.ownerId !== actorUserId) throw new Error('Only project owner can remove members');

    const member = project.members?.find((item) => item.id === memberId);
    if (!member) throw new Error('Member not found');
    if (member.userId === project.ownerId) throw new Error('Owner cannot be removed');

    db.projects = db.projects.map((item) =>
      item.id === projectId
        ? { ...item, members: (item.members ?? []).filter((projectMember) => projectMember.id !== memberId) }
        : item,
    );
    writeDb(db);
    activityApi.log({
      projectId,
      userId: actorUserId,
      type: 'member_remove',
      title: `Удалил участника ${member.user?.firstName ?? member.user?.username ?? member.userId}`,
      entityType: 'member',
      entityId: String(member.userId),
      context: 'Настройки проекта',
    });
    return projectsApi.getOne(projectId);
  },

  async leaveProject(projectId: number, actorUserId = 1) {
    if (useWorkspaceBackend) {
      return apiRequest<{ success: true }>(`/projects/${projectId}/leave`, { method: 'POST', body: { actorUserId } });
    }
    const db = readDb();
    const project = db.projects.find((item) => item.id === projectId);
    if (!project) throw new Error('Project not found');
    if (project.ownerId === actorUserId) throw new Error('Owner must transfer ownership before leaving');
    if (!(project.members ?? []).some((member) => member.userId === actorUserId)) throw new Error('Member not found');

    db.projects = db.projects.map((item) =>
      item.id === projectId
        ? { ...item, members: (item.members ?? []).filter((member) => member.userId !== actorUserId) }
        : item,
    );
    writeDb(db);
    activityApi.log({
      projectId,
      userId: actorUserId,
      type: 'project_leave',
      title: 'Покинул проект',
      entityType: 'project',
      entityId: String(projectId),
      context: 'Настройки проекта',
    });
    return { success: true };
  },

  async transferOwnership(projectId: number, memberId: number, actorUserId = 1) {
    if (useWorkspaceBackend) {
      return normalizeNumberId(await apiRequest<Project>(`/projects/${projectId}/transfer-ownership`, {
        method: 'POST',
        body: { memberId, actorUserId },
      }));
    }
    const db = readDb();
    const project = db.projects.find((item) => item.id === projectId);
    if (!project) throw new Error('Project not found');
    if (project.ownerId !== actorUserId) throw new Error('Only project owner can transfer ownership');

    const nextOwner = project.members?.find((member) => member.id === memberId);
    const previousOwner = project.members?.find((member) => member.userId === actorUserId);
    if (!nextOwner) throw new Error('Member not found');
    if (nextOwner.userId === actorUserId) throw new Error('This member is already owner');

    db.projects = db.projects.map((item) => {
      if (item.id !== projectId) return item;
      return {
        ...item,
        ownerId: nextOwner.userId,
        members: (item.members ?? []).map((member) => {
          if (member.id === nextOwner.id) return { ...member, role: createOwnerRole(projectId) };
          if (previousOwner && member.id === previousOwner.id) return { ...member, role: createEditorRole(projectId) };
          return member;
        }),
      };
    });
    writeDb(db);
    activityApi.log({
      projectId,
      userId: actorUserId,
      type: 'ownership_transfer',
      title: `Передал права владельца ${nextOwner.user?.firstName ?? nextOwner.user?.username ?? nextOwner.userId}`,
      entityType: 'member',
      entityId: String(nextOwner.userId),
      context: 'Настройки проекта',
    });
    return projectsApi.getOne(projectId);
  },

  async setMemberAdmin(projectId: number, memberId: number, enabled: boolean, actorUserId = 1) {
    if (useWorkspaceBackend) {
      try {
        return normalizeNumberId(await apiRequest<Project>(`/projects/${projectId}/members/${memberId}/admin`, {
          method: 'POST',
          body: { enabled, actorUserId },
        }));
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('404')) throw error;
        const project = normalizeNumberId(await apiRequest<Project>(`/projects/${projectId}`));
        const members = (project.members ?? []).map((member) => ({
          id: String(member.id),
          projectId: String(projectId),
          userId: String(member.userId),
          role: member.id === memberId ? (enabled ? 'admin' : 'editor') : (member.role?.name ?? 'editor'),
        }));
        return normalizeNumberId(await apiRequest<Project>(`/projects/${projectId}`, {
          method: 'PATCH',
          body: { members },
        }));
      }
    }
    const db = readDb();
    const project = db.projects.find((item) => item.id === projectId);
    if (!project) throw new Error('Project not found');
    if (project.ownerId !== actorUserId) throw new Error('Only project owner can manage admins');

    const member = project.members?.find((item) => item.id === memberId);
    if (!member) throw new Error('Member not found');
    if (member.userId === project.ownerId) throw new Error('Owner already has admin access');

    db.projects = db.projects.map((item) =>
      item.id === projectId
        ? {
            ...item,
            members: (item.members ?? []).map((projectMember) =>
              projectMember.id === memberId
                ? { ...projectMember, role: enabled ? createAdminRole(projectId) : createEditorRole(projectId) }
                : projectMember,
            ),
          }
        : item,
    );
    writeDb(db);
    activityApi.log({
      projectId,
      userId: actorUserId,
      type: 'role_change',
      title: `${enabled ? 'Назначил администратора' : 'Снял администратора'}: ${member.user?.firstName ?? member.user?.username ?? member.userId}`,
      entityType: 'member',
      entityId: String(member.userId),
      context: 'Настройки проекта',
    });
    return projectsApi.getOne(projectId);
  },

  async getInviteCode(projectId: number, actorUserId = 1) {
    if (useWorkspaceBackend) {
      const response = await apiRequest<{ inviteCode: string }>(`/projects/${projectId}/invite-code?actorUserId=${actorUserId}`);
      return response.inviteCode;
    }
    const db = readDb();
    const project = db.projects.find((item) => item.id === projectId);
    if (!project) throw new Error('Project not found');
    if (project.ownerId !== actorUserId) throw new Error('Only project owner can manage invite code');
    const inviteCode = project.inviteCode ?? createInviteCode(projectId);
    db.projects = db.projects.map((item) => (item.id === projectId ? { ...item, inviteCode } : item));
    writeDb(db);
    return inviteCode;
  },

  async rotateInviteCode(projectId: number, actorUserId = 1) {
    if (useWorkspaceBackend) {
      const response = await apiRequest<{ inviteCode: string }>(`/projects/${projectId}/invite-code/rotate`, {
        method: 'POST',
        body: { actorUserId },
      });
      return response.inviteCode;
    }
    const db = readDb();
    const project = db.projects.find((item) => item.id === projectId);
    if (!project) throw new Error('Project not found');
    if (project.ownerId !== actorUserId) throw new Error('Only project owner can manage invite code');
    const inviteCode = createInviteCode(projectId);
    db.projects = db.projects.map((item) => (item.id === projectId ? { ...item, inviteCode } : item));
    writeDb(db);
    return inviteCode;
  },

  async requestJoinByCode(code: string, username: string, displayName?: string, userId?: number) {
    if (useWorkspaceBackend) {
      return apiRequest('/join-requests', { method: 'POST', body: { code, username, displayName, userId } });
    }
    const db = readDb();
    const cleanCode = code.trim().toUpperCase();
    const cleanUsername = username.replace(/^@/, '').trim();
    if (!cleanCode || !cleanUsername) throw new Error('Code and username are required');

    const project = db.projects.find((item) => item.inviteCode === cleanCode);
    if (!project) throw new Error('Project not found by invite code');
    if ((project.members ?? []).some((member) => member.user?.username === cleanUsername)) {
      throw new Error('User is already a member');
    }

    db.joinRequests = db.joinRequests ?? [];
    const existing = db.joinRequests.find(
      (request) => request.projectId === project.id && request.username === cleanUsername && request.status === 'pending',
    );
    if (existing) return existing;

    const request = {
      id: nextId(db.joinRequests),
      projectId: project.id,
      inviteCode: cleanCode,
      username: cleanUsername,
      displayName: displayName?.trim() || cleanUsername,
      status: 'pending' as const,
      createdAt: new Date().toISOString(),
    };
    db.joinRequests.push(request);
    writeDb(db);
    activityApi.log({
      projectId: project.id,
      type: 'member_add',
      title: `Р—Р°СЏРІРєР° РЅР° РґРѕСЃС‚СѓРї РѕС‚ @${cleanUsername}`,
      entityType: 'member',
      entityId: String(request.id),
      context: 'Р”РѕСЃС‚СѓРї РїРѕ РєРѕРґСѓ',
    });
    return request;
  },

  async getJoinRequests(projectId: number, actorUserId = 1) {
    if (useWorkspaceBackend) {
      return apiRequest<ProjectJoinRequest[]>(`/projects/${projectId}/join-requests?actorUserId=${actorUserId}`);
    }
    const db = readDb();
    const project = db.projects.find((item) => item.id === projectId);
    if (!project) throw new Error('Project not found');
    if (project.ownerId !== actorUserId) throw new Error('Only project owner can view requests');
    return (db.joinRequests ?? [])
      .filter((request) => request.projectId === projectId && request.status === 'pending')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  async approveJoinRequest(projectId: number, requestId: number, actorUserId = 1) {
    if (useWorkspaceBackend) {
      return normalizeNumberId(await apiRequest<Project>(`/projects/${projectId}/join-requests/${requestId}/approve`, {
        method: 'POST',
        body: { actorUserId },
      }));
    }
    const db = readDb();
    const project = db.projects.find((item) => item.id === projectId);
    if (!project) throw new Error('Project not found');
    if (project.ownerId !== actorUserId) throw new Error('Only project owner can approve requests');

    const request = (db.joinRequests ?? []).find((item) => item.id === requestId && item.projectId === projectId);
    if (!request) throw new Error('Request not found');
    if (request.status !== 'pending') throw new Error('Request is not pending');

    const existingUser = db.users.find((user) => user.username === request.username);
    const user = existingUser ?? {
      id: nextId(db.users),
      telegramId: `mock-${request.username}`,
      username: request.username,
      firstName: request.displayName ?? request.username,
    };
    if (!existingUser) db.users.push(user);

    db.projects = db.projects.map((item) => {
      if (item.id !== projectId) return item;
      const members = item.members ?? [];
      if (members.some((member) => member.userId === user.id)) return item;
      return {
        ...item,
        members: [
          ...members,
          {
            id: members.length ? Math.max(...members.map((member) => member.id)) + 1 : 1,
            projectId,
            userId: user.id,
            user,
            role: createEditorRole(projectId),
          },
        ],
      };
    });
    db.joinRequests = (db.joinRequests ?? []).map((item) =>
      item.id === requestId ? { ...item, status: 'approved', resolvedAt: new Date().toISOString() } : item,
    );
    writeDb(db);
    activityApi.log({
      projectId,
      userId: actorUserId,
      type: 'member_add',
      title: `РџРѕРґС‚РІРµСЂРґРёР» РґРѕСЃС‚СѓРї @${request.username}`,
      entityType: 'member',
      entityId: String(user.id),
      context: 'Р”РѕСЃС‚СѓРї РїРѕ РєРѕРґСѓ',
    });
    return projectsApi.getOne(projectId);
  },

  async rejectJoinRequest(projectId: number, requestId: number, actorUserId = 1) {
    if (useWorkspaceBackend) {
      return apiRequest<{ success: true }>(`/projects/${projectId}/join-requests/${requestId}/reject`, {
        method: 'POST',
        body: { actorUserId },
      });
    }
    const db = readDb();
    const project = db.projects.find((item) => item.id === projectId);
    if (!project) throw new Error('Project not found');
    if (project.ownerId !== actorUserId) throw new Error('Only project owner can reject requests');
    db.joinRequests = (db.joinRequests ?? []).map((item) =>
      item.id === requestId && item.projectId === projectId
        ? { ...item, status: 'rejected', resolvedAt: new Date().toISOString() }
        : item,
    );
    writeDb(db);
    return projectsApi.getJoinRequests(projectId, actorUserId);
  },
};

function createOwnerRole(projectId: number) {
  return {
    id: 1,
    projectId,
    name: 'owner',
    permissions: {
      createTask: true,
      deleteTask: true,
      manageColumns: true,
      manageMembers: true,
      viewAnalytics: true,
      manageProject: true,
    },
  };
}

function createEditorRole(projectId: number) {
  return {
    id: 2,
    projectId,
    name: 'editor',
    permissions: {
      createTask: true,
      deleteTask: false,
      manageColumns: false,
      manageMembers: false,
      viewAnalytics: false,
      manageProject: false,
    },
  };
}

function createAdminRole(projectId: number) {
  return {
    id: 3,
    projectId,
    name: 'admin',
    permissions: {
      createTask: true,
      deleteTask: true,
      manageColumns: true,
      manageMembers: true,
      viewAnalytics: true,
      manageProject: false,
    },
  };
}

function createInviteCode(projectId: number) {
  return `P${projectId}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function sameBoard(columnPageId: string | undefined, pageId: string | undefined) {
  return pageId ? columnPageId === pageId : !columnPageId;
}

function ensureBoardColumns(db: ReturnType<typeof readDb>, projectId: number, pageId?: string) {
  const existing = db.columns.some((column) => column.projectId === projectId && sameBoard(column.pageId, pageId));
  if (existing) return;

  const firstId = nextId(db.columns);
  db.columns.push(
    { id: firstId, projectId, pageId, title: 'Идея', position: 0, isDefault: false, isArchive: false, isHidden: false },
    { id: firstId + 1, projectId, pageId, title: 'В работе', position: 1, isDefault: true, isArchive: false, isHidden: false },
    { id: firstId + 2, projectId, pageId, title: 'Готово', position: 2, isDefault: false, isArchive: true, isHidden: false },
  );
}
