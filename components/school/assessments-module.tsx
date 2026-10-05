"use client";

import { useRef, useState } from "react";
import { ChevronDown, Pencil } from "lucide-react";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { addAssessment, removeAssessment, updateAssessment } from "@/app/(app)/school/assessment-actions";
import { useScheduleRefresh } from "@/components/deen/use-optimistic-item";
import { enqueueByKey } from "@/lib/client/keyed-queue";
import { PICKABLE_ASSESSMENT_TYPES, type AssessmentType } from "@/lib/school/assessment-types";
import {
  buildAssessmentsOverview,
  daysBetweenDates,
  daysUntilLabel,
  type AssessmentGroup,
  type AssessmentOverviewItem,
  type AssessmentsOverview,
} from "@/lib/school/assessments-overview";
import { EXAM_NAME_PLACEHOLDER } from "@/lib/tasks/task-type";
import { formatShortDate } from "@/lib/date-utils";
import { cn } from "@/lib/utils";

const TYPE_LABEL: Record<AssessmentType, string> = {
  quiz: "Quiz",
  exam: "Exam",
  final_midterm: "Exam",
  homework_assignment: "Homework/Assignment",
  project_paper: "Project/Paper",
};

const GROUP_LABEL: Record<AssessmentGroup, string> = { soon: "Soon", upcoming: "Upcoming", future: "Future" };
const GROUP_HINT: Record<AssessmentGroup, string> = { soon: "within 7 days", upcoming: "8–30 days", future: "31+ days" };
const GROUP_ORDER: AssessmentGroup[] = ["soon", "upcoming", "future"];

type ClassOption = { id: string; label: string };
type Draft = { name: string; type: AssessmentType; date: string };

const placeholderFor = (type: AssessmentType) => (type === "exam" ? EXAM_NAME_PLACEHOLDER : "Name");

/**
 * SCHOOL-02: the Assessments module (replaces Deadline risk). Every upcoming assessment across the user's classes,
 * grouped Soon / Upcoming / Future (+ "No date" for staged items still missing one), collapsed by default. The Edit
 * button opens an editor where each class's assessments can be added, edited and removed. Writes go through SCHOOL-01's
 * actions (one write path: the paired task follows) and are OPTIMISTIC: the list changes at once, a failed write rolls
 * the list back and says why. Removing asks first, because it also removes the assessment's task.
 */
