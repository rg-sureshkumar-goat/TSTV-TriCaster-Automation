// The rundown grid: blocks and sections, edited live by everyone in the episode. Drag the handle to
// reorder; each section's menu floats, moves, inserts or deletes it. Every edit records who made it.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import * as Y from 'yjs';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  addElement,
  deleteRow,
  ELEMENT_TYPES,
  formatClock,
  formatDuration,
  insertBlock,
  insertSection,
  moveElement,
  moveRow,
  parseDuration,
  removeElement,
  updateElement,
  updateRow,
  type ComputedRow,
  type Element,
  type ElementType,
  type Person,
  type RundownTiming,
  type SectionRow,
  type ShowSettings,
} from '@tstv/shared';
import type { Presence } from './useEpisodeDoc.ts';
import { timeAgo } from '../lib/format.ts';
import { Popover } from '../components/Popover.tsx';

interface GridProps {
  doc: Y.Doc;
  timing: RundownTiming;
  settings: ShowSettings;
  airTime: string;
  me: Person;
  readOnly: boolean;
  others: Presence[];
  setFocus: (focus: string | null) => void;
}

export function RundownGrid({ doc, timing, settings, airTime, me, readOnly, others, setFocus }: GridProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const ids = timing.rows.map((c) => c.row.id);

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    moveRow(doc, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
  };

  const focusedBy = (rowId: string, field: string) => others.filter((o) => o.focus === `${rowId}:${field}`);
  const backTime = (offset: number | null) => (offset === null ? '' : airTime ? formatClock(airTime, offset) : `+${formatDuration(offset)}`);

  return (
    <div className="grid-wrap">
      <table className="rundown">
        <thead>
          <tr>
            <th className="handle-col" aria-label="Drag to reorder" />
            <th className="num-col">#</th>
            <th>Slug</th>
            <th className="type-col">Type</th>
            <th title="Who writes this section's script">Writer</th>
            <th title="Who reads it on air">Talent</th>
            <th className="camera-col">Camera</th>
            <th title="Graphics and clips that play during this section, in order (L3, OTS, FSG, VO, SOT, PKG)">Graphics</th>
            <th className="time-col" title="Estimated length">Est.</th>
            <th className="time-col" title={airTime ? 'Clock time this must start to end on time' : 'How far into the show this must start to end on time'}>
              Back-time
            </th>
            <th>Last edit</th>
            <th className="menu-col" aria-label="Actions" />
          </tr>
        </thead>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <tbody>
              {timing.rows.map((c, index) =>
                c.row.kind === 'block' ? (
                  <BlockLine key={c.row.id} computed={c} doc={doc} me={me} readOnly={readOnly} blockSeconds={timing.blockSeconds[c.blockLetter] ?? 0} backTime={backTime(c.backTimeOffset)} sectionsAfter={sectionsUntilNextBlock(timing.rows, index)} />
                ) : (
                  <SectionLine
                    key={c.row.id}
                    computed={c as ComputedRow & { row: SectionRow }}
                    index={index}
                    count={timing.rows.length}
                    doc={doc}
                    me={me}
                    settings={settings}
                    readOnly={readOnly}
                    backTime={backTime(c.backTimeOffset)}
                    focusedBy={focusedBy}
                    setFocus={setFocus}
                  />
                ),
              )}
            </tbody>
          </SortableContext>
        </DndContext>
      </table>
      {!readOnly && (
        <div className="grid-actions">
          <button onClick={() => insertSection(doc, me)}>+ Section</button>
          <button onClick={() => insertBlock(doc, me)}>+ Block</button>
        </div>
      )}
    </div>
  );
}

/** How many rows below a block belong to it (for "add a section to this block"). */
function sectionsUntilNextBlock(rows: ComputedRow[], blockIndex: number): number {
  let n = 0;
  for (let i = blockIndex + 1; i < rows.length && rows[i].row.kind === 'section'; i++) n++;
  return n;
}

