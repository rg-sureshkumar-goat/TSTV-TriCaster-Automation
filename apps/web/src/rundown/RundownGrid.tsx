// The rundown grid: blocks and sections, edited live by everyone in the episode. Drag the handle to
// reorder; each section's ⋯ menu, beside its number, floats, moves, inserts or deletes it. Every edit records who made it.
import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import * as Y from 'yjs';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  addElement,
  elementKind,
  breakGraphic,
  colorForTalent,
  CROSS_TALK,
  deleteRow,
  ELEMENT_TYPES,
  formatClock,
  formatDuration,
  insertBlock,
  insertSection,
  isCrossTalk,
  moveElement,
  moveRow,
  parseDuration,
  removeElement,
  setCommercialBreak,
  toggleTalent,
  updateElement,
  updateRow,
  type CommercialBreak,
  type ComputedRow,
  type Element,
  type ElementType,
  type EpisodeTalent,
  type Person,
  type RundownTiming,
  type SectionRow,
  type ShowSettings,
  type Talent,
} from '@tstv/shared';
import type { Presence } from './useEpisodeDoc.ts';
import { timeAgo } from '../lib/format.ts';
import { Popover } from '../components/Popover.tsx';
import { Link } from '../lib/router.tsx';
import { ELEMENT_HELP, GraphicMenu } from './GraphicMenu.tsx';

interface GridProps {
  episodeId: string;
  doc: Y.Doc;
  timing: RundownTiming;
  settings: ShowSettings;
  /** This episode's anchors and correspondents, the choices in the Talent column. */
  talent: EpisodeTalent[];
  /** Graphics that have a cue chip in a script. */
  cued: Set<string>;
  airTime: string;
  me: Person;
  readOnly: boolean;
  /** Admins can add and remove commercial breaks and change their lengths. */
  isAdmin: boolean;
  others: Presence[];
  setFocus: (focus: string | null) => void;
}

