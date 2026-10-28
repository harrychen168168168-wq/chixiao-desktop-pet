const label = w => w.id === 'seven_day' ? '每周 · 所有模型' : String(w.label || '').replace(/(.+) 每周/, '每周 · $1');
const keyOf = (provider, identity, resetAt) => `${provider}:${identity}:soon:at:${resetAt}`;

function details(n) {
  if (n.kind !== 'upcoming') return null;
  if (n.upcoming) return n.upcoming;
  const m = n.id?.match(/^(claude|codex):(.+):soon:(.+):(\d+)$/);
  if (!m || m[1] !== n.provider) return null;
  return { identity: m[2], resetAt: Number(m[4]), windows: [{ id: m[3], label: (n.text || '').split('：')[0] }] };
}

function combine(a, b) {
  const windows = new Map(a.windows.map(w => [w.id, w]));
  for (const w of b.windows) windows.set(w.id, w);
  return { ...a, windows: [...windows.values()].sort((x, y) => x.id.localeCompare(y.id)) };
}

function text(upcoming, receivedAt) {
  const minutes = Math.max(1, Math.ceil((upcoming.resetAt - receivedAt) / 60000));
  return `${upcoming.windows.map(label).join('、')}：官方预告约 ${minutes} 分钟后恢复。能等待的话，先保留赠送次数。这是预告，实际恢复仍待官方数据确认。`;
}

function migrate(notices, seen) {
  const out = [], groups = new Map(), keys = new Set(seen);
  for (const n of notices) {
    const upcoming = details(n);
    if (!upcoming) { out.push(n); continue; }
    const id = keyOf(n.provider, upcoming.identity, upcoming.resetAt);
    keys.add(n.id); keys.add(id);
    let group = groups.get(id);
    if (!group) {
      group = { ...n, id, upcoming, mergedIds: [...new Set([...(n.mergedIds || []), n.id])] };
      groups.set(id, group); out.push(group);
    } else {
      group.upcoming = combine(group.upcoming, upcoming);
      group.mergedIds = [...new Set([...group.mergedIds, ...(n.mergedIds || []), n.id])];
      group.receivedAt = Math.min(group.receivedAt, n.receivedAt);
      group.acknowledgedAt = group.acknowledgedAt || n.acknowledgedAt || null;
    }
    group.text = text(group.upcoming, group.receivedAt);
  }
  for (const id of seen) {
    const upcoming = details({ kind: 'upcoming', provider: id.split(':')[0], id });
    if (upcoming) keys.add(keyOf(id.split(':')[0], upcoming.identity, upcoming.resetAt));
  }
  return { notices: out, seen: [...keys] };
}

module.exports = { keyOf, combine, text, migrate };
