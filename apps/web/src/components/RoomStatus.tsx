// The live-connection badge and the initials of who else is in the episode, used on the rundown and script pages.

export function ConnectionBadge({ status, synced }: { status: string; synced: boolean }) {
  if (status === 'connected' && synced) return <span className="status live" title="Changes save and appear for everyone automatically">● Live</span>;
  if (status === 'connecting') return <span className="status waiting">● Connecting…</span>;
  return <span className="status offline" title="Your changes will sync when the connection returns">● Offline, reconnecting…</span>;
}

export function PresenceList({ others }: { others: { clientId: number; name: string; color: string }[] }) {
  if (others.length === 0) return null;
  const names = [...new Map(others.map((o) => [o.name, o])).values()];
  return (
    <span className="presence" title={`Also here: ${names.map((o) => o.name).join(', ')}`}>
      {names.slice(0, 5).map((o) => (
        <span key={o.clientId} className="avatar" style={{ background: o.color }}>
          {o.name
            .split(/\s+/)
            .map((w) => w[0])
            .join('')
            .slice(0, 2)
            .toUpperCase()}
        </span>
      ))}
    </span>
  );
}
