"use client";

import { useState } from "react";
import { Task, KanbanStatus, BotId, Bot } from "@/types/bot";

const BOT_ICONS: Record<string, string> = {
  "bot-leader": "🦕",
  "content-strategist": "🧠",
  "content-writer": "✍️",
  "hubspot-publisher": "🚀",
  "performance-analyst": "📊",
};

type ColumnDef = {
  id: KanbanStatus;
  label: string;
  borderColor: string;
  labelColor: string;
  badgeBg: string;
};

const COLUMNS: ColumnDef[] = [
  {
    id: "unassigned",
    label: "Unassigned",
    borderColor: "border-zinc-600",
    labelColor: "text-zinc-400",
    badgeBg: "bg-zinc-800",
  },
  {
    id: "assigned",
    label: "Assigned",
    borderColor: "border-blue-500",
    labelColor: "text-blue-400",
    badgeBg: "bg-blue-950",
  },
  {
    id: "in-progress",
    label: "In Progress",
    borderColor: "border-amber-500",
    labelColor: "text-amber-400",
    badgeBg: "bg-amber-950",
  },
  {
    id: "needs-review",
    label: "Needs Review",
    borderColor: "border-violet-500",
    labelColor: "text-violet-400",
    badgeBg: "bg-violet-950",
  },
  {
    id: "done",
    label: "Done",
    borderColor: "border-emerald-500",
    labelColor: "text-emerald-400",
    badgeBg: "bg-emerald-950",
  },
];

interface KanbanBoardProps {
  tasks: Task[];
  bots: Bot[];
  onAddTask: (task: Omit<Task, "id" | "createdAt">) => void;
  onUpdateTask: (id: string, patch: Partial<Task>) => void;
}

