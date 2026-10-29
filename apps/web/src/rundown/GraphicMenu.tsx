// The list of graphics you can add to a section: the element types, then the show's permanent graphics
// by name. Used by the rundown's + button and the script page's "New graphic" button.
import { ELEMENT_TYPES, type ElementType } from '@tstv/shared';

export const ELEMENT_HELP: Record<ElementType, string> = {
  L3: 'lower third',
  OTSL: 'over the shoulder, left',
  OTSR: 'over the shoulder, right',
  FSG: 'full-screen graphic',
  VO: 'video the anchor reads over',
  SOT: 'sound bite with its own audio',
  PKG: 'package',
  TEASE: 'tease graphic',
  LITES: 'LITES video',
  MUSIC: 'music from the TriCaster’s Sound player',
  PERM: 'one of the show’s permanent graphics',
};

/** The types picked from the menu's first list; permanent graphics are listed by name below them. */
const PICKABLE_TYPES = ELEMENT_TYPES.filter((t) => t !== 'PERM');

export function GraphicMenu({ label, permanent, onPick }: { label: string; permanent: string[]; onPick: (type: ElementType, name?: string) => void }) {
  return (
    <div className="menu" role="menu" aria-label={label}>
      {PICKABLE_TYPES.map((type) => (
        <button key={type} role="menuitem" onClick={() => onPick(type)}>
          <strong>{type}</strong> <span className="muted small">{ELEMENT_HELP[type]}</span>
        </button>
      ))}
      {permanent.length > 0 && <div className="menu-heading">Permanent graphics</div>}
      {permanent.map((name) => (
        <button key={`perm-${name}`} role="menuitem" onClick={() => onPick('PERM', name)}>
          <strong>★ {name}</strong>
        </button>
      ))}
    </div>
  );
}