export function RundownGrid({ episodeId, doc, timing, settings, talent, cued, airTime, me, readOnly, isAdmin, others, setFocus }: GridProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const ids = timing.rows.map((c) => c.row.id);

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    moveRow(doc, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
  };

  const focusedBy = (rowId: string, field: string) => others.filter((o) => o.focus === `${rowId}:${field}`);
  const backTime = (offset: number | null) => (offset === null ? '' : airTime ? formatClock(airTime, offset) : `+${formatDuration(offset)}`);
  const canEditBreaks = isAdmin && !readOnly;
  // Admins can add a commercial break above any row but the first. Above a block, that brings back the
  // automatic one.
  const breakItems = (c: ComputedRow, index: number): MenuItem[] =>
    canEditBreaks && index > 0 && !c.breakBefore
      ? [{ label: 'Add a commercial break above', run: () => setCommercialBreak(doc, c.row.id, c.row.kind === 'block' ? null : { seconds: null }, me) }]
      : [];
  const breakLine = (c: ComputedRow) =>
    c.breakBefore && (
      <BreakLine
        computed={c}
        commercialBreak={c.breakBefore}
        graphic={breakGraphic(settings)}
        showSeconds={settings.breakSeconds}
        backTime={backTime(c.breakBefore.backTimeOffset)}
        editable={canEditBreaks}
        doc={doc}
        me={me}
      />
    );

  return (
    <div className="grid-wrap">
      <table className="rundown">
        <thead>
          <tr>
            <th className="handle-col" aria-label="Drag to reorder" />
            <th className="num-col">#</th>
            <th>Slug</th>
            <th className="type-col" title="What kind of story this section is">Story Type</th>
            <th title="Who writes this section's script">Writer</th>
            <th title="Who reads it on air">Talent</th>
            <th className="camera-col">Camera</th>
            <th className="headline-col" title="The on-screen headline for this section">Headline</th>
            <th title="Graphics and clips that play during this section, in order (graphics in blue, video in red, music in purple, the show's permanent graphics in green)">Graphics</th>
            <th className="notes-col">Notes</th>
            <th className="person-col" title="Who makes this section's graphics">Assign Graphics</th>
            <th className="time-col" title="Estimated length">Est.</th>
            <th className="time-col" title={airTime ? 'Clock time this must start to end on time' : 'How far into the show this must start to end on time'}>
              Back-time
            </th>
            <th>Last edit</th>
          </tr>
        </thead>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <tbody>
              {timing.rows.map((c, index) =>
                c.row.kind === 'block' ? (
                  <Fragment key={c.row.id}>
                    {breakLine(c)}
                    <BlockLine computed={c} doc={doc} me={me} readOnly={readOnly} blockSeconds={timing.blockSeconds[c.blockLetter] ?? 0} backTime={backTime(c.backTimeOffset)} sectionsAfter={sectionsUntilNextBlock(timing.rows, index)} extraItems={breakItems(c, index)} />
                  </Fragment>
                ) : (
                  <Fragment key={c.row.id}>
                    {breakLine(c)}
                    <SectionLine
                      episodeId={episodeId}
                      computed={c as ComputedRow & { row: SectionRow }}
                      index={index}
                      count={timing.rows.length}
                      doc={doc}
                      me={me}
                      settings={settings}
                      talent={talent}
                      cued={cued}
                      readOnly={readOnly}
                      backTime={backTime(c.backTimeOffset)}
                      focusedBy={focusedBy}
                      setFocus={setFocus}
                      extraItems={breakItems(c, index)}
                    />
                  </Fragment>
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

/**
 * A commercial break: added automatically before every block except the first, or by an admin. It goes
 * wherever the row below it goes. Admins remove it with the × beside its name, and change its length
 * right in its line (RG, Oct 29, 2026).
 */
function BreakLine({ computed, commercialBreak, graphic, showSeconds, backTime, editable, doc, me }: { computed: ComputedRow; commercialBreak: CommercialBreak; graphic: string | undefined; showSeconds: number; backTime: string; editable: boolean; doc: Y.Doc; me: Person }) {
  const where = computed.row.kind === 'block' ? `Block ${computed.label}` : computed.label;
  const setLength = (seconds: number | null) =>
    setCommercialBreak(doc, computed.row.id, seconds === null && commercialBreak.automatic ? null : { seconds }, me);
  const remove = () => setCommercialBreak(doc, computed.row.id, commercialBreak.automatic ? { off: true } : null, me);
  return (
    <tr className="break-row">
      <td className="handle-col" />
      <td className="num-col" />
      <td colSpan={9}>
        <div className="break-title">
          {editable && (
            <button className="break-remove" aria-label={`Remove the commercial break before ${where}`} title="Remove this commercial break" onClick={remove}>
              ×
            </button>
          )}
          <strong>Commercial break</strong>
          {graphic && <span className="element-chip permanent">★ {graphic}</span>}
          <span className="muted small">{commercialBreak.automatic ? 'Added automatically between blocks.' : 'Added by an admin.'}</span>
          <span className="break-length small">
            {commercialBreak.customLength ? 'This break’s length:' : 'The show’s break length:'}{' '}
            {editable ? (
              <DurationCell
                value={commercialBreak.customLength ? commercialBreak.seconds : null}
                autoSeconds={showSeconds}
                readOnly={false}
                onCommit={setLength}
                ariaLabel={`Commercial break before ${where} length`}
                hints={{ auto: 'The show’s break length. Type a length for just this break.', typed: 'Typed in for this break. Clear it to go back to the show’s break length.' }}
              />
            ) : (
              <strong>{formatDuration(commercialBreak.seconds)}</strong>
            )}
          </span>
        </div>
      </td>
      <td className="time-col">{commercialBreak.seconds > 0 ? formatDuration(commercialBreak.seconds) : ''}</td>
      <td className="time-col">{commercialBreak.seconds > 0 ? backTime : ''}</td>
      <td />
    </tr>
  );
}

function BlockLine({ computed, doc, me, readOnly, blockSeconds, backTime, sectionsAfter, extraItems }: { computed: ComputedRow; doc: Y.Doc; me: Person; readOnly: boolean; blockSeconds: number; backTime: string; sectionsAfter: number; extraItems: MenuItem[] }) {
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
            <div className="num-with-menu">
              <strong>{computed.label}</strong>
              {!readOnly && (
                <RowMenu
                  label={`Block ${computed.label}`}
                  items={[
                    { label: 'Add a section to this block', run: () => insertSection(doc, me, {}, ids() + sectionsAfter + 1) },
                    ...extraItems,
                    {
                      label: 'Delete block header',
                      danger: true,
                      run: () => confirm(`Delete the Block ${computed.label} header? Its sections stay and join the block above.`) && deleteRow(doc, row.id),
                    },
                  ]}
                />
              )}
            </div>
          </td>
          <td colSpan={9}>
            <div className="block-title">
              <strong>Block {computed.label}</strong>
              <TextCell value={row.title} placeholder="Block title (optional)" readOnly={readOnly} onCommit={(title) => updateRow(doc, row.id, { title }, me)} ariaLabel={`Block ${computed.label} title`} />
            </div>
          </td>
          <td className="time-col">{formatDuration(blockSeconds)}</td>
          <td className="time-col">{backTime}</td>
          <td />
        </>
      )}
    </SortableRow>
  );
}

interface SectionLineProps {
  episodeId: string;
  computed: ComputedRow & { row: SectionRow };
  index: number;
  count: number;
  doc: Y.Doc;
  me: Person;
  settings: ShowSettings;
  talent: EpisodeTalent[];
  cued: Set<string>;
  readOnly: boolean;
  backTime: string;
  focusedBy: (rowId: string, field: string) => Presence[];
  setFocus: (focus: string | null) => void;
  /** More menu choices, like adding a commercial break above. */
  extraItems: MenuItem[];
}

function SectionLine({ episodeId, computed, index, count, doc, me, settings, talent, cued, readOnly, backTime, focusedBy, setFocus, extraItems }: SectionLineProps) {
  const row = computed.row;
  const set = (patch: Partial<SectionRow>) => updateRow(doc, row.id, patch, me);
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
            <div className="num-with-menu">
              {computed.label}
              {!readOnly && (
                <RowMenu
                  label={computed.label}
                  items={[
                    { label: row.floated ? 'Unfloat (put back on air)' : 'Float (keep, but skip on air)', run: () => set({ floated: !row.floated }) },
                    { label: 'Insert a section below', run: () => insertSection(doc, me, {}, index + 1) },
                    { label: 'Move up', disabled: index === 0, run: () => moveRow(doc, index, index - 1) },
                    { label: 'Move down', disabled: index === count - 1, run: () => moveRow(doc, index, index + 1) },
                    ...extraItems,
                    { label: 'Delete section', danger: true, run: () => confirm(`Delete ${computed.label}${row.slug ? ` (${row.slug})` : ''}?`) && deleteRow(doc, row.id) },
                  ]}
                />
              )}
            </div>
            {row.floated && <span className="badge">Floated</span>}
          </td>
          {cell('slug', <SlugCell row={row} label={computed.label} episodeId={episodeId} readOnly={readOnly} onCommit={(slug) => set({ slug })} />, 'slug-col')}
          {cell('type', <SelectCell value={row.type} options={settings.segmentTypes} readOnly={readOnly} onChange={(type) => set({ type })} ariaLabel={`${computed.label} story type`} />, 'type-col')}
          {cell('writer', <TextCell value={row.writer} placeholder="Writer" readOnly={readOnly} onCommit={(writer) => set({ writer })} ariaLabel={`${computed.label} writer`} />, 'person-col')}
          {cell('talent', <TalentPicker value={row.talent} talent={talent} colors={settings.talent} label={computed.label} readOnly={readOnly} onChange={(names) => set({ talent: names })} />, 'person-col')}
          {cell('camera', <SelectCell value={row.camera} options={settings.cameras} emptyLabel={`Default (${settings.defaultCamera})`} readOnly={readOnly} onChange={(camera) => set({ camera })} ariaLabel={`${computed.label} camera`} />, 'camera-col')}
          {cell('headline', <TextCell value={row.headline} placeholder="Headline" readOnly={readOnly} onCommit={(headline) => set({ headline })} ariaLabel={`${computed.label} headline`} />, 'headline-col')}
          {cell('elements', <ElementsCell section={row} label={computed.label} permanent={settings.permanentGraphics} cued={cued} doc={doc} me={me} readOnly={readOnly} />, 'elements-col')}
          {cell('notes', <TextCell value={row.notes} placeholder="Notes" readOnly={readOnly} onCommit={(notes) => set({ notes })} ariaLabel={`${computed.label} notes`} />, 'notes-col')}
          {cell('assignGraphics', <TextCell value={row.assignGraphics} placeholder="Who makes them" readOnly={readOnly} onCommit={(assignGraphics) => set({ assignGraphics })} ariaLabel={`${computed.label} assign graphics`} />, 'person-col')}
          {cell('est', <DurationCell value={row.estSeconds} autoSeconds={computed.seconds} readOnly={readOnly} onCommit={(estSeconds) => set({ estSeconds })} ariaLabel={`${computed.label} estimated length`} />, 'time-col')}
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
        </>
      )}
    </SortableRow>
  );
}

