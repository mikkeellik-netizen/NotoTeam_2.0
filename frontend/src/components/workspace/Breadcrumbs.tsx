import type { PageNode } from '../../types';

interface Props {
  activePage: PageNode | null;
  nodes: PageNode[];
  onOpenPage: (pageId: string) => void;
}

export default function Breadcrumbs({ activePage, nodes, onOpenPage }: Props) {
  if (!activePage) return null;

  const chain: PageNode[] = [];
  let current: PageNode | undefined = activePage;
  while (current) {
    chain.unshift(current);
    current = current.parentId ? nodes.find((node) => node.id === current?.parentId) : undefined;
  }

  return (
    <nav className="flex items-center gap-1 overflow-x-auto text-xs text-[var(--tg-theme-hint-color)]">
      {chain.map((node, index) => (
        <span key={node.id} className="flex items-center gap-1 shrink-0">
          {index > 0 && <span>/</span>}
          <button
            onClick={() => onOpenPage(node.id)}
            className="max-w-[140px] truncate text-[var(--tg-theme-link-color)]"
          >
            {node.title}
          </button>
        </span>
      ))}
    </nav>
  );
}
