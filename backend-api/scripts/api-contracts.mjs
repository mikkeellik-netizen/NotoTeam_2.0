const identifier = (value) => typeof value === "string" || typeof value === "number";
const string = (value) => typeof value === "string";
const number = (value) => typeof value === "number" && Number.isFinite(value);
const boolean = (value) => typeof value === "boolean";
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const array = Array.isArray;

const contracts = {
  authenticatedUser: {
    id: identifier,
    telegramId: string,
  },
  project: {
    id: identifier,
    ownerId: identifier,
    title: string,
    isArchived: boolean,
    createdAt: string,
    members: array,
    columns: array,
  },
  projectMember: {
    id: identifier,
    projectId: identifier,
    userId: identifier,
    user: object,
    role: object,
  },
  botSettings: {
    timezone: string,
    archiveCleanupMode: string,
    taskDeadlineNotificationsEnabled: boolean,
    mentionNotificationsEnabled: boolean,
    dutyNotificationsEnabled: boolean,
    smartAdminNotificationsEnabled: boolean,
    kanbanReminderPoints: array,
    reports: object,
  },
  calendar: {
    id: identifier,
    type: string,
    name: string,
    color: string,
    categories: array,
    permissions: object,
    createdAt: string,
    updatedAt: string,
  },
  calendarCategory: {
    id: identifier,
    label: string,
    color: string,
  },
  calendarEvent: {
    id: identifier,
    calendarId: identifier,
    ownerUserId: identifier,
    createdByUserId: identifier,
    title: string,
    startsAt: string,
    allDay: boolean,
    type: string,
    color: string,
    visibility: string,
    participantUserIds: array,
    notification: object,
    createdAt: string,
    updatedAt: string,
  },
  responsibilityArea: {
    id: identifier,
    projectId: identifier,
    title: string,
    ownerUserIds: array,
    color: string,
    icon: string,
    createdAt: string,
    updatedAt: string,
  },
  pageNode: {
    id: identifier,
    projectId: identifier,
    parentId: (value) => value === null || identifier(value),
    type: string,
    title: string,
    icon: string,
    order: number,
    createdAt: string,
    updatedAt: string,
  },
  pageTree: {
    projectId: identifier,
    parentId: (value) => value === null || identifier(value),
    nodes: array,
  },
  pageBlocks: {
    projectId: identifier,
    pageId: identifier,
    offset: number,
    limit: number,
    total: number,
    blocks: array,
  },
  block: {
    id: identifier,
    pageId: identifier,
    type: string,
    content: (value) => value !== undefined,
    order: number,
    createdAt: string,
    updatedAt: string,
  },
  projectFile: {
    id: identifier,
    projectId: identifier,
    uploaderUserId: identifier,
    fileName: string,
    mimeType: string,
    category: string,
    size: number,
    createdAt: string,
    updatedAt: string,
  },
  column: {
    id: identifier,
    projectId: identifier,
    title: string,
    position: number,
    isDefault: boolean,
    isArchive: boolean,
    isHidden: boolean,
  },
  task: {
    id: identifier,
    projectId: identifier,
    columnId: identifier,
    title: string,
    priority: string,
    isRepeating: boolean,
    position: number,
    isArchived: boolean,
    createdAt: string,
  },
  reminder: {
    id: identifier,
    projectId: identifier,
    creatorUserId: identifier,
    targetUserId: identifier,
    sourceType: string,
    title: string,
    scheduleType: string,
    status: string,
    channels: object,
    createdAt: string,
    updatedAt: string,
  },
  aiTokenRecord: {
    id: identifier,
    projectId: identifier,
    name: string,
    createdByUserId: identifier,
    createdAt: string,
    useCount: number,
    isActive: boolean,
  },
  aiContext: {
    kind: string,
    project: object,
    scope: string,
    generatedAt: string,
    tasks: array,
    workspace: object,
    limits: object,
  },
  aiChanges: {
    kind: string,
    projectId: identifier,
    since: string,
    generatedAt: string,
    newTasks: array,
    changedTasks: array,
    completedTasks: array,
    newPages: array,
    changedPages: array,
    recentActivity: array,
    limits: object,
  },
  systemSecurity: {
    events: array,
    total: number,
    offset: number,
    limit: number,
    hasMore: boolean,
    summary: object,
  },
  systemStats: {
    generatedAt: string,
    owner: object,
    totals: object,
    database: object,
    services: array,
    performance: object,
    storage: object,
    server: object,
    bot: object,
    users: array,
    recentUsers: array,
  },
};

export function assertApiContract(name, value) {
  const contract = contracts[name];
  if (!contract) throw new Error(`Unknown API contract: ${name}`);
  if (!object(value)) throw new Error(`${name} contract expected an object`);

  for (const [key, validate] of Object.entries(contract)) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new Error(`${name} contract is missing required field: ${key}`);
    }
    if (!validate(value[key])) {
      throw new Error(`${name} contract has invalid field: ${key}`);
    }
  }
  return value;
}

export function assertPaginatedContract(value, collectionKey) {
  if (!object(value)) throw new Error(`${collectionKey} pagination contract expected an object`);
  if (!Array.isArray(value[collectionKey])) throw new Error(`${collectionKey} pagination contract is missing its collection`);
  for (const key of ["total", "offset", "limit"]) {
    if (!number(value[key])) throw new Error(`${collectionKey} pagination contract has invalid field: ${key}`);
  }
  if (typeof value.hasMore !== "boolean") throw new Error(`${collectionKey} pagination contract has invalid field: hasMore`);
  return value;
}
