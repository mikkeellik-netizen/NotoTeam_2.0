import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useProjectStore } from '../store/projectStore';
import BoardPage from '../pages/BoardPage';
import PageEditor from './PageEditor';
import PageTree from './PageTree';
import { usePageStore } from './pageStore';

export default function WorkspacePage() {
  const { projectId, pageId } = useParams<{ projectId: string; pageId?: string }>();
  const navigate = useNavigate();
  const pid = Number(projectId);
  const [treeOpen, setTreeOpen] = useState(false);

  const { currentProject, fetchProject } = useProjectStore();
  const { nodes, selectedPageId, loadProjectSpace, selectPage } = usePageStore();

  useEffect(() => {
    if (!pid) return;
    fetchProject(pid);
  }, [pid]);

  useEffect(() => {
    if (!projectId) return;
    loadProjectSpace(projectId, currentProject?.title);
  }, [projectId, currentProject?.title]);

  useEffect(() => {
    if (pageId) selectPage(pageId);
  }, [pageId]);

  const activePage = useMemo(
    () => nodes.find((node) => node.id === (pageId ?? selectedPageId)) ?? null,
    [nodes, pageId, selectedPageId],
  );

  const openPage = (nextPageId: string) => {
    selectPage(nextPageId);
    navigate(`/project/${projectId}/workspace/page/${nextPageId}`);
  };

  return (
    <div className="flex h-full bg-[var(--tg-theme-bg-color)] text-[var(--tg-theme-text-color)]">
      <div className="hidden sm:block w-[290px] border-r border-[var(--tg-theme-secondary-bg-color)]">
        <PageTree
          projectId={projectId!}
          selectedPageId={activePage?.id ?? null}
          onOpenPage={openPage}
        />
      </div>

      {treeOpen && (
        <div className="fixed inset-0 z-50 sm:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setTreeOpen(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-[86vw] max-w-[330px] shadow-2xl">
            <PageTree
              projectId={projectId!}
              selectedPageId={activePage?.id ?? null}
              onOpenPage={openPage}
              onCloseDrawer={() => setTreeOpen(false)}
            />
          </div>
        </div>
      )}

      <section className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--tg-theme-secondary-bg-color)]">
          <button
            onClick={() => setTreeOpen(true)}
            className="sm:hidden w-8 h-8 flex items-center justify-center text-[var(--tg-theme-link-color)]"
            aria-label="Открыть дерево страниц"
          >
            ☰
          </button>
          <button
            onClick={() => navigate('/')}
            className="w-8 h-8 flex items-center justify-center text-[var(--tg-theme-link-color)]"
            aria-label="К проектам"
          >
            ‹
          </button>
          <div className="min-w-0">
            <p className="text-xs text-[var(--tg-theme-hint-color)] truncate">
              {currentProject?.title ?? 'Проект'}
            </p>
            <h1 className="text-base font-semibold truncate">
              {activePage ? `${activePage.icon} ${activePage.title}` : 'Рабочее пространство'}
            </h1>
          </div>
        </div>

        <div className="flex-1 min-h-0">
          {!activePage ? (
            <div className="h-full flex items-center justify-center text-sm text-[var(--tg-theme-hint-color)]">
              Выбери страницу
            </div>
          ) : activePage.type === 'kanban' ? (
            <BoardPage />
          ) : activePage.type === 'folder' ? (
            <div className="h-full flex items-center justify-center text-sm text-[var(--tg-theme-hint-color)]">
              Это папка. Открой страницу внутри нее.
            </div>
          ) : (
            <PageEditor page={activePage} projectId={projectId!} onOpenPage={openPage} />
          )}
        </div>
      </section>
    </div>
  );
}
