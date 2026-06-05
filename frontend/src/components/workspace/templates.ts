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
      { type: 'paragraph', content: { text: 'Дежурства и Telegram-напоминания через бота.' } },
      {
        type: 'simple_table',
        content: {
          columns: [
            { title: 'Дата', type: 'date' },
            { title: 'Ответственный (@ник)', type: 'text' },
            { title: 'Напомнить 1', type: 'select', options: ['За 4 дня в 12:00', 'За 1 день в 12:00', 'Не напоминать'] },
            { title: 'Напомнить 2', type: 'select', options: ['За 1 день в 12:00', 'За 4 дня в 12:00', 'Не напоминать'] },
            { title: 'Комментарий', type: 'text' },
          ],
          rows: [
            ['', '@username', 'За 4 дня в 12:00', 'За 1 день в 12:00', ''],
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
      { type: 'paragraph', content: { text: 'Бот должен отправлять напоминания ответственному по Telegram username.' } },
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
    id: 'kanban',
    title: 'Kanban board',
    icon: '📋',
    blocks: [],
  },
];
