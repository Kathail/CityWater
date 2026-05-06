import { useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useDroppable,
  useDraggable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { Link } from "react-router-dom";
import { transitionWorkOrder, type WoStatus, type WorkOrderListItem } from "./api";

const ACTIVE_COLUMNS: { id: WoStatus; label: string }[] = [
  { id: "draft", label: "Draft" },
  { id: "open", label: "Open" },
  { id: "assigned", label: "Assigned" },
  { id: "in_progress", label: "In progress" },
  { id: "on_hold", label: "On hold" },
];

interface Props {
  items: WorkOrderListItem[];
  slug: string;
}

export function KanbanBoard({ items, slug }: Props) {
  const queryClient = useQueryClient();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const grouped = useMemo(() => {
    const m: Record<string, WorkOrderListItem[]> = {};
    for (const c of ACTIVE_COLUMNS) m[c.id] = [];
    for (const wo of items) {
      if (m[wo.status]) m[wo.status].push(wo);
    }
    return m;
  }, [items]);

  const transition = useMutation({
    mutationFn: ({ wo_number, to }: { wo_number: string; to: WoStatus }) =>
      transitionWorkOrder(wo_number, to),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["work-orders"] });
    },
  });

  function onDragEnd(event: DragEndEvent) {
    const wo_number = String(event.active.id);
    const to = event.over?.id as WoStatus | undefined;
    if (!to) return;
    const current = items.find((i) => i.wo_number === wo_number);
    if (!current || current.status === to) return;
    transition.mutate({ wo_number, to });
  }

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {ACTIVE_COLUMNS.map((col) => (
          <Column
            key={col.id}
            id={col.id}
            label={col.label}
            items={grouped[col.id] ?? []}
            slug={slug}
          />
        ))}
      </div>
    </DndContext>
  );
}

function Column({
  id,
  label,
  items,
  slug,
}: {
  id: WoStatus;
  label: string;
  items: WorkOrderListItem[];
  slug: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <section
      ref={setNodeRef}
      aria-labelledby={`col-${id}-heading`}
      className={`flex flex-col w-72 shrink-0 rounded-lg border ${
        isOver ? "border-slate-900 bg-slate-100" : "border-slate-200 bg-white"
      }`}
    >
      <header className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
        <h3 id={`col-${id}-heading`} className="text-sm font-medium text-slate-700">
          {label}
        </h3>
        <span className="text-xs text-slate-500">{items.length}</span>
      </header>
      <ul className="flex-1 p-2 space-y-2 min-h-32">
        {items.map((wo) => (
          <Card key={wo.wo_number} wo={wo} slug={slug} />
        ))}
        {items.length === 0 && <li className="text-xs text-slate-400 text-center py-4">Empty</li>}
      </ul>
    </section>
  );
}

function Card({ wo, slug }: { wo: WorkOrderListItem; slug: string }) {
  const { setNodeRef, listeners, attributes, transform, isDragging } = useDraggable({
    id: wo.wo_number,
  });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;
  return (
    <li
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`rounded border bg-white px-2 py-1.5 text-sm cursor-grab active:cursor-grabbing ${
        isDragging ? "opacity-50 shadow-md" : "border-slate-200 hover:border-slate-300"
      }`}
    >
      <Link
        to={`/${slug}/work-orders/${wo.wo_number}`}
        className="font-mono text-xs text-slate-500 hover:underline block"
        onClick={(e) => e.stopPropagation()}
      >
        {wo.wo_number}
      </Link>
      <p className="mt-0.5 text-slate-800 line-clamp-2">{wo.title}</p>
      <p className="mt-1 text-xs text-slate-500">
        {wo.priority} · {wo.category}
      </p>
    </li>
  );
}
