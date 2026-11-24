export const DAY = 86_400_000;
export const SEOUL = 'Asia/Seoul';
export const regions = ['kaist', 'korea', 'kz', 'online'];
const formatters = new Map();

function civilAt(at, zone) {
  if (!formatters.has(zone)) {
    formatters.set(zone, new Intl.DateTimeFormat('sv-SE', {
      timeZone: zone, year:'numeric', month:'2-digit', day:'2-digit',
      hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23',
    }));
  }
  const parts = formatters.get(zone).format(at).replace(' ', 'T');
  return parts;
}

function localInstant(local, zone) {
  const target = Date.parse(local + 'Z');
  const offsets = new Set([-DAY, 0, DAY].map(delta => {
    const probe = target + delta;
    return Date.parse(civilAt(probe, zone) + 'Z') - probe;
  }));
  const matches = [...offsets].map(offset => target - offset).filter(at => civilAt(at, zone) === local);
  return matches.length === 1 ? matches[0] : null;
}

export function date(value, zone) {
  const match = /^(\d{4}-\d\d-\d\d)(?:[T ](\d\d:\d\d)(?::(\d\d)(?:\.(\d{1,3}))?)?\s*(Z|[+-]\d\d:?\d\d)?)?$/.exec(value?.trim?.() ?? '');
  if (!match) return null;
  let [,day,time,seconds,fraction,offset] = match;
  const local = day + 'T' + (time ?? '00:00') + ':' + (seconds ?? '00');
  const check = Date.parse(local + 'Z');
  if (!Number.isFinite(check) || new Date(check).toISOString().slice(0,19) !== local) return null;
  let at = null;
  if (offset && time) {
    at = Date.parse(local + (fraction ? '.'+fraction : '') + offset);
    if (!Number.isFinite(at)) return null;
  }
  if (zone) {
    try {
      if (at !== null) [day,time] = civilAt(at,zone).slice(0,16).split('T');
      else {
        civilAt(check,zone);
        if (time) at = localInstant(local,zone);
      }
    } catch {
      zone = null;
    }
  }
  const fixed = offset && (offset === 'Z' ? 'UTC' : 'UTC'+offset.replace(/^([+-]\d\d)(\d\d)$/,'$1:$2'));
  return {day,time:time ?? null,zone:zone || fixed || null,at};
}

export function seoulDay(at) {
  return civilAt(at, SEOUL).slice(0,10);
}

export function endOfDay(value) {
  const midnight = Date.parse(value.day + 'T00:00:00Z');
  const nextDay = new Date(midnight + DAY).toISOString().slice(0,10);
  const zoned = value.zone && date(nextDay + 'T00:00', value.zone)?.at;
  return zoned ?? midnight + DAY + 12*3_600_000;
}

function expired(value, now) {
  return value && (value.at ?? endOfDay(value)) <= now;
}

export function active(event, now) {
  if (event.status === 'closed' || event.status === 'cancelled') return false;
  if (expired(event.end ?? event.start,now) || expired(event.deadline,now)) return false;
  return Boolean(event.start || event.deadline || event.status === 'open');
}

export function urgent(event, now) {
  if (event.status === 'waitlist' || event.status === 'upcoming' || event.status === 'none') return null;
  const deadline = event.deadline;
  if (!deadline) return null;
  if (deadline.at !== null) {
    const hours = deadline.at - now;
    if (hours <= 0 || hours > 3*DAY) return null;
    return seoulDay(deadline.at) === seoulDay(now) ? 'today' : 'soon';
  }
  if (!deadline.time && deadline.zone === SEOUL && deadline.day === seoulDay(now)) return 'today';
  return null;
}

export function publicUrl(value, base) {
  if (typeof value!=='string' || !value.trim()) return null;
  try {
    const url = new URL(value,base);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !host.includes('.') ||
      /^(?:\d|0x)[\da-f.x]+$/i.test(host) || /^\[/.test(host) ||
      /(?:^|\.)(?:local|localhost|internal|test|invalid|onion)$/.test(host) || url.href.length > 1600) return null;
    return url;
  } catch { return null; }
}

