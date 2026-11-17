// The graphics attached to a rundown, kept in Google Drive (RG, Nov 17, 2026): each episode's folder is
// deleted two weeks after its air date, to keep the Drive's free 15 GB from filling up.

/** How long after its air date an episode's graphics folder is kept. */
export const KEEP_GRAPHICS_DAYS = 14;

/** The date (YYYY-MM-DD) an episode's graphics are deleted, or null when it has no air date. */
export function graphicsDeleteDate(airDate: string | null | undefined): string | null {
  if (!airDate || !/^\d{4}-\d{2}-\d{2}$/.test(airDate)) return null;
  const [y, m, d] = airDate.split('-').map(Number);
  const when = new Date(Date.UTC(y, m - 1, d + KEEP_GRAPHICS_DAYS));
  return when.toISOString().slice(0, 10);
}

/** The rundown items that get a file attached: every graphic and clip, not music or permanent graphics. */
export const ATTACHABLE_TYPES = ['L3', 'OTSL', 'OTSR', 'FSG', 'TEASE', 'LITES', 'VO', 'SOT', 'PKG'] as const;

export function isAttachable(type: string): boolean {
  return (ATTACHABLE_TYPES as readonly string[]).includes(type);
}

/** A file attached to one of a rundown's graphics. */
export interface AttachedGraphic {
  elementId: string;
  driveFileId: string;
  fileName: string;
  size: number;
  md5: string | null;
  uploadedBy: string | null;
  uploadedAt: number;
  /** An L3, OTSL or OTSR graphic being converted to the right format on GitHub's machines (Nov 17, 2026). */
  converting?: boolean;
  /** What was wrong with it, once the converted copy replaced it. */
  fixes?: string[] | null;
  /** Why it couldn't be converted (the original stays on the graphic). */
  convertError?: string | null;
}
