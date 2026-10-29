// The episode's on-air talent: the producer types in this episode's anchors and correspondents. Each
// gets a color, and sections whose Talent box names them are marked with it.
import { useState } from 'react';
import type * as Y from 'yjs';
import { addEpisodeTalent, colorForTalent, removeEpisodeTalent, type EpisodeTalent, type Talent, type TalentRole } from '@tstv/shared';

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
  const people = talent.filter((t) => t.role === role);
  const add = () => {
    addEpisodeTalent(doc, name, role);
    setName('');
  };
  return (
    <div className="talent-list">
      <strong>{title}</strong>
      <div className="chips">
        {people.length === 0 && <span className="muted small">None yet</span>}
        {people.map((t) => (
          <span key={t.id} className="chip">
            <span className="dot" style={{ background: colorForTalent(t.name, colors) }} />
            {t.name}
            {!readOnly && (
              <button type="button" aria-label={`Remove ${t.name}`} onClick={() => removeEpisodeTalent(doc, t.id)}>
                ×
              </button>
            )}
          </span>
        ))}
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
