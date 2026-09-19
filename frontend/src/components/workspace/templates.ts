import type { Template } from '../../types';

export const PAGE_TEMPLATES: Template[] = [
  {
    id: 'meeting',
    title: 'Встреча',
    icon: '🗓',
    blocks: [
      { type: 'heading_1', content: { text: 'Встреча' } },
      { type: 'paragraph', content: { text: 'Дата, участники, контекст.' } },
      { type: 'heading_2', content: { text: 'Повестка' } },
      { type: 'bulleted_list', content: { text: 'Главный вопрос' } },
      { type: 'heading_2', content: { text: 'Решения' } },
      { type: 'todo', content: { text: 'Зафиксировать next steps', checked: false } },
    ],
  },
  {
    id: 'project',
    title: 'Проект',
    icon: '🚀',
    blocks: [
      { type: 'heading_1', content: { text: 'Проект' } },
      { type: 'smart_summary', content: {} },
      { type: 'heading_2', content: { text: 'Цель' } },
      { type: 'paragraph', content: { text: '' } },
      { type: 'heading_2', content: { text: 'Задачи' } },
      { type: 'todo', content: { text: '', checked: false } },
    ],
  },
  {
    id: 'camp',
    title: 'Лагерь',
    icon: '⛺',
    blocks: [
      { type: 'heading_1', content: { text: 'Лагерь' } },
      { type: 'paragraph', content: { text: 'Тема, даты, место, команда.' } },
      { type: 'heading_2', content: { text: 'Программа' } },
      { type: 'simple_table', content: { rows: [['День', 'Событие'], ['', '']] } },
      { type: 'heading_2', content: { text: 'Команда' } },
      { type: 'bulleted_list', content: { text: '@' } },
    ],
  },
  {
    id: 'sermon',
    title: 'Выступление',
    icon: '📖',
    blocks: [
      { type: 'paragraph', content: { text: 'Тема / Основание / Главная мысль' } },
      { type: 'heading_2', content: { text: 'Структура' } },
      { type: 'numbered_list', content: { text: 'Вступление' } },
      { type: 'numbered_list', content: { text: 'Главная часть' } },
      { type: 'numbered_list', content: { text: 'Применение/Призыв' } },
    ],
  },
  {
    id: 'weekly',
    title: 'Weekly planning',
    icon: '📆',
    blocks: [
      { type: 'heading_1', content: { text: 'План недели' } },
      { type: 'todo', content: { text: 'Главный результат недели', checked: false } },
      { type: 'heading_2', content: { text: 'Фокусы' } },
      { type: 'bulleted_list', content: { text: '' } },
    ],
  },
  {
    id: 'brainstorm',
    title: 'Brainstorm',
    icon: '💡',
    blocks: [
      { type: 'heading_1', content: { text: 'Brainstorm' } },
      { type: 'paragraph', content: { text: 'Пиши идеи быстро, без фильтра.' } },
      { type: 'bulleted_list', content: { text: '' } },
    ],
  },
  {
    id: 'duty-schedule',
    title: 'График дежурств',
    icon: '📅',
    blocks: [
      {
        type: 'simple_table',
        content: {
          tableKind: 'duty_schedule',
          columns: [
            { title: 'Дата дежурства', type: 'date', width: 140 },
            { title: 'Ответственный', type: 'person', width: 180 },
            { title: 'Напомнить 1', type: 'select', options: ['За 4 дня в 12:00', 'За 1 день в 12:00', 'Не напоминать'] },
            { title: 'Напомнить 2', type: 'select', options: ['За 1 день в 12:00', 'За 4 дня в 12:00', 'Не напоминать'] },
            { title: 'Комментарий', type: 'text', width: 220 },
          ],
          rows: [
            ['', '', 'За 4 дня в 12:00', 'За 1 день в 12:00', ''],
            ['', '', 'За 4 дня в 12:00', 'За 1 день в 12:00', ''],
          ],
          reminderConfig: {
            channel: 'telegram_bot',
            defaults: [
              { offsetDays: 4, time: '12:00' },
              { offsetDays: 1, time: '12:00' },
            ],
          },
        },
      },
    ],
  },
  {
    id: 'attendance',
    title: 'Список посещаемости',
    icon: '✅',
    blocks: [
      {
        type: 'simple_table',
        content: {
          tableKind: 'attendance',
          stickyFirstColumn: true,
          columns: [
            { title: 'ФИО', type: 'text' },
            { title: 'Дата', type: 'checkbox' },
            { title: 'Дата', type: 'checkbox' },
            { title: 'Дата', type: 'checkbox' },
          ],
          rows: [
            ['Иванов Иван', '', '', ''],
            ['Петров Петр', '', '', ''],
            ['Сидорова Анна', '', '', ''],
          ],
          importConfig: {
            source: 'excel_csv',
            firstColumn: 'fullName',
          },
        },
      },
    ],
  },
  {
    id: 'finance',
    title: 'Финансы',
    icon: '💰',
    description: 'Доходы, расходы, баланс и сводка по проектам.',
    blocks: [
      {
        type: 'simple_table',
        content: {
          tableKind: 'finance',
          stickyHeader: true,
          columns: [
            {
              key: 'month',
              title: 'Дата',
              type: 'date',
              width: 130,
            },
            {
              key: 'type',
              title: 'Тип',
              type: 'select',
              width: 130,
              options: ['Доход', 'Расход'],
              optionColors: {
                'Доход': '#22C55E',
                'Расход': '#EF4444',
              },
            },
            {
              key: 'project',
              title: 'Проект',
              type: 'select',
              width: 160,
              options: ['Общий', 'Молодежь', 'Медиа', 'Служение', 'Мероприятия', 'Другое'],
              optionColors: {
                'Общий': '#3B82F6',
                'Молодежь': '#22C55E',
                'Медиа': '#8B5CF6',
                'Служение': '#F59E0B',
                'Мероприятия': '#EC4899',
                'Другое': '#64748B',
              },
            },
            { key: 'subcategory', title: 'Подкатегория', type: 'text', width: 170 },
            { key: 'amount', title: 'Сумма, ₽', type: 'money', width: 130 },
            { key: 'comment', title: 'Комментарий', type: 'text', width: 220 },
          ],
          rows: [
            ['', '', '', '', '', ''],
            ['', '', '', '', '', ''],
            ['', '', '', '', '', ''],
          ],
        },
      },
    ],
  },
  {
    id: 'task-planning-system',
    title: 'Планирование задач',
    icon: '🧭',
    description: 'Квартал, месяц, неделя, день, срочность и анализ результата.',
    blocks: [
      { type: 'heading_1', content: { text: 'Общая таблица задач' } },
      {
        type: 'simple_table',
        content: {
          tableKind: 'task_planning',
          columns: [
            { key: 'title', title: 'Задача', type: 'text', width: 240 },
            { key: 'project', title: 'Проект', type: 'text', width: 160 },
            { key: 'assigneeId', title: 'Исполнитель', type: 'person', width: 160 },
            { key: 'deadline', title: 'Дедлайн', type: 'date', width: 130 },
            {
              key: 'isImportant',
              title: 'Важность',
              type: 'select',
              width: 120,
              options: ['Да', 'Нет'],
              optionColors: {
                'Да': '#EF4444',
                'Нет': '#64748B',
              },
            },
            {
              key: 'isUrgent',
              title: 'Срочность',
              type: 'select',
              width: 120,
              options: ['Да', 'Нет'],
              optionColors: {
                'Да': '#F59E0B',
                'Нет': '#64748B',
              },
            },
            {
              key: 'quadrant',
              title: 'Квадрант',
              type: 'select',
              width: 180,
              options: ['Важно и срочно', 'Важно, не срочно', 'Не важно, срочно', 'Не важно, не срочно'],
              optionColors: {
                'Важно и срочно': '#EF4444',
                'Важно, не срочно': '#3B82F6',
                'Не важно, срочно': '#F59E0B',
                'Не важно, не срочно': '#64748B',
              },
            },
            { key: 'description', title: 'Описание', type: 'text', width: 240 },
            {
              key: 'status',
              title: 'Статус',
              type: 'select',
              width: 130,
              options: ['Новая', 'В работе', 'Готово', 'Архив'],
              optionColors: {
                'Новая': '#3B82F6',
                'В работе': '#F59E0B',
                'Готово': '#22C55E',
                'Архив': '#64748B',
              },
            },
            { key: 'priority', title: 'Приоритет', type: 'priority', width: 130 },
            { key: 'tags', title: 'Теги', type: 'tags', width: 160 },
            { key: 'subtasks', title: 'Подзадачи', type: 'text', width: 220 },
            { key: 'reminder', title: 'Напоминание', type: 'text', width: 160 },
            { key: 'linkedPage', title: 'Связанная страница', type: 'text', width: 200 },
            {
              key: 'recurrence',
              title: 'Повтор',
              type: 'select',
              width: 150,
              options: ['Нет', 'Ежедневно', 'Еженедельно', 'Ежемесячно'],
              optionColors: {
                'Нет': '#64748B',
                'Ежедневно': '#22C55E',
                'Еженедельно': '#3B82F6',
                'Ежемесячно': '#8B5CF6',
              },
            },
            { key: 'adminComment', title: 'Комментарий администратора', type: 'text', width: 240 },
            { key: 'completedAt', title: 'Выполнено', type: 'date', width: 130 },
            { key: 'archivedAt', title: 'В архиве', type: 'date', width: 130 },
          ],
          rows: [
            ['Подготовить список входящих задач', 'Командный проект', '', '', 'Да', 'Да', 'Важно и срочно', 'Разобрать и назначить ответственного.', 'Новая', 'Высокий', 'планирование', '', 'За 15 часов', '', 'Нет', '', '', ''],
          ],
          stickyHeader: true,
        },
      },
      { type: 'heading_2', content: { text: 'План квартала' } },
      {
        type: 'simple_table',
        content: {
          columns: [
            { title: 'Ключевой результат', type: 'text', width: 240 },
            {
              title: 'Месяц',
              type: 'select',
              width: 120,
              options: ['1 месяц', '2 месяц', '3 месяц'],
              optionColors: {
                '1 месяц': '#3B82F6',
                '2 месяц': '#8B5CF6',
                '3 месяц': '#22C55E',
              },
            },
            { title: 'Метрика успеха', type: 'text', width: 200 },
            { title: 'Ответственный', type: 'person', width: 160 },
            { title: 'Статус', type: 'status', width: 130 },
          ],
          rows: [
            ['', '1 месяц', '', '', 'Не начато'],
            ['', '2 месяц', '', '', 'Не начато'],
            ['', '3 месяц', '', '', 'Не начато'],
          ],
          stickyHeader: true,
        },
      },
      { type: 'heading_2', content: { text: 'План месяца' } },
      {
        type: 'simple_table',
        content: {
          columns: [
            {
              title: 'Направление',
              type: 'select',
              width: 150,
              options: ['Проект', 'Команда', 'Личное', 'Регулярное'],
              optionColors: {
                'Проект': '#3B82F6',
                'Команда': '#22C55E',
                'Личное': '#8B5CF6',
                'Регулярное': '#F59E0B',
              },
            },
            { title: 'Задача', type: 'text', width: 240 },
            {
              title: 'Неделя',
              type: 'select',
              width: 110,
              options: ['1 неделя', '2 неделя', '3 неделя', '4 неделя'],
              optionColors: {
                '1 неделя': '#3B82F6',
                '2 неделя': '#8B5CF6',
                '3 неделя': '#22C55E',
                '4 неделя': '#F59E0B',
              },
            },
            { title: 'Дедлайн', type: 'date', width: 130 },
            { title: 'Приоритет', type: 'priority', width: 130 },
            { title: 'Статус', type: 'status', width: 130 },
          ],
          rows: [
            ['Проект', '', '1 неделя', '', 'Высокий', 'Не начато'],
            ['Команда', '', '2 неделя', '', 'Средний', 'Не начато'],
            ['Регулярное', '', '3 неделя', '', 'Низкий', 'Не начато'],
          ],
          stickyHeader: true,
        },
      },
      { type: 'heading_2', content: { text: 'План недели' } },
      {
        type: 'simple_table',
        content: {
          columns: [
            { title: 'Фокус недели', type: 'text', width: 220 },
            { title: 'Задача', type: 'text', width: 240 },
            {
              title: 'День',
              type: 'select',
              width: 100,
              options: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'],
              optionColors: {
                'Пн': '#3B82F6',
                'Вт': '#3B82F6',
                'Ср': '#8B5CF6',
                'Чт': '#8B5CF6',
                'Пт': '#22C55E',
                'Сб': '#F59E0B',
                'Вс': '#F59E0B',
              },
            },
            {
              title: 'Срочность',
              type: 'select',
              width: 130,
              options: ['Срочно', 'Не срочно'],
              optionColors: {
                'Срочно': '#EF4444',
                'Не срочно': '#3B82F6',
              },
            },
            { title: 'Дедлайн', type: 'date', width: 130 },
            { title: 'Готово', type: 'checkbox', width: 90 },
          ],
          rows: [
            ['', '', 'Пн', 'Срочно', '', ''],
            ['', '', 'Ср', 'Не срочно', '', ''],
            ['', '', 'Пт', 'Не срочно', '', ''],
          ],
          stickyHeader: true,
        },
      },
      { type: 'heading_2', content: { text: 'План дня' } },
      {
        type: 'simple_table',
        content: {
          columns: [
            {
              title: 'Время',
              type: 'select',
              width: 120,
              options: ['Утро', 'День', 'Вечер'],
              optionColors: {
                'Утро': '#F59E0B',
                'День': '#3B82F6',
                'Вечер': '#8B5CF6',
              },
            },
            { title: 'Задача', type: 'text', width: 260 },
            {
              title: 'Тип',
              type: 'select',
              width: 130,
              options: ['Главное', 'Срочное', 'Рутинное'],
              optionColors: {
                'Главное': '#22C55E',
                'Срочное': '#EF4444',
                'Рутинное': '#64748B',
              },
            },
            { title: 'Готово', type: 'checkbox', width: 90 },
            { title: 'Итог дня', type: 'text', width: 220 },
          ],
          rows: [
            ['Утро', '', 'Главное', '', ''],
            ['День', '', 'Срочное', '', ''],
            ['Вечер', '', 'Рутинное', '', ''],
          ],
          stickyHeader: true,
        },
      },
      { type: 'heading_2', content: { text: 'Анализ выполненного' } },
      {
        type: 'simple_table',
        content: {
          columns: [
            { title: 'Дата', type: 'date', width: 130 },
            { title: 'Выполнено', type: 'text', width: 240 },
            { title: 'Результат', type: 'text', width: 220 },
            { title: 'Что помешало', type: 'text', width: 220 },
            { title: 'Вывод / следующий шаг', type: 'text', width: 260 },
          ],
          rows: [
            ['', '', '', '', ''],
            ['', '', '', '', ''],
            ['', '', '', '', ''],
          ],
          stickyHeader: true,
        },
      },
    ],
  },
  {
    id: 'responsibility-areas',
    title: 'Зоны ответственности',
    icon: '🧩',
    description: 'Зоны, ответственные, рабочие задачи и связанные материалы.',
    blocks: [
      {
        type: 'responsibility_map',
        content: { view: 'cards' },
      },
    ],
  },
  {
    id: 'kanban',
    title: 'Kanban board',
    icon: '📋',
    blocks: [],
  },
];
