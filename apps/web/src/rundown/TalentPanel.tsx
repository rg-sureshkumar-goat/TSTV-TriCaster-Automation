// The episode's on-air talent: the producer types in this episode's anchors and correspondents. Each
// gets a color, and sections whose Talent box names them are marked with it. Clicking a name renames
// the person everywhere (RG, Nov 2, 2026: a template's starter talent, like Anchor 1, becomes the real one).
import { useState } from 'react';
import type * as Y from 'yjs';
import { addEpisodeTalent, colorForTalent, removeEpisodeTalent, renameEpisodeTalent, type EpisodeTalent, type Talent, type TalentRole } from '@tstv/shared';

export function TalentPanel({ doc, talent, colors, readOnly }: { doc: Y.Doc; talent: EpisodeTalent[]; colors: Talent[]; readOnly: boolean }) {
  return (
    <section className="talent-panel" aria-label="On-air talent">
      <TalentList title="Anchors" role="anchor" doc={doc} talent={talent} colors={colors} readOnly={readOnly} />
      <TalentList title="Correspondents" role="correspondent" doc={doc} talent={talent} colors={colors} readOnly={readOnly} />
    </section>
  );
}

function TalentList({ title, role, doc, talent, colors, readOnly }: { title: string; role: TalentRole; doc: Y.Doc; talent: EpisodeTalent[]; colors: Talent[]; readOnly: boolean }) {
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string; error?: boolean } | null>(null);
  const people = talent.filter((t) => t.role === role);
  const rename = () => {
    if (!renaming) return;
    if (renameEpisodeTalent(doc, renaming.id, renaming.name)) setRenaming(null);
    else setRenaming({ ...renaming, error: true });
  };
  const add = () => {
    addEpisodeTalent(doc, name, role);
    setName('');
  };
  return (
    <div className="talent-list">
      <strong>{title}</strong>
      <div className="chips">
        {people.length === 0 && <span className="muted small">None yet</span>}
        {people.map((t) =>
          renaming?.id === t.id ? (
            <span key={t.id} className="chip renaming">
              <span className="dot" style={{ background: colorForTalent(t.name, colors) }} />
              <input
                className={`talent-rename${renaming.error ? ' invalid' : ''}`}
                value={renaming.name}
                aria-label={`New name for ${t.name}`}
                title={renaming.error ? 'Type a name that isn’t already in the list' : 'Enter renames them everywhere: the sections and the scripts too. Esc cancels.'}
                maxLength={80}
                autoFocus
                onChange={(e) => setRenaming({ id: t.id, name: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') rename();
                  if (e.key === 'Escape') setRenaming(null);
                }}
                onBlur={() => setRenaming(null)}
              />
            </span>
          ) : (
          <span key={t.id} className="chip">
            <span className="dot" style={{ background: colorForTalent(t.name, colors) }} />
            {readOnly ? (
              t.name
            ) : (
              <button type="button" className="talent-name" title="Click to rename them everywhere: the sections and the scripts too" aria-label={`Rename ${t.name}`} onClick={() => setRenaming({ id: t.id, name: t.name })}>
                {t.name}
              </button>
            )}
            {!readOnly && (
              <button type="button" aria-label={`Remove ${t.name}`} onClick={() => removeEpisodeTalent(doc, t.id)}>
                ×
              </button>
            )}
          </span>
          ),
        )}
        {!readOnly && (
          <input
            className="talent-add"
            value={name}
            aria-label={`Add ${role === 'anchor' ? 'an anchor' : 'a correspondent'}`}
            placeholder={role === 'anchor' ? 'Add an anchor…' : 'Add a correspondent…'}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            onBlur={() => name.trim() && add()}
          />
        )}
      </div>
    </div>
  );
}