/** A text field that sends each keystroke to everyone, without jumping while you type. */
/**
 * The slug opens the section's script, in a window over the rundown. An empty slug, or one being renamed
 * (✎), is a text box, so building the rundown stays quick.
 */
function SlugCell({ row, label, episodeId, readOnly, onCommit }: { row: SectionRow; label: string; episodeId: string; readOnly: boolean; onCommit: (slug: string) => void }) {
  const [editing, setEditing] = useState(false);
  if (!readOnly && (editing || !row.slug)) {
    return (
      <TextCell
        value={row.slug}
        placeholder="Slug"
        readOnly={readOnly}
        onCommit={onCommit}
        ariaLabel={`${label} slug`}
        autoFocus={editing}
        onEditingChange={setEditing}
      />
    );
  }
  return (
    <span className="slug-link">
      <Link to={`/episodes/${episodeId}/sections/${row.id}`} keepScroll aria-label={`Open the script for ${label} ${row.slug}`}>
        {row.slug || 'Untitled'}
      </Link>
      {!readOnly && (
        <button className="rename" aria-label={`Rename ${label}`} title="Rename" onClick={() => setEditing(true)}>
          ✎
        </button>
      )}
    </span>
  );
}

function TextCell({
  value,
  placeholder,
  readOnly,
  onCommit,
  ariaLabel,
  autoFocus,
  onEditingChange,
}: {
  value: string;
  placeholder: string;
  readOnly: boolean;
  onCommit: (value: string) => void;
  ariaLabel: string;
  autoFocus?: boolean;
  onEditingChange?: (editing: boolean) => void;
}) {
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
      autoFocus={autoFocus}
      onFocus={() => {
        editing.current = true;
        onEditingChange?.(true);
      }}
      onBlur={() => {
        editing.current = false;
        setDraft(value);
        onEditingChange?.(false);
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      onChange={(e) => {
        setDraft(e.target.value);
        onCommit(e.target.value);
      }}
    />
  );
}

/**
 * Who reads the section: one or more of this episode's anchors and correspondents, entered above the
 * rundown. When several people talk, the script marks each part with the person's name, like {Jordan}.
 */
function TalentPicker({ value, talent, colors, label, readOnly, onChange }: { value: string[]; talent: EpisodeTalent[]; colors: Talent[]; label: string; readOnly: boolean; onChange: (names: string[]) => void }) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const anchors = talent.filter((t) => t.role === 'anchor').map((t) => t.name);
  const correspondents = talent.filter((t) => t.role === 'correspondent').map((t) => t.name);
  // Keep showing names picked earlier even if they've since been removed from the list.
  const unlisted = value.filter((n) => n !== CROSS_TALK && !anchors.includes(n) && !correspondents.includes(n));
  const toggle = (name: string) => onChange(toggleTalent(value, name));
  const dot = (name: string) => {
    const color = colorForTalent(name, colors);
    return color ? <span className="dot" style={{ background: color }} /> : null;
  };
  const group = (title: string, names: string[]) =>
    names.length > 0 && (
      <fieldset>
        <legend>{title}</legend>
        {names.map((n) => (
          <label key={n} className="check">
            <input type="checkbox" checked={value.includes(n)} onChange={() => toggle(n)} />
            {dot(n)}
            {n}
          </label>
        ))}
      </fieldset>
    );

  return (
    <>
      <button type="button" className="cell-input talent-button" disabled={readOnly} aria-label={`${label} talent`} aria-expanded={Boolean(anchor)} onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}>
        {value.length === 0 ? (
          <span className="muted">{talent.length === 0 ? 'Add talent above' : '—'}</span>
        ) : (
          value.map((n) => (
            <span key={n} className="talent-name">
              {dot(n)}
              {n}
            </span>
          ))
        )}
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)}>
          <div className="talent-picker" role="dialog" aria-label={`Who reads ${label}`}>
            {talent.length === 0 ? (
              <p className="muted small">Add this episode’s anchors and correspondents above the rundown first.</p>
            ) : (
              <p className="muted small">Tick everyone who talks in this section.</p>
            )}
            <label className="check">
              <input type="checkbox" checked={isCrossTalk(value)} onChange={() => toggle(CROSS_TALK)} />
              {CROSS_TALK}
            </label>
            <p className="muted small hint">No formal script: the prompter just says CROSS TALK.</p>
            {group('Anchors', anchors)}
            {group('Correspondents', correspondents)}
            {group('No longer listed', unlisted)}
            <div className="buttons">
              <button className="primary" onClick={() => setAnchor(null)}>
                Done
              </button>
            </div>
          </div>
        </Popover>
      )}
    </>
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
/**
 * Est.: left empty, it shows the length worked out from the script (in grey). Typing a length overrides
 * it; clearing the box goes back to the script's length.
 */