export function AssessmentsModule({ overview, classes, todayStr }: { overview: AssessmentsOverview; classes: ClassOption[]; todayStr: string }) {
  const [items, setItems] = useState<AssessmentOverviewItem[]>(() => [...overview.soon, ...overview.upcoming, ...overview.future]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scheduleRefresh = useScheduleRefresh();
  const tmpCounter = useRef(0);

  // A server refresh (after the queued writes settle) re-seeds the list from the source of truth.
  const [seenOverview, setSeenOverview] = useState(overview);
  if (seenOverview !== overview) {
    setSeenOverview(overview);
    setItems([...overview.soon, ...overview.upcoming, ...overview.future]);
  }

  const grouped = buildAssessmentsOverview(
    items.map((i) => ({ id: i.id, classId: i.classId, className: i.className, name: i.name, type: i.type, date: i.date, weightPct: i.weightPct, taskId: i.taskId })),
    todayStr,
    overview.noDate
  );
  const classLabel = (id: string) => classes.find((c) => c.id === id)?.label ?? "";

  /** Apply `next` now; on a failed write put `previous` back and say why. */
  function optimistic(key: string, next: (prev: AssessmentOverviewItem[]) => AssessmentOverviewItem[], write: () => Promise<{ ok: true; assessmentId?: string; taskId?: string } | { ok: false; message: string }>, tmpId?: string) {
    setError(null);
    let previous: AssessmentOverviewItem[] = [];
    setItems((cur) => {
      previous = cur;
      return next(cur);
    });
    enqueueByKey(key, write)
      .then((res) => {
        if (!res.ok) throw new Error(res.message);
        if (tmpId && res.assessmentId) setItems((cur) => cur.map((i) => (i.id === tmpId ? { ...i, id: res.assessmentId!, taskId: res.taskId ?? null } : i)));
      })
      .catch((e: unknown) => {
        setItems(previous);
        setError(e instanceof Error ? e.message : "Couldn't save that. Try again.");
      })
      .finally(scheduleRefresh);
  }

  const withDays = (d: Draft) => ({ ...d, daysUntil: daysBetweenDates(todayStr, d.date) });

  function add(classId: string, d: Draft) {
    const tmpId = `tmp-${++tmpCounter.current}`;
    optimistic(
      `assessment:new:${tmpId}`,
      (cur) => [...cur, { id: tmpId, classId, className: classLabel(classId), ...withDays(d), weightPct: null, taskId: null }],
      () => addAssessment(classId, d),
      tmpId
    );
  }
  function update(id: string, d: Draft) {
    optimistic(`assessment:${id}`, (cur) => cur.map((i) => (i.id === id ? { ...i, ...withDays(d) } : i)), () => updateAssessment(id, d));
  }
  function remove(id: string) {
    optimistic(`assessment:${id}`, (cur) => cur.filter((i) => i.id !== id), () => removeAssessment(id));
  }

  return (
    <>
      <Panel
        title="Assessments"
        heroValue={`${grouped.total}`}
        caption={grouped.total === 0 ? "nothing upcoming" : `upcoming assessment${grouped.total === 1 ? "" : "s"}`}
        data-testid="assessments-module"
        controls={
          <div className="flex items-center gap-1">
            <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)} data-testid="assessments-edit">
              <Pencil className="size-3.5" aria-hidden />
              Edit
            </Button>
            <button
              type="button"
              aria-expanded={open}
              aria-label={open ? "Collapse assessments" : "Expand assessments"}
              onClick={() => setOpen((o) => !o)}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent/50"
              data-testid="assessments-toggle"
            >
              <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden />
            </button>
          </div>
        }
      >
        {open ? (
          grouped.total === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="assessments-empty">
              No upcoming assessments. Use Edit to add one.
            </p>
          ) : (
            <div className="flex flex-col gap-4" data-testid="assessments-groups">
              {GROUP_ORDER.map((g) =>
                grouped[g].length === 0 ? null : (
                  <section key={g} aria-label={GROUP_LABEL[g]} data-testid={`assessments-group-${g}`} className="flex flex-col gap-1">
                    <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                      {GROUP_LABEL[g]} <span className="font-mono font-normal tracking-normal normal-case">· {grouped[g].length} · {GROUP_HINT[g]}</span>
                    </h3>
                    <ul className="flex flex-col divide-y divide-border/40">
                      {grouped[g].map((a) => (
                        <li key={a.id} className="flex items-baseline justify-between gap-3 py-1.5" data-testid="assessment-row">
                          <div className="min-w-0">
                            <p className="truncate text-sm">{a.name}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {a.className} · {TYPE_LABEL[a.type]}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="font-mono text-xs tabular-nums">{formatShortDate(a.date)}</p>
                            <p className={cn("text-xs", a.daysUntil <= 1 ? "font-medium text-accent-warning" : "text-muted-foreground")}>{daysUntilLabel(a.daysUntil)}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                )
              )}
              {grouped.noDate.length > 0 ? (
                <section aria-label="No date" data-testid="assessments-group-nodate" className="flex flex-col gap-1">
                  <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    No date <span className="font-mono font-normal tracking-normal normal-case">· {grouped.noDate.length}</span>
                  </h3>
                  <ul className="flex flex-col divide-y divide-border/40">
                    {grouped.noDate.map((a) => (
                      <li key={a.id} className="py-1.5" data-testid="assessment-row-nodate">
                        <p className="truncate text-sm">{a.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {a.className} · {TYPE_LABEL[a.type]} · waiting on a date
                        </p>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          )
        ) : null}
      </Panel>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl" data-testid="assessments-editor">
          <DialogHeader>
            <DialogTitle>Assessments</DialogTitle>
            <DialogDescription>Add, change or remove assessments for each class. Each one also keeps its task in step.</DialogDescription>
          </DialogHeader>
          {error ? (
            <p role="alert" className="text-xs text-destructive" data-testid="assessments-error">
              {error}
            </p>
          ) : null}
          <div className="flex flex-col gap-5">
            {classes.length === 0 ? <p className="text-sm text-muted-foreground">Add a class first, then its assessments show up here.</p> : null}
            {classes.map((c) => (
              <ClassBlock key={c.id} cls={c} items={items.filter((i) => i.classId === c.id)} todayStr={todayStr} onAdd={add} onUpdate={update} onRemove={remove} />
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function TypeSelect({ value, onChange, label }: { value: AssessmentType; onChange: (t: AssessmentType) => void; label: string }) {
  const options: AssessmentType[] = (PICKABLE_ASSESSMENT_TYPES as readonly AssessmentType[]).includes(value) ? [...PICKABLE_ASSESSMENT_TYPES] : [value, ...PICKABLE_ASSESSMENT_TYPES];
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as AssessmentType)} aria-label={label} className="h-8 rounded-md border border-input bg-transparent px-2 text-xs">
      {options.map((t) => (
        <option key={t} value={t}>
          {TYPE_LABEL[t]}
        </option>
      ))}
    </select>
  );
}

function ClassBlock({
  cls,
  items,
  todayStr,
  onAdd,
  onUpdate,
  onRemove,
}: {
  cls: ClassOption;
  items: AssessmentOverviewItem[];
  todayStr: string;
  onAdd: (classId: string, d: Draft) => void;
  onUpdate: (id: string, d: Draft) => void;
  onRemove: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>({ name: "", type: "quiz", date: todayStr });
  const canAdd = draft.name.trim() !== "" && draft.date !== "";
  return (
    <section aria-label={cls.label} data-testid={`assessments-class-${cls.id}`} className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{cls.label}</h3>
      {items.length === 0 && !adding ? <p className="text-xs text-muted-foreground">No upcoming assessments.</p> : null}
      {items.map((a) => (
        <EditRow key={a.id} item={a} onUpdate={onUpdate} onRemove={onRemove} />
      ))}
      {adding ? (
        <div className="flex flex-col gap-1.5 rounded-lg border border-border/40 p-2" data-testid={`assessments-add-form-${cls.id}`}>
          <div className="flex flex-wrap items-center gap-2">
            <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={placeholderFor(draft.type)} aria-label={`New assessment name for ${cls.label}`} className="h-8 min-w-0 flex-1" autoFocus />
            <TypeSelect value={draft.type} onChange={(type) => setDraft({ ...draft, type })} label={`New assessment type for ${cls.label}`} />
            <Input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} aria-label={`New assessment date for ${cls.label}`} className="h-8 w-40 text-xs" />
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={!canAdd}
              data-testid={`assessments-add-save-${cls.id}`}
              onClick={() => {
                onAdd(cls.id, { ...draft, name: draft.name.trim() });
                setDraft({ name: "", type: "quiz", date: todayStr });
                setAdding(false);
              }}
            >
              Add
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" size="sm" variant="outline" className="self-start" onClick={() => setAdding(true)} data-testid={`assessments-add-${cls.id}`}>
          Add assessment
        </Button>
      )}
    </section>
  );
}

function EditRow({ item, onUpdate, onRemove }: { item: AssessmentOverviewItem; onUpdate: (id: string, d: Draft) => void; onRemove: (id: string) => void }) {
  const [draft, setDraft] = useState<Draft>({ name: item.name, type: item.type, date: item.date });
  const [confirming, setConfirming] = useState(false);
  const dirty = draft.name !== item.name || draft.type !== item.type || draft.date !== item.date;
  const valid = draft.name.trim() !== "" && draft.date !== "";
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border/40 p-2" data-testid={`assessment-edit-row-${item.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={placeholderFor(draft.type)} aria-label={`Name for ${item.name}`} className="h-8 min-w-0 flex-1" />
        <TypeSelect value={draft.type} onChange={(type) => setDraft({ ...draft, type })} label={`Type for ${item.name}`} />
        <Input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} aria-label={`Date for ${item.name}`} className="h-8 w-40 text-xs" />
      </div>
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2" role="alertdialog" aria-label={`Remove ${item.name}?`}>
          <p className="text-xs">Remove “{item.name}”? This also removes its task.</p>
          <Button type="button" size="sm" variant="destructive" onClick={() => onRemove(item.id)} data-testid={`assessment-remove-confirm-${item.id}`}>
            Remove
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>
            Keep
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button type="button" size="sm" disabled={!dirty || !valid} onClick={() => onUpdate(item.id, { ...draft, name: draft.name.trim() })} data-testid={`assessment-save-${item.id}`}>
            Save
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(true)} data-testid={`assessment-remove-${item.id}`}>
            Remove
          </Button>
        </div>
      )}
    </div>
  );
}
