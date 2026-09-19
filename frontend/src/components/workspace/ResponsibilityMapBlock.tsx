import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { projectsApi } from '../../api/projects';
import { tasksApi } from '../../api/tasks';
import { useAuthStore } from '../../store/authStore';
import type { PageNode, ProjectMember, ResponsibilityArea, ResponsibilityPlanItem, Task } from '../../types';
import IconPickerModal from './IconPickerModal';

type ResponsibilityView = 'cards' | 'summary';

interface Props {
  projectId: string;
  pageId: string;
  members: ProjectMember[];
  nodes: PageNode[];
  view: ResponsibilityView;
  canEdit: boolean;
  onViewChange: (view: ResponsibilityView) => void;
}

interface ResponsibilityNavigationState {
  responsibilityAreaId?: string;
  responsibilitySourcePageId?: string;
}

interface AreaSummary {
  area: ResponsibilityArea;
  owners: ProjectMember[];
  tasks: Task[];
  overdueTasks: Task[];
}

interface AreaDraft {
  title: string;
  description: string;
  icon: string;
  color: string;
  ownerUserIds: string[];
  linkedPageIds: string[];
  linkedKanbanBoardIds: string[];
  linkedTaskIds: string[];
}

interface AreaWorkspaceDraft {
  description: string;
  notes: string;
  planItems: ResponsibilityPlanItem[];
  linkedPageIds: string[];
  linkedKanbanBoardIds: string[];
  linkedTaskIds: string[];
}