function SortableRow({ id, className, disabled, children }: { id: string; className: string; disabled: boolean; children: (handle: ReactNode) => ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  const style: CSSProperties = { transform: CSS.Translate.toString(transform), transition, position: 'relative', zIndex: isDragging ? 2 : undefined };
  const handle = disabled ? null : (
    <button className="drag-handle" aria-label="Drag to reorder" {...attributes} {...listeners}>
      ⋮⋮
    </button>
  );
  return (
    <tr ref={setNodeRef} style={style} className={`${className}${isDragging ? ' dragging' : ''}`}>
      {children(handle)}
    </tr>
  );
}

function BlockLine({ computed, doc, me, readOnly, blockSeconds, backTime, sectionsAfter }: { computed: ComputedRow; doc: Y.Doc; me: Person; readOnly: boolean; blockSeconds: number; backTime: string; sectionsAfter: number }) {
  const row = computed.row;
  if (row.kind !== 'block') return null;
  const ids = () => {
    const all = doc.getArray<Y.Map<unknown>>('rows').toArray().map((m) => m.get('id'));
    return all.indexOf(row.id);
  };
  return (
    <SortableRow id={row.id} className="block-row" disabled={readOnly}>
      {(handle) => (
        <>
          <td className="handle-col">{handle}</td>
          <td className="num-col">
            <strong>{computed.label}</strong>
          </td>
          <td colSpan={6}>
            <div className="block-title">
              <strong>Block {computed.label}</strong>
              <TextCell value={row.title} placeholder="Block title (optional)" readOnly={readOnly} onCommit={(title) => updateRow(doc, row.id, { title }, me)} ariaLabel={`Block ${computed.label} title`} />
            </div>
          </td>
          <td className="time-col">{formatDuration(blockSeconds)}</td>
          <td className="time-col">{backTime}</td>
          <td />
          <td className="menu-col">
            {!readOnly && (
              <RowMenu
                label={`Block ${computed.label}`}
                items={[
                  { label: 'Add a section to this block', run: () => insertSection(doc, me, {}, ids() + sectionsAfter + 1) },
                  {
                    label: 'Delete block header',
                    danger: true,
                    run: () => confirm(`Delete the Block ${computed.label} header? Its sections stay and join the block above.`) && deleteRow(doc, row.id),
                  },
                ]}
              />
            )}
          </td>
        </>
      )}
    </SortableRow>
  );
}

interface SectionLineProps {
  computed: ComputedRow & { row: SectionRow };
  index: number;
  count: number;
  doc: Y.Doc;
  me: Person;
  settings: ShowSettings;
  readOnly: boolean;
  backTime: string;
  focusedBy: (rowId: string, field: string) => Presence[];
  setFocus: (focus: string | null) => void;
}

function SectionLine({ computed, index, count, doc, me, settings, readOnly, backTime, focusedBy, setFocus }: SectionLineProps) {
  const row = computed.row;
  const set = (patch: Partial<SectionRow>) => updateRow(doc, row.id, patch, me);
  // A typed talent name that matches the show's talent list gets that person's color.
  const talentColor = settings.talent.find((t) => t.name.toLowerCase() === row.talent.trim().toLowerCase())?.color;
  const cell = (field: string, children: ReactNode, className = '') => {
    const people = focusedBy(row.id, field);
    return (
      <td className={className} style={people[0] ? { boxShadow: `inset 0 0 0 2px ${people[0].color}` } : undefined} onFocus={() => setFocus(`${row.id}:${field}`)} onBlur={() => setFocus(null)}>
        {people[0] && (
          <span className="presence-tag" style={{ background: people[0].color }}>
            {people[0].name}
          </span>
        )}
        {children}
      </td>
    );
  };

  return (
    <SortableRow id={row.id} className={`section-row${row.floated ? ' floated' : ''}`} disabled={readOnly}>
      {(handle) => (
        <>
          <td className="handle-col">{handle}</td>
          <td className="num-col">
            {computed.label}
            {row.floated && <span className="badge">Floated</span>}
          </td>
          {cell('slug', <TextCell value={row.slug} placeholder="Slug" readOnly={readOnly} onCommit={(slug) => set({ slug })} ariaLabel={`${computed.label} slug`} />, 'slug-col')}
          {cell('type', <SelectCell value={row.type} options={settings.segmentTypes} readOnly={readOnly} onChange={(type) => set({ type })} ariaLabel={`${computed.label} type`} />, 'type-col')}
          {cell('writer', <TextCell value={row.writer} placeholder="Writer" readOnly={readOnly} onCommit={(writer) => set({ writer })} ariaLabel={`${computed.label} writer`} />, 'person-col')}
          {cell(
            'talent',
            <span className="talent-cell">
              {talentColor && <span className="dot" style={{ background: talentColor }} />}
              <TextCell value={row.talent} placeholder="Talent" readOnly={readOnly} onCommit={(talent) => set({ talent })} ariaLabel={`${computed.label} talent`} />
            </span>,
            'person-col',
          )}
          {cell('camera', <SelectCell value={row.camera} options={settings.cameras} emptyLabel={`Default (${settings.defaultCamera})`} readOnly={readOnly} onChange={(camera) => set({ camera })} ariaLabel={`${computed.label} camera`} />, 'camera-col')}
          {cell('elements', <ElementsCell section={row} label={computed.label} doc={doc} me={me} readOnly={readOnly} />, 'elements-col')}
          {cell('est', <DurationCell value={row.estSeconds} readOnly={readOnly} onCommit={(estSeconds) => set({ estSeconds })} ariaLabel={`${computed.label} estimated length`} />, 'time-col')}
          <td className="time-col">{backTime}</td>
          <td className="edited-col" title={row.createdBy ? `Added by ${row.createdBy.name}` : undefined}>
            {row.updatedBy && (
              <>
                {row.updatedBy.name}
                <br />
                <span className="muted small">{timeAgo(row.updatedAt)}</span>
              </>
            )}
          </td>
          <td className="menu-col">
            {!readOnly && (
              <RowMenu
                label={computed.label}
                items={[
                  { label: row.floated ? 'Unfloat (put back on air)' : 'Float (keep, but skip on air)', run: () => set({ floated: !row.floated }) },
                  { label: 'Insert a section below', run: () => insertSection(doc, me, {}, index + 1) },
                  { label: 'Move up', disabled: index === 0, run: () => moveRow(doc, index, index - 1) },
                  { label: 'Move down', disabled: index === count - 1, run: () => moveRow(doc, index, index + 1) },
                  { label: 'Delete section', danger: true, run: () => confirm(`Delete ${computed.label}${row.slug ? ` (${row.slug})` : ''}?`) && deleteRow(doc, row.id) },
                ]}
              />
            )}
          </td>
        </>
      )}
    </SortableRow>
  );
}

/** A text field that sends each keystroke to everyone, without jumping while you type. */
function TextCell({ value, placeholder, readOnly, onCommit, ariaLabel }: { value: string; placeholder: string; readOnly: boolean; onCommit: (value: string) => void; ariaLabel: string }) {
  const [draft, setDraft] = useState(value);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setDraft(value);
  }, [value]);
  return (
    <input
      className="cell-input"
      value={draft}
      placeholder={placeholder}
      aria-label={ariaLabel}
      disabled={readOnly}
      maxLength={200}
      onFocus={() => (editing.current = true)}
      onBlur={() => {
        editing.current = false;
        setDraft(value);
      }}
      onChange={(e) => {
        setDraft(e.target.value);
        onCommit(e.target.value);
      }}
    />
  );
}

