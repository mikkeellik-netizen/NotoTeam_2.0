import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { tasksApi } from '../api/tasks';
import type { UserTaskProgress } from '../api/tasks';
import { useTaskStore } from '../store/taskStore';
import { useAuthStore } from '../store/authStore';
import TaskModal from '../components/task/TaskModal';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { PRIORITY_LABEL, PRIORITY_COLOR } from '../types';
import type { Task } from '../types';

interface MyTasksData {
  red: Task[];
  yellow: Task[];
  green: Task[];
  noDate: Task[];
  stats: UserTaskProgress;
}

const EMPTY_PROGRESS: UserTaskProgress = {
  days: 7,
  since: '',
  until: '',
  completed: 0,
  total: 0,
  percent: 0,
  created: 0,
  active: 0,
  overdue: 0,
};

export default function MyTasksPage() {
  const navigate = useNavigate();
  const { openTask, closeTask, selectedTask } = useTaskStore();
  const currentUser = useAuthStore((state) => state.user);
  const [data, setData] = useState<MyTasksData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser?.id) {
      setData({ red: [], yellow: [], green: [], noDate: [], stats: EMPTY_PROGRESS });
      setLoading(false);
      return;
    }
    setLoading(true);
    tasksApi.getMyTasks(currentUser.id).then(setData).finally(() => setLoading(false));
  }, [currentUser?.id]);

  const allTasks = data
    ? [...data.red, ...data.yellow, ...data.green, ...data.noDate]
    : [];

  const percent = data?.stats.percent ?? 0;

  return (
    <div className="flex flex-col h-full bg-[var(--tg-theme-bg-color)]">
      {/* Шапка */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--tg-theme-secondary-bg-color)]">
        <button onClick={() => navigate('/')} className="w-8 h-8 flex items-center justify-center text-[var(--tg-theme-link-color)]">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-lg font-bold text-[var(--tg-theme-text-color)]">Мои задачи</h1>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-6 h-6 border-2 border-[var(--tg-theme-button-color)] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : !data ? (
          <div className="text-center py-16">
            <div className="text-4xl mb-3">🎉</div>
            <p className="text-[var(--tg-theme-hint-color)]">Нет активных задач</p>
          </div>
        ) : (
          <div className="px-4 py-4 space-y-4">
            {/* Прогресс */}
            <div className="bg-[var(--tg-theme-secondary-bg-color)] rounded-[12px] p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-[var(--tg-theme-text-color)]">
                  Результат за последние 7 дней
                </span>
                <span className="text-sm text-[var(--tg-theme-hint-color)]">
                  {data.stats.completed}/{data.stats.total}
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-[var(--tg-theme-bg-color)] overflow-hidden mb-1">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${percent}%`,
                    backgroundColor: percent === 100 ? '#22C55E' : 'var(--tg-theme-button-color)',
                  }}
                />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <ProgressMetric label="Выполнено" value={data.stats.completed} />
                <ProgressMetric label="Новые" value={data.stats.created} />
                <ProgressMetric label="Активные" value={data.stats.active} />
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-[var(--tg-theme-hint-color)]">
                <span className={data.stats.overdue > 0 ? 'text-red-500' : ''}>
                  Просрочено: {data.stats.overdue}
                </span>
                <span>{percent}% выполнено</span>
              </div>
            </div>

            {allTasks.length === 0 && (
              <div className="py-8 text-center text-sm text-[var(--tg-theme-hint-color)]">
                Нет активных задач
              </div>
            )}

            {/* Красная зона */}
            {data.red.length > 0 && (
              <TaskSection
                title="🔴 Срочно"
                tasks={data.red}
                color="#EF4444"
                onTaskClick={openTask}
              />
            )}

            {/* Жёлтая зона */}
            {data.yellow.length > 0 && (
              <TaskSection
                title="🟡 Скоро"
                tasks={data.yellow}
                color="#F59E0B"
                onTaskClick={openTask}
              />
            )}

            {/* Зелёная зона */}
            {data.green.length > 0 && (
              <TaskSection
                title="🟢 Впереди"
                tasks={data.green}
                color="#22C55E"
                onTaskClick={openTask}
              />
            )}

            {/* Без даты */}
            {data.noDate.length > 0 && (
              <TaskSection
                title="📋 Без дедлайна"
                tasks={data.noDate}
                color="var(--tg-theme-hint-color)"
                onTaskClick={openTask}
              />
            )}
          </div>
        )}
      </div>

      {/* Модалка задачи */}
      {selectedTask && (
        <TaskModal task={selectedTask} members={[]} onClose={closeTask} />
      )}
    </div>
  );
}

function ProgressMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 rounded-[8px] bg-[var(--tg-theme-bg-color)] px-2 py-2">
      <div className="text-base font-semibold text-[var(--tg-theme-text-color)]">{value}</div>
      <div className="truncate text-[11px] text-[var(--tg-theme-hint-color)]">{label}</div>
    </div>
  );
}

function TaskSection({
  title, tasks, color, onTaskClick,
}: {
  title: string;
  tasks: Task[];
  color: string;
  onTaskClick: (id: number) => void;
}) {
  return (
    <div>
      <h3 className="text-xs font-semibold mb-2" style={{ color }}>
        {title} ({tasks.length})
      </h3>
      <div className="space-y-2">
        {tasks.map((task) => (
          <div
            key={task.id}
            onClick={() => onTaskClick(task.id)}
            className="bg-[var(--tg-theme-secondary-bg-color)] rounded-[10px] p-3 cursor-pointer active:scale-[0.98] transition-transform"
          >
            <div className="flex items-start gap-2">
              <span
                className="w-2 h-2 rounded-full mt-1.5 shrink-0"
                style={{ backgroundColor: PRIORITY_COLOR[task.priority] }}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--tg-theme-text-color)] truncate">
                  {task.title}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  {task.project?.title && (
                    <span className="max-w-[55%] truncate rounded-[6px] bg-[var(--tg-theme-bg-color)] px-2 py-0.5 text-xs font-medium text-[var(--tg-theme-link-color)]">
                      {task.project.icon ? `${task.project.icon} ` : ''}{task.project.title}
                    </span>
                  )}
                  {task.deadlineAt && (
                    <span className="text-xs text-[var(--tg-theme-hint-color)]">
                      {format(new Date(task.deadlineAt), 'd MMM HH:mm', { locale: ru })}
                    </span>
                  )}
                  <span className="text-xs ml-auto" style={{ color: PRIORITY_COLOR[task.priority] }}>
                    {PRIORITY_LABEL[task.priority]}
                  </span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
