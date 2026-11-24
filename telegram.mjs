import { active, rank, urgent } from './radar.mjs';

export const buttonCommands = {
  '🎓 KAIST':'/kaist', '🇰🇷 Корея':'/korea', '🇰🇿 Казахстан':'/kz', '🌐 Онлайн':'/online',
  '⚡ Хакатоны':'/hackathons', '🚀 Стартапы':'/startups', '📅 Дедлайны':'/deadlines', '🔎 Дайджест':'/scan',
};
export const keyboard = {
  keyboard: [['🎓 KAIST','🇰🇷 Корея'],['🇰🇿 Казахстан','🌐 Онлайн'],
    ['⚡ Хакатоны','🚀 Стартапы'],['📅 Дедлайны','🔎 Дайджест']],
  resize_keyboard:true, is_persistent:true,
};

const topics = {
  '/kaist':'KAIST','/korea':'Южная Корея','/kz':'Казахстан','/online':'Онлайн',
  '/hackathons':'Хакатоны','/startups':'Стартап-возможности','/deadlines':'Дедлайны','/scan':'Актуальные возможности',
};
const statuses = {open:'открыта',waitlist:'лист ожидания',upcoming:'ещё не открыта',unknown:'неизвестна',none:'не требуется'};
const notices = {deadline:'Дедлайн изменился',event:'Дата события изменилась',dates:'Даты изменились'};
const unknown = 'не указано';
const noResults = 'Подходящих возможностей пока нет.';
export const incompleteLine = 'Источники проверены частично.';

export function select(events, command, now) {
  const activeEvents = events.filter(event=>active(event,now));
  const eligible = activeEvents.filter(event=>{
    if (command === '/scan' || command === 'daily') return true;
    if (command === '/deadlines') return Boolean(event.deadline);
    if (command === '/hackathons') return event.kinds.includes('hackathon');
    if (command === '/startups') return event.kinds.includes('startup');
    if (Object.hasOwn(topics,command)) return event.regions.includes(command.slice(1));
    return command.toLowerCase().split(/\s+/).filter(Boolean)
      .every(word=>[event.title,event.location,event.why].some(value=>value?.toLowerCase().includes(word)));
  });
  const time = event=>event.deadline?.at ?? (event.deadline ? Date.parse(event.deadline.day) : Infinity);
  return eligible.sort((a,b)=>{
    if (command === '/deadlines' || (urgent(a,now) && urgent(a,now) === urgent(b,now))) {
      const duration = time(a) - time(b);
      if (duration) return duration;
    }
    return rank(b,now)-rank(a,now) || time(a)-time(b) || a.title.localeCompare(b.title);
  });
}

export function dailySelection(events,now) {
  const show = select(events,'daily',now).filter(event=>{
    const bucket = urgent(event,now);
    return Boolean(event.change || (bucket && event.notified!==bucket));
  });
  const firstNew = show.find(event=>!urgent(event,now));
  const firstFive = show.slice(0,5);
  return firstNew && firstFive.length===5 && !firstFive.includes(firstNew) ? [...firstFive.slice(0,4),firstNew] : firstFive;
}

function compact(value,max) {
  const text = (value ?? '').replace(/\s+/g,' ').trim();
  return text.length > max ? Array.from(text.slice(0,max)).filter(ch=>!(/^[\uD800-\uDFFF]$/.test(ch))).join('')+'…' : text;
}

function escape(value) {
  return String(value).replace(/[&<>]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[char]));
}

function label(value, deadline = false) {
  if (!value) return unknown;
  const [year,month,day] = value.day.split('-');
  return day+'.'+month+'.'+year+(value.time?' '+value.time:'')+
    (value.zone ? ' '+value.zone : deadline || value.time ? ' · пояс не указан' : '');
}

function card(event,index) {
  const title = '<b>'+index+'. '+escape(compact(event.title,160))+'</b>';
  const venue = escape(compact(event.location,75)||'Место неизвестно');
  const when = !event.start && event.end ? 'до '+label(event.end) :
    label(event.start)+(event.end && event.end.day!==event.start?.day?' — '+label(event.end):'');
  const deadline = 'Дедлайн'+(event.deadlineKind==='submission'?' проекта':'')+' · '+label(event.deadline,true);
  const why = escape(compact(event.why,170));
  const extra = notices[event.change] ? '\n↻ '+notices[event.change] : '';
  return [title,venue+' · '+when,deadline+' · Регистрация '+(statuses[event.status]??'неизвестна'),why].join('\n')+extra;
}

export function messages(events,{now,command='daily',incomplete=false,more=null}={}) {
  if (!events.length) return [{text:noResults+(incomplete ? ' '+incompleteLine : '')}];
  const sections = [['Подать заявку сегодня',[]],['Дедлайны в ближайшие 72 часа',[]],
    [command==='daily'?'Лучшие новые возможности':topics[command]??'Поиск',[]]];
  for (const event of events) {
    const bucket = urgent(event,now);
    sections[bucket==='today'?0:bucket==='soon'?1:2][1].push(event);
  }
  const output = [];
  let pending = [], rows = [], keys = [], index = 0, length = 0;
  function flush() {
    if (!pending.length) return;
    output.push({text:pending.join('\n\n'),parse_mode:'HTML',reply_markup:{inline_keyboard:rows},cards:keys});
    pending = []; rows = []; keys = []; length = 0;
  }
  for (const [heading,items] of sections) {
    let headingNeeded = true;
    for (const event of items) {
      index++;
      const body = card(event,index);
      if (length+body.length+heading.length+12>3700 || rows.length>=9) {
        flush();
        headingNeeded = true;
      }
      const block = (headingNeeded ? '<b>'+heading+'</b>\n\n' : '') + body;
      pending.push(block);
      length += block.length+2;
      headingNeeded = false;
      const apply = event.status !== 'upcoming' && event.status !== 'waitlist' && event.apply;
      rows.push([{text:index+'. '+(apply?'Подать заявку':'Открыть анонс'),url:apply||event.url}]);
      keys.push(event.key ?? event.url);
    }
  }
  flush();
  if (more) output.at(-1).reply_markup.inline_keyboard.push([{text:'Ещё результаты',callback_data:more}]);
  if (incomplete) output.at(-1).text += '\n\n'+incompleteLine;
  return output;
}