const AREA_COLORS = ['#3B82F6', '#22C55E', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#64748B'];
const AREA_ICONS = ['📌', '🧩', '🎯', '🛠', '📣', '📊', '💼', '🤝', '👥', '🧠', '⚙️', '🚀'];

export default function ResponsibilityMapBlock({
  projectId,
  pageId,
  members,
  nodes,
  view,
  canEdit,
  onViewChange,
}: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const currentUser = useAuthStore((state) => state.user);
  const [areas, setAreas] = useState<ResponsibilityArea[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
  const [editingArea, setEditingArea] = useState<ResponsibilityArea | null | undefined>(undefined);
  const [workingArea, setWorkingArea] = useState<ResponsibilityArea | null>(null);
  const [deletingArea, setDeletingArea] = useState<ResponsibilityArea | null>(null);
  const [saving, setSaving] = useState(false);
  const [displayView, setDisplayView] = useState<ResponsibilityView>(view);

  const currentMember = members.find((member) => String(member.userId) === String(currentUser?.id));
  const roleName = currentMember?.role?.name;
  const canManage = Boolean(
    canEdit
      && currentUser
      && (roleName === 'owner' || roleName === 'admin' || currentMember?.role?.permissions?.manageProject),
  );
  const canWorkArea = (area: ResponsibilityArea) => Boolean(
    canEdit
      && currentUser
      && (canManage || area.ownerUserIds.some((userId) => String(userId) === String(currentUser.id))),
  );

  useEffect(() => {
    setDisplayView(view);
  }, [view]);

  useEffect(() => {
    const navigationState = location.state as ResponsibilityNavigationState | null;
    if (
      !navigationState?.responsibilityAreaId
      || navigationState.responsibilitySourcePageId !== pageId
    ) return;

    setSelectedAreaId(String(navigationState.responsibilityAreaId));
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [location.pathname, location.search, location.state, navigate, pageId]);

  const changeView = (nextView: ResponsibilityView) => {
    setDisplayView(nextView);
    if (canEdit) onViewChange(nextView);
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    Promise.all([
      projectsApi.getResponsibilityAreas(Number(projectId)),
      tasksApi.getAllProjectTasks(Number(projectId)),
    ])
      .then(([nextAreas, nextTasks]) => {
        if (cancelled) return;
        setAreas(nextAreas);
        setTasks(nextTasks.filter((task) => !task.isArchived && !task.completedAt));
      })
      .catch(() => {
        if (!cancelled) setError('Не удалось загрузить карту ответственности.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, refreshVersion]);

  const projectNodes = useMemo(
    () => nodes.filter((node) => node.projectId === projectId && node.id !== pageId && !node.isDeleted),
    [nodes, pageId, projectId],
  );
  const summaries = useMemo(
    () => buildAreaSummaries(areas, members, tasks),
    [areas, members, tasks],
  );
  const selectedSummary = summaries.find((summary) => String(summary.area.id) === selectedAreaId) ?? null;

  const saveArea = async (draft: AreaDraft) => {
    if (!currentUser || !canManage) return;
    setSaving(true);
    setError('');
    try {
      const saved = editingArea
        ? await projectsApi.updateResponsibilityArea(Number(projectId), editingArea.id, draft, currentUser.id)
        : await projectsApi.createResponsibilityArea(Number(projectId), draft, currentUser.id);
      setAreas((current) => (
        editingArea
          ? current.map((area) => (String(area.id) === String(saved.id) ? saved : area))
          : [...current, saved]
      ));
      setEditingArea(undefined);
      setSelectedAreaId(String(saved.id));
    } catch {
      setError('Не удалось сохранить зону. Проверьте права доступа и повторите попытку.');
    } finally {
      setSaving(false);
    }
  };

  const deleteArea = async () => {
    if (!currentUser || !canManage || !deletingArea) return;
    const areaId = deletingArea.id;
    setSaving(true);
    setError('');
    try {
      await projectsApi.deleteResponsibilityArea(Number(projectId), areaId, currentUser.id);
      setAreas((current) => current.filter((area) => String(area.id) !== String(areaId)));
      if (selectedAreaId === String(areaId)) setSelectedAreaId(null);
      setDeletingArea(null);
    } catch {
      setError('Не удалось удалить зону.');
    } finally {
      setSaving(false);
    }
  };

  const saveWorkspace = async (area: ResponsibilityArea, draft: AreaWorkspaceDraft) => {
    if (!currentUser || !canWorkArea(area)) return;
    setSaving(true);
    setError('');
    try {
      const saved = await projectsApi.updateResponsibilityArea(Number(projectId), area.id, draft, currentUser.id);
      setAreas((current) => current.map((item) => (String(item.id) === String(saved.id) ? saved : item)));
      setWorkingArea(null);
      setSelectedAreaId(String(saved.id));
    } catch {
      setError('Не удалось сохранить рабочее пространство зоны.');
    } finally {
      setSaving(false);
    }
  };

  const responsibilityLinkState = (area: ResponsibilityArea) => ({
    responsibilityReturn: {
      projectId,
      pageId,
      areaId: String(area.id),
      areaTitle: area.title,
    },
  });

  const openLinkedPage = (targetPageId: string, area: ResponsibilityArea) => {
    navigate(`/project/${projectId}/workspace/page/${targetPageId}`, {
      state: responsibilityLinkState(area),
    });
  };

  const openTask = (task: Task, area: ResponsibilityArea) => {
    if (!task.pageId) return;
    navigate(`/project/${projectId}/workspace/page/${task.pageId}?taskId=${encodeURIComponent(String(task.id))}`, {
      state: responsibilityLinkState(area),
    });
  };

  return (
    <section className="py-2">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)] p-1">
          <ViewButton active={displayView === 'cards'} onClick={() => changeView('cards')}>Карточки</ViewButton>
          <ViewButton active={displayView === 'summary'} onClick={() => changeView('summary')}>Сводка</ViewButton>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setEditingArea(null)}
            className="rounded-[8px] bg-[var(--tg-theme-button-color)] px-3 py-2 text-sm font-semibold text-[var(--tg-theme-button-text-color)] active:scale-95"
          >
            + Добавить зону
          </button>
        )}
      </div>

      {error && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-[8px] bg-red-500/10 px-3 py-2 text-sm text-red-400">
          <span>{error}</span>
          <button type="button" onClick={() => setRefreshVersion((value) => value + 1)} className="font-semibold">Повторить</button>
        </div>
      )}

      {loading ? (
        <div className="rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)] px-4 py-8 text-center text-sm text-[var(--tg-theme-hint-color)]">
          Загружаю зоны ответственности...
        </div>
      ) : summaries.length === 0 ? (
        <div className="rounded-[8px] border border-dashed border-[var(--tg-theme-section-separator-color)] px-4 py-8 text-center">
          <p className="font-semibold text-[var(--tg-theme-text-color)]">Зон ответственности пока нет</p>
          <p className="mt-1 text-sm text-[var(--tg-theme-hint-color)]">Создайте первую зону и назначьте ответственных участников проекта.</p>
          {canManage && (
            <button
              type="button"
              onClick={() => setEditingArea(null)}
              className="mt-4 rounded-[8px] bg-[var(--tg-theme-button-color)] px-4 py-2 text-sm font-semibold text-[var(--tg-theme-button-text-color)]"
            >
              Добавить первую зону
            </button>
          )}
        </div>
      ) : displayView === 'cards' ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {summaries.map((summary) => (
            <AreaCard
              key={summary.area.id}
              summary={summary}
              canWork={canWorkArea(summary.area)}
              onOpen={() => setSelectedAreaId(String(summary.area.id))}
              onWork={() => setWorkingArea(summary.area)}
            />
          ))}
        </div>
      ) : (
        <AreaSummaryTable summaries={summaries} onOpen={(area) => setSelectedAreaId(String(area.id))} />
      )}

      {selectedSummary && editingArea === undefined && (
        <AreaDetails
          summary={selectedSummary}
          nodes={projectNodes}
          canManage={canManage}
          canWork={canWorkArea(selectedSummary.area)}
          onOpenPage={(targetPageId) => openLinkedPage(targetPageId, selectedSummary.area)}
          onOpenTask={(task) => openTask(task, selectedSummary.area)}
          onEdit={() => setEditingArea(selectedSummary.area)}
          onWork={() => setWorkingArea(selectedSummary.area)}
          onDelete={() => setDeletingArea(selectedSummary.area)}
          onClose={() => setSelectedAreaId(null)}
        />
      )}

      {editingArea !== undefined && canManage && (
        <AreaEditor
          area={editingArea}
          members={members}
          nodes={projectNodes}
          tasks={tasks}
          saving={saving}
          onSave={saveArea}
          onClose={() => setEditingArea(undefined)}
        />
      )}

      {workingArea && canWorkArea(workingArea) && (
        <AreaWorkspaceEditor
          area={workingArea}
          nodes={projectNodes}
          tasks={tasks}
          saving={saving}
          onSave={(draft) => saveWorkspace(workingArea, draft)}
          onClose={() => setWorkingArea(null)}
        />
      )}

      {deletingArea && canManage && (
        <div className="fixed inset-0 z-[160] flex items-end bg-black/55 p-3" onClick={() => setDeletingArea(null)}>
          <section className="w-full rounded-[8px] bg-[var(--tg-theme-bg-color)] p-4" onClick={(event) => event.stopPropagation()}>
            <h3 className="text-lg font-bold text-[var(--tg-theme-text-color)]">Удалить зону?</h3>
            <p className="mt-1 text-sm text-[var(--tg-theme-hint-color)]">Задачи и страницы останутся в проекте. Исчезнет только связь с зоной «{deletingArea.title}».</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setDeletingArea(null)} className="rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-3 font-semibold text-[var(--tg-theme-text-color)]">Отмена</button>
              <button type="button" onClick={deleteArea} disabled={saving} className="rounded-[8px] bg-red-500 px-3 py-3 font-semibold text-white disabled:opacity-50">Удалить</button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

function ViewButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-[6px] px-3 py-1.5 text-xs font-semibold ${active ? 'bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)]' : 'text-[var(--tg-theme-hint-color)]'}`}
    >
      {children}
    </button>
  );
}

function AreaCard({
  summary,
  canWork,
  onOpen,
  onWork,
}: {
  summary: AreaSummary;
  canWork: boolean;
  onOpen: () => void;
  onWork: () => void;
}) {
  return (
    <article
      className="relative cursor-pointer overflow-hidden rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)] p-4 active:scale-[0.99]"
      onClick={onOpen}
    >
      <span className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: summary.area.color }} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xl">{summary.area.icon}</span>
            <h3 className="truncate font-bold text-[var(--tg-theme-text-color)]">{summary.area.title}</h3>
          </div>
          <p className="mt-2 truncate text-sm text-[var(--tg-theme-hint-color)]">{ownerList(summary.owners)}</p>
        </div>
        {canWork ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onWork();
            }}
            className="shrink-0 rounded-[6px] bg-[var(--tg-theme-button-color)] px-2 py-1 text-xs font-semibold text-[var(--tg-theme-button-text-color)]"
          >
            Работать
          </button>
        ) : null}
      </div>
      <div className="mt-4 flex items-center gap-4 text-xs">
        <span className="font-semibold text-[var(--tg-theme-text-color)]">{summary.tasks.length} активных</span>
        <span className={summary.overdueTasks.length ? 'font-semibold text-red-400' : 'text-[var(--tg-theme-hint-color)]'}>
          {summary.overdueTasks.length} просрочено
        </span>
      </div>
    </article>
  );
}

function AreaSummaryTable({ summaries, onOpen }: { summaries: AreaSummary[]; onOpen: (area: ResponsibilityArea) => void }) {
  return (
    <div className="overflow-x-auto rounded-[8px] border border-[var(--tg-theme-section-separator-color)]">
      <table className="w-full min-w-[560px] border-collapse text-left text-sm">
        <thead className="bg-[var(--tg-theme-secondary-bg-color)] text-xs text-[var(--tg-theme-hint-color)]">
          <tr>
            <th className="px-3 py-2 font-semibold">Зона</th>
            <th className="px-3 py-2 font-semibold">Ответственные</th>
            <th className="px-3 py-2 text-right font-semibold">Задачи</th>
            <th className="px-3 py-2 text-right font-semibold">Просрочено</th>
          </tr>
        </thead>
        <tbody>
          {summaries.map((summary) => (
            <tr key={summary.area.id} className="border-t border-[var(--tg-theme-section-separator-color)]">
              <td className="px-3 py-3">
                <button type="button" onClick={() => onOpen(summary.area)} className="flex max-w-[220px] items-center gap-2 font-semibold text-[var(--tg-theme-link-color)]">
                  <span>{summary.area.icon}</span>
                  <span className="truncate">{summary.area.title}</span>
                </button>
              </td>
              <td className="max-w-[220px] truncate px-3 py-3 text-[var(--tg-theme-text-color)]">{ownerList(summary.owners)}</td>
              <td className="px-3 py-3 text-right font-semibold text-[var(--tg-theme-text-color)]">{summary.tasks.length}</td>
              <td className={`px-3 py-3 text-right font-semibold ${summary.overdueTasks.length ? 'text-red-400' : 'text-[var(--tg-theme-hint-color)]'}`}>{summary.overdueTasks.length}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AreaDetails({
  summary,
  nodes,
  canManage,
  canWork,
  onOpenPage,
  onOpenTask,
  onEdit,
  onWork,
  onDelete,
  onClose,
}: {
  summary: AreaSummary;
  nodes: PageNode[];
  canManage: boolean;
  canWork: boolean;
  onOpenPage: (pageId: string) => void;
  onOpenTask: (task: Task) => void;
  onEdit: () => void;
  onWork: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [tasksExpanded, setTasksExpanded] = useState(false);
  const linkedIds = new Set([...(summary.area.linkedPageIds ?? []), ...(summary.area.linkedKanbanBoardIds ?? [])].map(String));
  const linkedNodes = nodes.filter((node) => linkedIds.has(String(node.id)));
  const planItems = summary.area.planItems ?? [];
  const status = summary.overdueTasks.length ? 'Есть риски' : summary.tasks.length ? 'В работе' : 'Спокойно';
  const statusClass = summary.overdueTasks.length
    ? 'border-red-500/40 bg-red-500/10 text-red-300'
    : summary.tasks.length
      ? 'border-yellow-500/40 bg-yellow-500/10 text-yellow-200'
      : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200';
  return (
    <div className="fixed inset-0 z-[150] flex items-end bg-black/55 p-2 sm:items-center sm:justify-center" onClick={onClose}>
      <section className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-[8px] bg-[var(--tg-theme-bg-color)] sm:rounded-[8px]" onClick={(event) => event.stopPropagation()}>
        <div className="h-1.5" style={{ backgroundColor: summary.area.color }} />
        <div className="p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-2xl">{summary.area.icon}</span>
                <h3 className="truncate text-xl font-bold text-[var(--tg-theme-text-color)]">{summary.area.title}</h3>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className={`rounded-full border px-2 py-1 text-[11px] font-bold ${statusClass}`}>{status}</span>
              <button type="button" onClick={onClose} className="h-9 w-9 rounded-full bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-text-color)]" aria-label="Закрыть">×</button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {summary.owners.length ? summary.owners.map((owner) => (
              <span key={owner.id} className="rounded-full bg-[var(--tg-theme-secondary-bg-color)] px-3 py-1 text-xs text-[var(--tg-theme-text-color)]">
                {ownerList([owner])}
              </span>
            )) : (
              <span className="rounded-full bg-red-500/15 px-3 py-1 text-xs text-red-300">нет ответственного</span>
            )}
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <AreaMetric label="активных" value={summary.tasks.length} />
            <AreaMetric label="просрочено" value={summary.overdueTasks.length} danger={summary.overdueTasks.length > 0} />
            <AreaMetric label="пунктов плана" value={planItems.length} />
          </div>

        <section className="mt-4 border-t border-[var(--tg-theme-section-separator-color)] pt-4">
          <h4 className="text-xs font-semibold uppercase text-[var(--tg-theme-hint-color)]">Описание и видение</h4>
          <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--tg-theme-text-color)]">{summary.area.description || 'Описание пока не добавлено.'}</p>
        </section>

        <section className="mt-4 border-t border-[var(--tg-theme-section-separator-color)] pt-4">
          <h4 className="text-xs font-semibold uppercase text-[var(--tg-theme-hint-color)]">Рабочие заметки</h4>
          <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--tg-theme-text-color)]">{summary.area.notes || 'Записей пока нет.'}</p>
        </section>

        <section className="mt-4 border-t border-[var(--tg-theme-section-separator-color)] pt-4">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-semibold uppercase text-[var(--tg-theme-hint-color)]">План</h4>
            <span className="text-xs text-[var(--tg-theme-hint-color)]">{planItems.filter((item) => item.completed).length}/{planItems.length}</span>
          </div>
          {planItems.length ? (
            <div className="mt-2 space-y-2">
              {planItems.map((item) => (
                <div key={item.id} className="flex items-start gap-2 rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-2">
                  <span className={`mt-0.5 font-semibold ${item.completed ? 'text-green-400' : 'text-[var(--tg-theme-hint-color)]'}`}>{item.completed ? '✓' : '○'}</span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-sm text-[var(--tg-theme-text-color)] ${item.completed ? 'line-through opacity-60' : ''}`}>{item.title}</span>
                    {item.dueDate && <span className="mt-0.5 block text-xs text-[var(--tg-theme-hint-color)]">{formatPlanDate(item.dueDate)}</span>}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-[var(--tg-theme-hint-color)]">План пока пуст.</p>
          )}
        </section>

        <section className="mt-4 border-t border-[var(--tg-theme-section-separator-color)] pt-4">
          <h4 className="text-xs font-semibold uppercase text-[var(--tg-theme-hint-color)]">Страницы и материалы</h4>
          {linkedNodes.length ? (
            <div className="mt-2 space-y-2">
              {linkedNodes.map((node) => (
                <button key={node.id} type="button" onClick={() => onOpenPage(node.id)} className="flex w-full items-center gap-2 rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-2 text-left text-sm font-semibold text-[var(--tg-theme-link-color)]">
                  <span>{node.icon}</span><span className="truncate">{node.title}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-[var(--tg-theme-hint-color)]">Связанных страниц пока нет.</p>
          )}
        </section>

        {(canWork || canManage) && (
          <div className="mt-5 flex flex-wrap gap-2">
            {canWork && <button type="button" onClick={onWork} className="min-w-[160px] flex-1 rounded-[8px] bg-[var(--tg-theme-button-color)] px-4 py-3 font-semibold text-[var(--tg-theme-button-text-color)]">Работать в зоне</button>}
            {canManage && <button type="button" onClick={onEdit} className="rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)] px-4 py-3 font-semibold text-[var(--tg-theme-text-color)]">Настроить</button>}
            {canManage && <button type="button" onClick={onDelete} className="rounded-[8px] bg-red-500/15 px-4 py-3 font-semibold text-red-400" aria-label="Удалить зону">Удалить</button>}
          </div>
        )}

        <section className="mt-5 border-t border-[var(--tg-theme-section-separator-color)] pt-4">
          <button
            type="button"
            onClick={() => setTasksExpanded((expanded) => !expanded)}
            aria-expanded={tasksExpanded}
            className="flex w-full items-center justify-between gap-3 rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-3 text-left"
          >
            <span className="font-semibold text-[var(--tg-theme-text-color)]">Активные задачи</span>
            <span className="flex items-center gap-2 text-xs text-[var(--tg-theme-hint-color)]">
              {summary.tasks.length}
              <span className={`text-base transition-transform ${tasksExpanded ? 'rotate-180' : ''}`}>⌄</span>
            </span>
          </button>
          {tasksExpanded && (
            summary.tasks.length ? (
              <div className="mt-2 space-y-2">
                {summary.tasks.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => onOpenTask(task)}
                    disabled={!task.pageId}
                    className="block w-full rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-2 text-left transition active:scale-[0.99] disabled:opacity-50"
                  >
                    <span className="block truncate text-sm font-semibold text-[var(--tg-theme-text-color)]">{task.title}</span>
                    <span className="mt-1 block text-xs text-[var(--tg-theme-hint-color)]">{formatDeadline(task.deadlineAt)}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-2 rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-2 text-sm text-[var(--tg-theme-hint-color)]">Связанных активных задач нет.</p>
            )
          )}
        </section>
        </div>
      </section>
    </div>
  );
}

function AreaMetric({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)] px-2 py-2 text-center">
      <p className={`text-base font-bold ${danger ? 'text-red-400' : 'text-[var(--tg-theme-text-color)]'}`}>{value}</p>
      <p className="truncate text-[10px] text-[var(--tg-theme-hint-color)]">{label}</p>
    </div>
  );
}

