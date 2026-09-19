import type { Project, RolePermissions } from '../types';

const EMPTY_PERMISSIONS: RolePermissions = {
  viewProject: false,
  createTask: false,
  updateTask: false,
  moveTask: false,
  deleteTask: false,
  manageColumns: false,
  manageMembers: false,
  viewAnalytics: false,
  manageProject: false,
  manageWorkspace: false,
  createPage: false,
  updatePage: false,
  deletePage: false,
  manageTemplates: false,
  viewCalendar: false,
  createCalendarEvents: false,
  editOwnCalendarEvents: false,
  editAllCalendarEvents: false,
  deleteOwnCalendarEvents: false,
  deleteAllCalendarEvents: false,
  manageCalendar: false,
  manageReminders: false,
  manageBot: false,
  exportProject: false,
};

const OWNER_PERMISSIONS: RolePermissions = {
  viewProject: true,
  createTask: true,
  updateTask: true,
  moveTask: true,
  deleteTask: true,
  manageColumns: true,
  manageMembers: true,
  viewAnalytics: true,
  manageProject: true,
  manageWorkspace: true,
  createPage: true,
  updatePage: true,
  deletePage: true,
  manageTemplates: true,
  viewCalendar: true,
  createCalendarEvents: true,
  editOwnCalendarEvents: true,
  editAllCalendarEvents: true,
  deleteOwnCalendarEvents: true,
  deleteAllCalendarEvents: true,
  manageCalendar: true,
  manageReminders: true,
  manageBot: true,
  exportProject: true,
};

export function getProjectPermissions(project: Project | null | undefined, userId: number | string | undefined | null): RolePermissions {
  if (!project || userId === undefined || userId === null) return EMPTY_PERMISSIONS;
  if (String(project.ownerId) === String(userId)) return OWNER_PERMISSIONS;
  const member = (project.members ?? []).find((item) => String(item.userId) === String(userId));
  return { ...EMPTY_PERMISSIONS, ...(member?.role?.permissions ?? {}) };
}

export function canEditWorkspaceContent(permissions: RolePermissions) {
  return Boolean(
    permissions.createPage ||
    permissions.updatePage ||
    permissions.deletePage ||
    permissions.manageTemplates ||
    permissions.manageWorkspace,
  );
}