export default function KanbanBoard({
  tasks,
  bots,
  onAddTask,
  onUpdateTask,
}: KanbanBoardProps) {
  const [visibleCols, setVisibleCols] = useState<Set<KanbanStatus>>(
    new Set(COLUMNS.map((c) => c.id)),
  );
  const [showForm, setShowForm] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newAssignee, setNewAssignee] = useState<BotId | "">("");

  function toggleCol(id: KanbanStatus) {
    setVisibleCols((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleCreate() {
    if (!newTitle.trim()) return;
    onAddTask({
      title: newTitle.trim(),
      description: newDesc.trim() || undefined,
      status: newAssignee ? "assigned" : "unassigned",
      assignedTo: (newAssignee as BotId) || undefined,
    });
    setNewTitle("");
    setNewDesc("");
    setNewAssignee("");
    setShowForm(false);
  }

  const workerBots = bots.filter((b) => b.id !== "bot-leader");
  const shownColumns = COLUMNS.filter((c) => visibleCols.has(c.id));

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ── Top bar ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 mb-4 flex-wrap shrink-0">
        <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mr-1">
          Show:
        </span>
        {COLUMNS.map((col) => {
          const on = visibleCols.has(col.id);
          return (
            <button
              key={col.id}
              onClick={() => toggleCol(col.id)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors border ${
                on
                  ? `${col.borderColor} bg-zinc-800 ${col.labelColor}`
                  : "border-zinc-800 bg-zinc-900 text-zinc-600"
              }`}
            >
              {col.label}
            </button>
          );
        })}

        <button
          onClick={() => setShowForm((v) => !v)}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white transition-colors"
        >
          <span className="text-base leading-none">＋</span> Add Task
        </button>
      </div>

      {/* ── Add-task form ────────────────────────────────────────── */}
      {showForm && (
        <div className="mb-4 rounded-xl border border-zinc-700 bg-zinc-900 p-4 shrink-0">
          <p className="text-xs font-semibold text-white mb-3">New Task</p>
          <div className="flex flex-col gap-2">
            <input
              className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500 transition-colors"
              placeholder="Task title…"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              autoFocus
            />
            <input
              className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500 transition-colors"
              placeholder="Description (optional)…"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
            />
            <select
              className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-300 focus:outline-none focus:border-indigo-500 transition-colors"
              value={newAssignee}
              onChange={(e) => setNewAssignee(e.target.value as BotId | "")}
            >
              <option value="">— No assignee —</option>
              {workerBots.map((b) => (
                <option key={b.id} value={b.id}>
                  {BOT_ICONS[b.id]} {b.name}
                </option>
              ))}
            </select>
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleCreate}
                disabled={!newTitle.trim()}
                className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-medium text-white transition-colors"
              >
                Create
              </button>
              <button
                onClick={() => {
                  setShowForm(false);
                  setNewTitle("");
                  setNewDesc("");
                  setNewAssignee("");
                }}
                className="px-4 py-1.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-xs font-medium text-zinc-300 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Columns ──────────────────────────────────────────────── */}
      <div className="flex gap-4 overflow-x-auto flex-1 min-h-0 pb-2">
        {shownColumns.map((col) => {
          const colTasks = tasks.filter((t) => t.status === col.id);
          return (
            <div
              key={col.id}
              className="flex flex-col flex-shrink-0 w-60 min-h-0"
            >
              {/* Column header */}
              <div
                className={`flex items-center gap-2 mb-3 pb-2 border-b-2 ${col.borderColor} shrink-0`}
              >
                <span
                  className={`text-[11px] font-bold uppercase tracking-wider ${col.labelColor}`}
                >
                  {col.label}
                </span>
                <span
                  className={`ml-auto text-[10px] font-semibold rounded-full ${col.badgeBg} px-2 py-0.5 ${col.labelColor}`}
                >
                  {colTasks.length}
                </span>
              </div>

              {/* Task cards */}
              <div className="flex flex-col gap-3 overflow-y-auto flex-1 pr-0.5">
                {colTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    bots={workerBots}
                    onUpdate={onUpdateTask}
                  />
                ))}
                {colTasks.length === 0 && (
                  <p className="text-[11px] text-zinc-700 text-center mt-8 select-none">
                    No tasks
                  </p>
                )}
              </div>
            </div>
          );
        })}

        {shownColumns.length === 0 && (
          <p className="text-sm text-zinc-600 m-auto">
            All columns hidden — toggle some back on above.
          </p>
        )}
      </div>
    </div>
  );
}

// ── TaskCard ───────────────────────────────────────────────────────────────

interface TaskCardProps {
  task: Task;
  bots: Bot[];
  onUpdate: (id: string, patch: Partial<Task>) => void;
}

function TaskCard({ task, bots, onUpdate }: TaskCardProps) {
  const assignedBot = bots.find((b) => b.id === task.assignedTo);

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-3 flex flex-col gap-2 hover:border-zinc-500 transition-colors group">
      <p className="text-sm font-medium text-white leading-snug">{task.title}</p>

      {task.description && (
        <p className="text-[11px] text-zinc-400 leading-relaxed">
          {task.description}
        </p>
      )}

      {assignedBot && (
        <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
          <span aria-hidden="true">{BOT_ICONS[assignedBot.id]}</span>
          <span>{assignedBot.name}</span>
        </div>
      )}

      {/* Controls */}
      <div className="flex gap-1.5 pt-1.5 border-t border-zinc-800">
        {/* Move status */}
        <select
          className="flex-1 rounded-md bg-zinc-800 border border-zinc-700 text-[11px] text-zinc-300 px-2 py-1 focus:outline-none focus:border-indigo-500 transition-colors cursor-pointer"
          value={task.status}
          onChange={(e) =>
            onUpdate(task.id, { status: e.target.value as KanbanStatus })
          }
        >
          {COLUMNS.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>

        {/* Assign bot */}
        <select
          className="flex-1 rounded-md bg-zinc-800 border border-zinc-700 text-[11px] text-zinc-300 px-2 py-1 focus:outline-none focus:border-indigo-500 transition-colors cursor-pointer"
          value={task.assignedTo ?? ""}
          onChange={(e) => {
            const val = e.target.value as BotId | "";
            onUpdate(task.id, {
              assignedTo: val || undefined,
              status:
                val && task.status === "unassigned" ? "assigned" : task.status,
            });
          }}
        >
          <option value="">Unassigned</option>
          {bots.map((b) => (
            <option key={b.id} value={b.id}>
              {BOT_ICONS[b.id]} {b.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