function SelectCell({ value, options, emptyLabel = '—', readOnly, onChange, ariaLabel }: { value: string; options: string[]; emptyLabel?: string; readOnly: boolean; onChange: (value: string) => void; ariaLabel: string }) {
  const all = value && !options.includes(value) ? [...options, value] : options;
  return (
    <select className="cell-input" value={value} disabled={readOnly} aria-label={ariaLabel} onChange={(e) => onChange(e.target.value)}>
      <option value="">{emptyLabel}</option>
      {all.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

/** A length typed as m:ss. Saved when you leave the cell or press Enter. */
function DurationCell({ value, readOnly, onCommit, ariaLabel }: { value: number | null; readOnly: boolean; onCommit: (value: number | null) => void; ariaLabel: string }) {
  const shown = value === null ? '' : formatDuration(value);
  const [draft, setDraft] = useState(shown);
  const [invalid, setInvalid] = useState(false);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setDraft(shown);
  }, [shown]);
  const commit = () => {
    const parsed = parseDuration(draft);
    if (parsed === undefined) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (parsed !== value) onCommit(parsed);
  };
  return (
    <input
      className={`cell-input time${invalid ? ' invalid' : ''}`}
      value={draft}
      placeholder="0:00"
      aria-label={ariaLabel}
      title={invalid ? 'Type a length like 1:30' : undefined}
      disabled={readOnly}
      onFocus={() => (editing.current = true)}
      onBlur={() => {
        editing.current = false;
        commit();
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      onChange={(e) => setDraft(e.target.value)}
    />
  );
}

interface MenuItem {
  label: string;
  run: () => unknown;
  danger?: boolean;
  disabled?: boolean;
}

function RowMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  return (
    <div className="row-menu">
      <button aria-label={`Actions for ${label}`} aria-expanded={Boolean(anchor)} onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}>
        ⋯
      </button>
      {anchor && (
        <Popover anchor={anchor} align="right" onClose={() => setAnchor(null)}>
          <div className="menu" role="menu">
            {items.map((item) => (
              <button
                key={item.label}
                role="menuitem"
                className={item.danger ? 'danger' : ''}
                disabled={item.disabled}
                onClick={() => {
                  setAnchor(null);
                  item.run();
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </Popover>
      )}
    </div>
  );
}

// ---- Graphics (the section's elements: graphics and clips, shown in the Graphics column) ----

const ELEMENT_HELP: Record<ElementType, string> = {
  L3: 'lower third',
  OTSL: 'over the shoulder, left',
  OTSR: 'over the shoulder, right',
  FSG: 'full-screen graphic',
  VO: 'video the anchor reads over',
  SOT: 'sound bite with its own audio',
  PKG: 'package',
};

const isClip = (type: ElementType) => type === 'VO' || type === 'SOT' || type === 'PKG';

/** The section's elements as chips, in the order they're expected to fire, plus a + to add one. */
function ElementsCell({ section, label, doc, me, readOnly }: { section: SectionRow; label: string; doc: Y.Doc; me: Person; readOnly: boolean }) {
  const [open, setOpen] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const close = () => setOpen(null);
  const toggle = (id: string, anchor: HTMLElement) => setOpen(open?.id === id ? null : { id, anchor });
  const editing = section.elements.find((e) => e.id === open?.id);

  return (
    <div className="elements">
      {section.elements.map((e, i) => (
        <button
          key={e.id}
          className={`element-chip ${isClip(e.type) ? 'clip' : 'graphic'}`}
          disabled={readOnly}
          title={`${e.type}: ${ELEMENT_HELP[e.type]}`}
          aria-label={`${label} graphic ${i + 1}: ${e.type}${e.name ? ` ${e.name}` : ''}`}
          onClick={(ev) => toggle(e.id, ev.currentTarget)}
        >
          <strong>{e.type}</strong>
          {e.name && <span>{e.name}</span>}
        </button>
      ))}
      {!readOnly && (
        <button className="element-add" aria-label={`Add a graphic to ${label}`} title="Add a graphic" onClick={(ev) => toggle('add', ev.currentTarget)}>
          +
        </button>
      )}
      {open?.id === 'add' && (
        <Popover anchor={open.anchor} onClose={close}>
          <div className="menu" role="menu" aria-label={`Add a graphic to ${label}`}>
            {ELEMENT_TYPES.map((type) => (
              <button
                key={type}
                role="menuitem"
                onClick={() => {
                  addElement(doc, section.id, type, me);
                  close();
                }}
              >
                <strong>{type}</strong> <span className="muted small">{ELEMENT_HELP[type]}</span>
              </button>
            ))}
          </div>
        </Popover>
      )}
      {editing && open && (
        <Popover anchor={open.anchor} onClose={close}>
          <ElementEditor element={editing} index={section.elements.indexOf(editing)} count={section.elements.length} sectionId={section.id} label={label} doc={doc} me={me} onDone={close} />
        </Popover>
      )}
    </div>
  );
}

function ElementEditor({ element, index, count, sectionId, label, doc, me, onDone }: { element: Element; index: number; count: number; sectionId: string; label: string; doc: Y.Doc; me: Person; onDone: () => void }) {
  const [name, setName] = useState(element.name);
  const saveName = () => name.trim() !== element.name && updateElement(doc, sectionId, element.id, { name: name.trim() }, me);
  return (
    <div className="element-editor" role="dialog" aria-label={`${label} ${element.type} graphic`}>
      <label>
        Type
        <select value={element.type} onChange={(e) => updateElement(doc, sectionId, element.id, { type: e.target.value as ElementType }, me)}>
          {ELEMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}: {ELEMENT_HELP[t]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Name (optional)
        <input
          value={name}
          maxLength={80}
          placeholder="e.g. Highlights"
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              saveName();
              onDone();
            }
          }}
        />
      </label>
      <div className="buttons">
        <button disabled={index === 0} onClick={() => moveElement(doc, sectionId, element.id, index - 1, me)}>
          ← Earlier
        </button>
        <button disabled={index === count - 1} onClick={() => moveElement(doc, sectionId, element.id, index + 1, me)}>
          Later →
        </button>
        <button
          className="danger"
          onClick={() => {
            removeElement(doc, sectionId, element.id, me);
            onDone();
          }}
        >
          Remove
        </button>
        <button
          className="primary"
          onClick={() => {
            saveName();
            onDone();
          }}
        >
          Done
        </button>
      </div>
    </div>
  );
}