export function canonical(value) {
  if (!value) return null;
  const url = publicUrl(value);
  if (!url) return null;
  url.hostname = url.hostname.replace(/^www\./,'');
  for (const key of [...url.searchParams.keys()]) {
    if (/^(?:utm_|ref_|fbclid$|gclid$|ref$|source$|visitor_id$)/i.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  if (!/^#(?:event-|:~:text=)/.test(url.hash)) url.hash = '';
  url.pathname = url.pathname.replace(/\/+$/,'') || '/';
  return url.href;
}

export function titleKey(title) {
  return title.toLowerCase().normalize('NFKC').replace(/[\u2019'‘]/g,'')
    .replace(/[\[\(](?:안내|모집공고|안내사항|접수)[\]\)]/g,' ')
    .replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/^(?:встреча|митап|семинар)\s+/u,'');
}

function aliases(event) {
  return [...new Set([event.url,event.apply,...(event.aliases ?? [])].map(canonical).filter(Boolean))];
}

function comparableDate(a,b) {
  const aDay = a.start?.day || a.deadline?.day;
  const bDay = b.start?.day || b.deadline?.day;
  return Boolean(aDay && bDay && Math.abs(Date.parse(aDay)-Date.parse(bDay))<=2*DAY);
}

function sameTitle(a,b) {
  const left = titleKey(a.title), right = titleKey(b.title);
  if (left === right) return left.length >= 8;
  const stripYear = s => s.replace(/\b20\d{2}\b/g,'').replace(/\s+/g,' ').trim();
  if (stripYear(left) === stripYear(right) && stripYear(left).length >= 12) return true;
  const x = new Set(left.split(' ')), y = new Set(right.split(' '));
  const common = [...x].filter(token=>y.has(token)).length;
  return common >= 4 && common/Math.max(x.size,y.size)>=0.82;
}

function sameRecord(a,b) {
  return a.urls.some(url=>b.urls.includes(url)) ||
    (comparableDate(a.event,b.event) && sameTitle(a.event,b.event));
}

const fieldOrder = (a,b) => Number(Boolean(a.stale))-Number(Boolean(b.stale)) || (b.authority ?? 0)-(a.authority ?? 0) || (b.verifiedAt??0)-(a.verifiedAt??0);

export function mergeEvents(events) {
  const groups = [];
  for (const event of events) {
    const item = {event,urls:aliases(event)};
    const matches = groups.filter(group => group.some(other=>sameRecord(item,other)));
    if (!matches.length) groups.push([item]);
    else {
      matches[0].push(item);
      for (const group of matches.slice(1)) {
        matches[0].push(...group);
        groups.splice(groups.indexOf(group),1);
      }
    }
  }
  return groups.map(entries => {
    const group = entries.map(entry=>entry.event);
    const sorted = [...group].sort(fieldOrder);
    const main = sorted[0];
    const first = key => sorted.find(item=>item[key])?.[key] ?? null;
    const status = [...sorted].filter(item=>item.status && item.status !== 'unknown')
      .sort((a,b)=>fieldOrder(a,b) || Number(['closed','cancelled'].includes(b.status))-Number(['closed','cancelled'].includes(a.status)))[0]?.status ?? 'unknown';
    return {
      ...main, status, start:first('start'), end:first('end'), deadline:first('deadline'),
      deadlineKind:sorted.find(item=>item.deadline)?.deadlineKind ?? null,
      location:first('location'), why:first('why'), apply:first('apply'),
      regions:[...new Set(group.flatMap(item=>item.regions))],
      kinds:[...new Set(group.flatMap(item=>item.kinds))],
      aliases:[...new Set(entries.flatMap(entry=>entry.urls))],
    };
  });
}

function stamp(value) {
  return value ? value.at ?? [value.day,value.time,value.zone].join(' ') : null;
}

export function updateHistory(events, previous, now) {
  const history = Object.fromEntries(Object.entries(previous).filter(([,record])=>now-record.seen < 120*DAY));
  const cards = events.map(event => {
    const urls = aliases(event);
    const oldKey = Object.keys(history).find(key=>history[key].aliases.some(url=>urls.includes(url))) ??
      Object.keys(history).find(key=>comparableDate(event,history[key]) && sameTitle(event,history[key]));
    const key = oldKey ?? canonical(event.url);
    const old = history[key];
    const timing = {deadline:stamp(event.deadline), start:stamp(event.start), end:stamp(event.end)};
    const datesChanged = old && ['start','end'].some(field=>timing[field] !== null && old.timing[field] !== timing[field]);
    const deadlineChanged = old && timing.deadline !== null && old.timing.deadline !== timing.deadline;
    const change = !old?.shown ? 'new' : datesChanged && deadlineChanged ? 'dates' :
      deadlineChanged ? 'deadline' : datesChanged ? 'event' : null;
    history[key] = {
      title:event.title, start:event.start ?? old?.start, deadline:event.deadline ?? old?.deadline,
      aliases:[...new Set([...urls,...(old?.aliases ?? [])])].slice(0,12),
      timing:Object.fromEntries(Object.entries(timing).map(([field,value])=>[field,value??old?.timing[field]??null])),
      shown:old?.shown ?? null, notified:old?.notified ?? null, seen:now,
    };
    // Retain changes until the relevant card is actually delivered.
    const pending = change ?? old?.pending ?? null;
    history[key].pending = pending;
    return {...event,key,shown:history[key].shown,notified:history[key].notified,change:pending};
  });
  return {events:cards,history};
}

export function rank(event, now) {
  const urgency = urgent(event,now);
  const relevance = event.interest ?? 0;
  const status = {open:12,unknown:0,upcoming:-6,waitlist:-9}[event.status] ?? 0;
  const region = event.regions.includes('kaist') ? 40 : event.location?.includes('Тэджон') ? 12 : event.regions.includes('online') ? 8 : 5;
  return (urgency === 'today' ? 1000 : urgency === 'soon' ? 500 : 0) + relevance + status + region + (event.apply ? 6 : 0);
}
