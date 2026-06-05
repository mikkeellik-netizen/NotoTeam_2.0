import { useNavigate, useParams } from 'react-router-dom';
import { useProjectStore } from '../store/projectStore';

export default function MembersPage() {
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();
  const members = useProjectStore((state) => state.currentProject?.members ?? state.projects[0]?.members ?? []);

  return (
    <div className="flex flex-col h-full bg-[var(--tg-theme-bg-color)]">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--tg-theme-secondary-bg-color)]">
        <button onClick={() => navigate(`/project/${projectId}/workspace`)} className="w-8 h-8 text-[var(--tg-theme-link-color)]">
          ‹
        </button>
        <h1 className="text-lg font-bold text-[var(--tg-theme-text-color)]">Участники</h1>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {members.map((member) => (
          <div key={member.id} className="rounded-[10px] bg-[var(--tg-theme-secondary-bg-color)] p-3">
            <p className="font-medium text-[var(--tg-theme-text-color)]">
              {member.user?.firstName ?? member.user?.username ?? `ID ${member.userId}`}
            </p>
            <p className="text-xs text-[var(--tg-theme-hint-color)]">{member.role?.name ?? 'member'}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