const SCRIPT_HINTS = {
  auto: 'From the script’s read time (143–154 words a minute). Type a length to override it.',
  typed: 'Typed in by hand. Clear it to use the script’s read time.',
};

function DurationCell({ value, autoSeconds, readOnly, onCommit, ariaLabel, hints = SCRIPT_HINTS }: { value: number | null; autoSeconds: number; readOnly: boolean; onCommit: (value: number | null) => void; ariaLabel: string; hints?: { auto: string; typed: string } }) {
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
      placeholder={formatDuration(value === null ? autoSeconds : 0)}
      aria-label={ariaLabel}
      title={
        invalid
          ? 'Type a length like 1:30'
          : value === null
            ? hints.auto
            : hints.typed
      }
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

const chipClass = elementKind;

/** The section's elements as chips, in the order they're expected to fire, plus a + to add one. */
function ElementsCell({ section, label, permanent, cued, doc, me, readOnly }: { section: SectionRow; label: string; permanent: string[]; cued: Set<string>; doc: Y.Doc; me: Person; readOnly: boolean }) {
  const [open, setOpen] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const close = () => setOpen(null);
  const toggle = (id: string, anchor: HTMLElement) => setOpen(open?.id === id ? null : { id, anchor });
  const editing = section.elements.find((e) => e.id === open?.id);

  return (
    <div className="elements">
      {section.elements.map((e, i) => (
        <button
          key={e.id}
          className={`element-chip ${chipClass(e.type)}${cued.has(e.id) ? '' : ' uncued'}`}
          disabled={readOnly}
          title={`${e.type === 'PERM' ? `Permanent graphic: ${e.name}` : `${e.type}: ${ELEMENT_HELP[e.type]}`}${cued.has(e.id) ? '' : ' · no cue in the script yet'}`}
          aria-label={`${label} graphic ${i + 1}: ${e.type}${e.name ? ` ${e.name}` : ''}`}
          onClick={(ev) => toggle(e.id, ev.currentTarget)}
        >
          {e.type === 'PERM' ? (
            <strong>★ {e.name || 'Permanent graphic'}</strong>
          ) : (
            <>
              <strong>{e.type}</strong>
              {e.name && <span>{e.name}</span>}
            </>
          )}
        </button>
      ))}
      {!readOnly && (
        <button className="element-add" aria-label={`Add a graphic to ${label}`} title="Add a graphic" onClick={(ev) => toggle('add', ev.currentTarget)}>
          +
        </button>
      )}
      {open?.id === 'add' && (
        <Popover anchor={open.anchor} onClose={close}>
          <GraphicMenu
            label={`Add a graphic to ${label}`}
            permanent={permanent}
            onPick={(type, name) => {
              addElement(doc, section.id, type, me, name);
              close();
            }}
          />
        </Popover>
      )}
      {editing && open && (
        <Popover anchor={open.anchor} onClose={close}>
          <ElementEditor element={editing} permanent={permanent} index={section.elements.indexOf(editing)} count={section.elements.length} sectionId={section.id} label={label} doc={doc} me={me} onDone={close} />
        </Popover>
      )}
    </div>
  );
}

function ElementEditor({ element, permanent, index, count, sectionId, label, doc, me, onDone }: { element: Element; permanent: string[]; index: number; count: number; sectionId: string; label: string; doc: Y.Doc; me: Person; onDone: () => void }) {
  const [name, setName] = useState(element.name);
  // A permanent graphic's name comes from its dropdown, which saves straight away.
  const saveName = () => element.type !== 'PERM' && name.trim() !== element.name && updateElement(doc, sectionId, element.id, { name: name.trim() }, me);
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
      {element.type === 'PERM' ? (
        <label>
          Which permanent graphic
          <select value={element.name} onChange={(e) => updateElement(doc, sectionId, element.id, { name: e.target.value }, me)}>
            {(permanent.includes(element.name) ? permanent : [element.name, ...permanent]).map((n) => (
              <option key={n} value={n}>
                {n || '—'}
              </option>
            ))}
          </select>
        </label>
      ) : (
      <label>
        Name (optional)
        <input
          value={name}
          maxLength={80}
          placeholder={element.type === 'MUSIC' ? 'e.g. PrimeTime Main' : 'e.g. Highlights'}
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
      )}
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