function AreaWorkspaceEditor({
  area,
  nodes,
  tasks,
  saving,
  onSave,
  onClose,
}: {
  area: ResponsibilityArea;
  nodes: PageNode[];
  tasks: Task[];
  saving: boolean;
  onSave: (draft: AreaWorkspaceDraft) => void | Promise<void>;
  onClose: () => void;
}) {
  const [description, setDescription] = useState(area.description ?? '');
  const [notes, setNotes] = useState(area.notes ?? '');
  const [planItems, setPlanItems] = useState<ResponsibilityPlanItem[]>(area.planItems ?? []);
  const [newPlanTitle, setNewPlanTitle] = useState('');
  const [newPlanDate, setNewPlanDate] = useState('');
  const [linkedPageIds, setLinkedPageIds] = useState<string[]>((area.linkedPageIds ?? []).map(String));
  const [linkedKanbanBoardIds, setLinkedKanbanBoardIds] = useState<string[]>((area.linkedKanbanBoardIds ?? []).map(String));
  const [linkedTaskIds, setLinkedTaskIds] = useState<string[]>((area.linkedTaskIds ?? []).map(String));
  const [taskQuery, setTaskQuery] = useState('');
  const pages = nodes.filter((node) => node.type === 'page');
  const boards = nodes.filter((node) => node.type === 'kanban');
  const visibleTasks = tasks
    .filter((task) => task.title.toLowerCase().includes(taskQuery.trim().toLowerCase()))
    .sort((left, right) => Number(linkedTaskIds.includes(String(right.id))) - Number(linkedTaskIds.includes(String(left.id))))
    .slice(0, 80);

  const addPlanItem = () => {
    const title = newPlanTitle.trim();
    if (!title) return;
    const timestamp = new Date().toISOString();
    setPlanItems((current) => [
      ...current,
      {
        id: `plan_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        title,
        completed: false,
        dueDate: newPlanDate,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ]);
    setNewPlanTitle('');
    setNewPlanDate('');
  };

  const updatePlanItem = (itemId: string, patch: Partial<ResponsibilityPlanItem>) => {
    setPlanItems((current) => current.map((item) => (
      item.id === itemId ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item
    )));
  };

  return (
    <div className="fixed inset-0 z-[158] flex items-end bg-black/60" onClick={onClose}>
      <section className="mx-auto max-h-[96vh] w-full max-w-3xl overflow-y-auto rounded-t-[8px] bg-[var(--tg-theme-bg-color)]" onClick={(event) => event.stopPropagation()}>
        <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-[var(--tg-theme-section-separator-color)] bg-[var(--tg-theme-bg-color)] p-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase text-[var(--tg-theme-hint-color)]">Рабочее пространство</p>
            <h3 className="mt-1 truncate text-lg font-bold text-[var(--tg-theme-text-color)]">{area.icon} {area.title}</h3>
          </div>
          <button type="button" onClick={onClose} className="h-9 w-9 shrink-0 rounded-full bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-text-color)]" aria-label="Закрыть">×</button>
        </header>

        <div className="space-y-5 p-4">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase text-[var(--tg-theme-hint-color)]">Описание и видение</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={2000}
              className="h-28 w-full resize-y rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-3 text-sm text-[var(--tg-theme-text-color)] outline-none"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase text-[var(--tg-theme-hint-color)]">Рабочие заметки</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              maxLength={30000}
              placeholder="Заметки, решения, идеи и итоги"
              className="h-44 w-full resize-y rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-3 text-sm text-[var(--tg-theme-text-color)] outline-none"
            />
          </label>

          <section>
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-xs font-semibold uppercase text-[var(--tg-theme-hint-color)]">План</h4>
              <span className="text-xs text-[var(--tg-theme-hint-color)]">{planItems.filter((item) => item.completed).length}/{planItems.length}</span>
            </div>
            <div className="mt-2 space-y-2">
              {planItems.map((item) => (
                <div key={item.id} className="rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)] p-3">
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={item.completed}
                      onChange={(event) => updatePlanItem(item.id, { completed: event.target.checked })}
                      className="mt-2 h-4 w-4 shrink-0 accent-[var(--tg-theme-button-color)]"
                    />
                    <input
                      value={item.title}
                      onChange={(event) => updatePlanItem(item.id, { title: event.target.value })}
                      maxLength={500}
                      className={`min-w-0 flex-1 bg-transparent py-1 text-sm text-[var(--tg-theme-text-color)] outline-none ${item.completed ? 'line-through opacity-60' : ''}`}
                    />
                    <button type="button" onClick={() => setPlanItems((current) => current.filter((entry) => entry.id !== item.id))} className="h-8 w-8 shrink-0 rounded-[6px] text-red-400" aria-label="Удалить пункт">×</button>
                  </div>
                  <input
                    type="date"
                    value={item.dueDate ?? ''}
                    onChange={(event) => updatePlanItem(item.id, { dueDate: event.target.value })}
                    className="ml-6 mt-1 rounded-[6px] bg-[var(--tg-theme-bg-color)] px-2 py-1 text-xs text-[var(--tg-theme-text-color)] outline-none"
                    aria-label="Срок пункта плана"
                  />
                </div>
              ))}
            </div>
            <div className="mt-2 rounded-[8px] border border-dashed border-[var(--tg-theme-section-separator-color)] p-3">
              <input
                value={newPlanTitle}
                onChange={(event) => setNewPlanTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addPlanItem();
                  }
                }}
                maxLength={500}
                placeholder="Новый пункт плана"
                className="w-full bg-transparent text-sm text-[var(--tg-theme-text-color)] outline-none"
              />
              <div className="mt-2 flex items-center gap-2">
                <input type="date" value={newPlanDate} onChange={(event) => setNewPlanDate(event.target.value)} className="min-w-0 flex-1 rounded-[6px] bg-[var(--tg-theme-secondary-bg-color)] px-2 py-2 text-xs text-[var(--tg-theme-text-color)] outline-none" aria-label="Срок нового пункта" />
                <button type="button" onClick={addPlanItem} disabled={!newPlanTitle.trim()} className="rounded-[6px] bg-[var(--tg-theme-button-color)] px-3 py-2 text-sm font-semibold text-[var(--tg-theme-button-text-color)] disabled:opacity-40">Добавить</button>
              </div>
            </div>
          </section>

          <EditorSection title="Страницы и материалы" count={linkedPageIds.length}>
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {pages.length ? pages.map((node) => <CheckRow key={node.id} checked={linkedPageIds.includes(node.id)} onChange={() => setLinkedPageIds(toggleId(linkedPageIds, node.id))} title={`${node.icon} ${node.title}`} />) : <EmptyList />}
            </div>
          </EditorSection>

          <EditorSection title="Kanban-доски" count={linkedKanbanBoardIds.length}>
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {boards.length ? boards.map((node) => <CheckRow key={node.id} checked={linkedKanbanBoardIds.includes(node.id)} onChange={() => setLinkedKanbanBoardIds(toggleId(linkedKanbanBoardIds, node.id))} title={`${node.icon} ${node.title}`} />) : <EmptyList />}
            </div>
          </EditorSection>

          <EditorSection title="Связанные задачи Kanban" count={linkedTaskIds.length}>
            <input value={taskQuery} onChange={(event) => setTaskQuery(event.target.value)} placeholder="Найти задачу" className="mb-2 w-full rounded-[8px] bg-[var(--tg-theme-bg-color)] px-3 py-2 text-sm text-[var(--tg-theme-text-color)] outline-none" />
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {visibleTasks.length ? visibleTasks.map((task) => <CheckRow key={task.id} checked={linkedTaskIds.includes(String(task.id))} onChange={() => setLinkedTaskIds(toggleId(linkedTaskIds, task.id))} title={task.title} subtitle={formatDeadline(task.deadlineAt)} />) : <EmptyList />}
            </div>
          </EditorSection>
        </div>

        <footer className="sticky bottom-0 border-t border-[var(--tg-theme-section-separator-color)] bg-[var(--tg-theme-bg-color)] p-4">
          <button
            type="button"
            onClick={() => onSave({
              description: description.trim(),
              notes: notes.trim(),
              planItems: planItems.filter((item) => item.title.trim()).map((item) => ({ ...item, title: item.title.trim() })),
              linkedPageIds,
              linkedKanbanBoardIds,
              linkedTaskIds,
            })}
            disabled={saving}
            className="w-full rounded-[8px] bg-[var(--tg-theme-button-color)] py-3 font-semibold text-[var(--tg-theme-button-text-color)] disabled:opacity-50"
          >
            {saving ? 'Сохраняю...' : 'Сохранить изменения'}
          </button>
        </footer>
      </section>
    </div>
  );
}

function AreaEditor({
  area,
  members,
  nodes,
  tasks,
  saving,
  onSave,
  onClose,
}: {
  area: ResponsibilityArea | null;
  members: ProjectMember[];
  nodes: PageNode[];
  tasks: Task[];
  saving: boolean;
  onSave: (draft: AreaDraft) => void | Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(area?.title ?? '');
  const [description, setDescription] = useState(area?.description ?? '');
  const [icon, setIcon] = useState(area?.icon ?? AREA_ICONS[0]);
  const [color, setColor] = useState(area?.color ?? AREA_COLORS[0]);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [ownerUserIds, setOwnerUserIds] = useState<string[]>((area?.ownerUserIds ?? []).map(String));
  const [linkedPageIds, setLinkedPageIds] = useState<string[]>((area?.linkedPageIds ?? []).map(String));
  const [linkedKanbanBoardIds, setLinkedKanbanBoardIds] = useState<string[]>((area?.linkedKanbanBoardIds ?? []).map(String));
  const [linkedTaskIds, setLinkedTaskIds] = useState<string[]>((area?.linkedTaskIds ?? []).map(String));
  const [taskQuery, setTaskQuery] = useState('');
  const pages = nodes.filter((node) => node.type === 'page');
  const boards = nodes.filter((node) => node.type === 'kanban');
  const visibleTasks = tasks
    .filter((task) => task.title.toLowerCase().includes(taskQuery.trim().toLowerCase()))
    .sort((left, right) => Number(linkedTaskIds.includes(String(right.id))) - Number(linkedTaskIds.includes(String(left.id))))
    .slice(0, 80);

  return (
    <div className="fixed inset-0 z-[155] flex items-end bg-black/55" onClick={onClose}>
      <section className="max-h-[92vh] w-full overflow-y-auto rounded-t-[8px] bg-[var(--tg-theme-bg-color)] p-4" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-[var(--tg-theme-text-color)]">{area ? 'Редактировать зону' : 'Новая зона'}</h3>
            <p className="text-xs text-[var(--tg-theme-hint-color)]">Все связи используют данные текущего проекта.</p>
          </div>
          <button type="button" onClick={onClose} className="h-9 w-9 rounded-full bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-text-color)]" aria-label="Закрыть">×</button>
        </div>

        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-[var(--tg-theme-hint-color)]">Название</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder="Название зоны" className="w-full rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-3 text-sm text-[var(--tg-theme-text-color)] outline-none" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-[var(--tg-theme-hint-color)]">Описание и видение</span>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} placeholder="За что отвечает зона и какой результат должна создавать" className="h-24 w-full resize-none rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-3 text-sm text-[var(--tg-theme-text-color)] outline-none" />
          </label>

          <div>
            <span className="mb-2 block text-xs font-semibold text-[var(--tg-theme-hint-color)]">Иконка</span>
            <div className="flex flex-wrap gap-2">
              {AREA_ICONS.map((item) => <button key={item} type="button" onClick={() => setIcon(item)} className={`h-10 w-10 rounded-[8px] text-lg ${icon === item ? 'bg-[var(--tg-theme-button-color)]' : 'bg-[var(--tg-theme-secondary-bg-color)]'}`}>{item}</button>)}
              <button
                type="button"
                onClick={() => setIconPickerOpen(true)}
                className="h-10 min-w-10 rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)] px-2 text-lg font-semibold text-[var(--tg-theme-text-color)]"
                aria-label="Открыть все иконки"
                title="Все иконки"
              >
                +
              </button>
            </div>
          </div>
          <div>
            <span className="mb-2 block text-xs font-semibold text-[var(--tg-theme-hint-color)]">Цвет</span>
            <div className="relative flex flex-wrap gap-2">
              {AREA_COLORS.map((item) => <button key={item} type="button" onClick={() => setColor(item)} className={`h-9 w-9 rounded-full border-2 ${color === item ? 'border-white' : 'border-transparent'}`} style={{ backgroundColor: item }} aria-label={`Цвет ${item}`} />)}
              <button
                type="button"
                onClick={() => setColorPickerOpen((open) => !open)}
                className={`h-9 w-9 rounded-full border-2 ${!AREA_COLORS.includes(color.toUpperCase()) ? 'border-white' : 'border-transparent'}`}
                style={{ background: 'conic-gradient(#ef4444, #f59e0b, #22c55e, #06b6d4, #3b82f6, #8b5cf6, #ec4899, #ef4444)' }}
                aria-label="Выбрать произвольный цвет"
                title="Свой цвет"
              />
              {colorPickerOpen && (
                <CustomColorPicker color={color} onChange={setColor} onClose={() => setColorPickerOpen(false)} />
              )}
            </div>
          </div>

          <EditorSection title="Ответственные" count={ownerUserIds.length}>
            <div className="space-y-2">
              {members.map((member) => (
                <CheckRow key={member.id} checked={ownerUserIds.includes(String(member.userId))} onChange={() => setOwnerUserIds(toggleId(ownerUserIds, member.userId))} title={memberUsername(member)} subtitle={memberFullName(member)} />
              ))}
            </div>
          </EditorSection>

          <EditorSection title="Страницы и материалы" count={linkedPageIds.length}>
            <div className="space-y-2">
              {pages.length ? pages.map((node) => <CheckRow key={node.id} checked={linkedPageIds.includes(node.id)} onChange={() => setLinkedPageIds(toggleId(linkedPageIds, node.id))} title={`${node.icon} ${node.title}`} />) : <EmptyList />}
            </div>
          </EditorSection>

          <EditorSection title="Kanban-доски" count={linkedKanbanBoardIds.length}>
            <div className="space-y-2">
              {boards.length ? boards.map((node) => <CheckRow key={node.id} checked={linkedKanbanBoardIds.includes(node.id)} onChange={() => setLinkedKanbanBoardIds(toggleId(linkedKanbanBoardIds, node.id))} title={`${node.icon} ${node.title}`} />) : <EmptyList />}
            </div>
          </EditorSection>

          <EditorSection title="Связанные задачи" count={linkedTaskIds.length}>
            <input value={taskQuery} onChange={(event) => setTaskQuery(event.target.value)} placeholder="Найти задачу" className="mb-2 w-full rounded-[8px] bg-[var(--tg-theme-bg-color)] px-3 py-2 text-sm text-[var(--tg-theme-text-color)] outline-none" />
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {visibleTasks.length ? visibleTasks.map((task) => <CheckRow key={task.id} checked={linkedTaskIds.includes(String(task.id))} onChange={() => setLinkedTaskIds(toggleId(linkedTaskIds, task.id))} title={task.title} subtitle={formatDeadline(task.deadlineAt)} />) : <EmptyList />}
            </div>
          </EditorSection>
        </div>

        <button
          type="button"
          onClick={() => onSave({ title: title.trim(), description: description.trim(), icon, color, ownerUserIds, linkedPageIds, linkedKanbanBoardIds, linkedTaskIds })}
          disabled={!title.trim() || saving}
          className="mt-5 w-full rounded-[8px] bg-[var(--tg-theme-button-color)] py-3 font-semibold text-[var(--tg-theme-button-text-color)] disabled:opacity-50"
        >
          {saving ? 'Сохраняю...' : 'Сохранить зону'}
        </button>
      </section>
      {iconPickerOpen && (
        <IconPickerModal
          title={title.trim() || 'Зона ответственности'}
          currentIcon={icon}
          onSelect={setIcon}
          onClose={() => setIconPickerOpen(false)}
        />
      )}
    </div>
  );
}

function CustomColorPicker({ color, onChange, onClose }: { color: string; onChange: (color: string) => void; onClose: () => void }) {
  const rgb = hexToRgb(color);
  const [hexDraft, setHexDraft] = useState(normalizeHex(color).toUpperCase());
  useEffect(() => setHexDraft(normalizeHex(color).toUpperCase()), [color]);
  const updateChannel = (channel: keyof typeof rgb, value: number) => {
    onChange(rgbToHex({ ...rgb, [channel]: Math.max(0, Math.min(255, value || 0)) }));
  };

  return (
    <div className="absolute left-0 top-11 z-20 w-[min(280px,calc(100vw-48px))] rounded-[8px] border border-[var(--tg-theme-section-separator-color)] bg-[var(--tg-theme-bg-color)] p-3 shadow-2xl">
      <div className="mb-3 flex items-center gap-2">
        <input
          type="color"
          value={normalizeHex(color)}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          className="h-10 w-12 cursor-pointer rounded-[6px] border-0 bg-transparent p-0"
          aria-label="Палитра цвета"
        />
        <input
          value={hexDraft}
          onChange={(event) => {
            const next = event.target.value.trim().toUpperCase();
            setHexDraft(next);
            if (/^#[0-9a-fA-F]{6}$/.test(next)) onChange(next.toUpperCase());
          }}
          onBlur={() => setHexDraft(normalizeHex(color).toUpperCase())}
          maxLength={7}
          className="min-w-0 flex-1 rounded-[6px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-2 font-mono text-sm text-[var(--tg-theme-text-color)] outline-none"
          aria-label="HEX-код цвета"
        />
        <button type="button" onClick={onClose} className="h-9 w-9 rounded-full bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-text-color)]" aria-label="Закрыть выбор цвета">×</button>
      </div>
      {(['r', 'g', 'b'] as const).map((channel) => (
        <label key={channel} className="mb-2 grid grid-cols-[18px_1fr_54px] items-center gap-2 last:mb-0">
          <span className="text-xs font-bold uppercase text-[var(--tg-theme-hint-color)]">{channel}</span>
          <input
            type="range"
            min="0"
            max="255"
            value={rgb[channel]}
            onChange={(event) => updateChannel(channel, Number(event.target.value))}
            className="w-full accent-[var(--tg-theme-button-color)]"
          />
          <input
            type="number"
            min="0"
            max="255"
            value={rgb[channel]}
            onChange={(event) => updateChannel(channel, Number(event.target.value))}
            className="w-full rounded-[6px] bg-[var(--tg-theme-secondary-bg-color)] px-2 py-1 text-center text-xs text-[var(--tg-theme-text-color)] outline-none"
            aria-label={`${channel.toUpperCase()} канал`}
          />
        </label>
      ))}
    </div>
  );
}

function normalizeHex(value: string) {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : AREA_COLORS[0];
}

function hexToRgb(value: string) {
  const hex = normalizeHex(value).slice(1);
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

function rgbToHex({ r, g, b }: { r: number; g: number; b: number }) {
  const channel = (value: number) => Math.round(value).toString(16).padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`.toUpperCase();
}

function EditorSection({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <details className="rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)] p-3">
      <summary className="cursor-pointer list-none text-sm font-semibold text-[var(--tg-theme-text-color)]">{title} <span className="text-[var(--tg-theme-hint-color)]">{count}</span></summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

function CheckRow({ checked, onChange, title, subtitle }: { checked: boolean; onChange: () => void; title: string; subtitle?: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-[8px] bg-[var(--tg-theme-bg-color)] px-3 py-2">
      <input type="checkbox" checked={checked} onChange={onChange} className="h-4 w-4 shrink-0 accent-[var(--tg-theme-button-color)]" />
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-[var(--tg-theme-text-color)]">{title}</span>
        {subtitle && <span className="block truncate text-xs text-[var(--tg-theme-hint-color)]">{subtitle}</span>}
      </span>
    </label>
  );
}

function EmptyList() {
  return <p className="text-sm text-[var(--tg-theme-hint-color)]">Подходящих элементов нет.</p>;
}

function buildAreaSummaries(areas: ResponsibilityArea[], members: ProjectMember[], tasks: Task[]): AreaSummary[] {
  const now = Date.now();
  return areas.map((area) => {
    const ownerIds = new Set((area.ownerUserIds ?? []).map(String));
    const linkedTaskIds = new Set((area.linkedTaskIds ?? []).map(String));
    const owners = members.filter((member) => ownerIds.has(String(member.userId)));
    const areaTasks = tasks
      .filter((task) => linkedTaskIds.has(String(task.id)) || (task.assigneeId !== undefined && ownerIds.has(String(task.assigneeId))))
      .sort((left, right) => deadlineValue(left.deadlineAt) - deadlineValue(right.deadlineAt));
    return {
      area,
      owners,
      tasks: areaTasks,
      overdueTasks: areaTasks.filter((task) => task.deadlineAt && new Date(task.deadlineAt).getTime() < now),
    };
  }).sort((left, right) => right.overdueTasks.length - left.overdueTasks.length || right.tasks.length - left.tasks.length || left.area.title.localeCompare(right.area.title, 'ru'));
}

function toggleId(values: string[], id: string | number) {
  const normalized = String(id);
  return values.includes(normalized) ? values.filter((value) => value !== normalized) : [...values, normalized];
}

function ownerList(owners: ProjectMember[]) {
  return owners.length ? owners.map(memberUsername).join(', ') : 'Ответственный не назначен';
}

function memberUsername(member: ProjectMember) {
  return member.user?.username ? `@${member.user.username.replace(/^@/, '')}` : memberFullName(member);
}

function memberFullName(member: ProjectMember) {
  return [member.user?.firstName, member.user?.lastName].filter(Boolean).join(' ') || `Участник ${member.userId}`;
}

function deadlineValue(value?: string) {
  if (!value) return Number.MAX_SAFE_INTEGER;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function formatDeadline(value?: string) {
  if (!value) return 'Без дедлайна';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Без дедлайна' : `До ${parsed.toLocaleDateString('ru-RU')}`;
}

function formatPlanDate(value: string) {
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : `Срок: ${parsed.toLocaleDateString('ru-RU')}`;
}
