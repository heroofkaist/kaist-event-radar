import {active, canonical, date, DAY, mergeEvents, publicUrl, rank, titleKey} from './radar.mjs';

import {registry} from './catalog.mjs';

const entity = {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',ndash:'–',mdash:'—',rsquo:'’',lsquo:'‘',ldquo:'“',rdquo:'”',middot:'·'};
function decode(text='') {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi,(match,key)=>{
    if (key.startsWith('#')) {
      const number = key[1].toLowerCase()==='x' ? parseInt(key.slice(2),16) : Number(key.slice(1));
      return number>0 && number<=0x10ffff ? String.fromCodePoint(number) : match;
    }
    return entity[key] ?? match;
  });
}
const clean = (s='')=>decode(s.replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
const attr = (opening,name)=>decode(opening.match(new RegExp('(?:^|\\s)'+name+'\\s*=\\s*(?:"([^"]*)"|\\x27([^\\x27]*)\\x27|([^\\s>]+))','i'))?.slice(1).find(x=>x!==undefined)??'');
const tag = (html,name)=>html.match(new RegExp('<'+name+'(?:\\s[^>]*)?>([\\s\\S]*?)</'+name+'>','i'))?.[1] ?? '';
function bodyText(html) {
  return decode(html.replace(/<!--[\s\S]*?-->|<(script|style|nav|footer|header|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ')
    .replace(/<\/(?:p|li|dd|dt|div|h[1-6]|td|th|tr|article|section)>|<br\b[^>]*>/gi,'\n')
    .replace(/<[^>]*>/g,' ')).replace(/[^\S\n]+/g,' ').replace(/\n\s*\n/g,'\n').trim();
}
function jsonScripts(html, name) {
  const records = [];
  const start = name==='ld' ? /<script\b[^>]{0,500}type=["']application\/ld\+json["'][^>]*>/gi :
    /<script\b[^>]{0,500}id=["']__NEXT_DATA__["'][^>]*>/gi;
  for (const opening of html.matchAll(start)) {
    const from = opening.index+opening[0].length;
    const to = html.indexOf('</script>',from);
    if (to<0) continue;
    try { records.push(JSON.parse(html.slice(from,to))); } catch { /* HTML metadata is optional. */ }
  }
  return records;
}
const next = html=>jsonScripts(html,'next')[0]?.props?.pageProps;
function structured(html) {
  return jsonScripts(html,'ld').flatMap(x=>Array.isArray(x)?x:x['@graph']??[x]);
}
const isEvent = x=>Array.isArray(x?.['@type']) ? x['@type'].includes('Event') : /(?:^|\/)(?:Event|EducationEvent|BusinessEvent|Hackathon)$/.test(x?.['@type']??'');
const eventsIn = html=>structured(html).flatMap(x=>isEvent(x)?[x]:(x.itemListElement??[]).map(i=>i.item).filter(isEvent));

const hack = /hackathon|hack\s*day|hackfest|buildathon|hack\s*jam|해커톤|해카톤|хакатон|хакатонға/i;
const startup = /start[\s-]?up (?:battle|competition|pitch|cup|accelerat|grant|program|demo)|(?:startup|founder|venture|incubator|accelerator|pitch (?:day|night|contest)|seed funding|grant call)|창업|스타트업|액셀러|사업화|지원사업|투자유치|(?:창업|스타트업).{0,15}경진대회|стартап|акселерац|инвестиционн|грант|стартап.{0,20}байқау|кәсіпкерлік/i;
const research = /(?:research|lab|연구|интерн|зерттеу).{0,35}(?:intern|experience|recruit|assistant|모집|체험)|인턴십|externship|исследовательск.*стажиров/i;
const seminar = /seminar|colloquium|conference|symposium|lecture|포럼|세미나|강연|심포지엄|컨퍼런스|콜로키움|семинар|лекция|конференц/i;
const club = /student club|club recruit|동아리|студенческ.{0,20}клуб/i;
const agents = /\b(?:agentic|ai agents?|claude code|codex|mcp|rag|llm|devin)\b|에이전트|ии.агент/i;
const ai = /\b(?:ai|machine learning|deep learning|neural|multimodal)\b|인공지능|머신러닝|искусственн.{0,7} интеллект|\bИИ\b|жасанды интеллект/i;
const quantum = /quantum|qubit|graphene|photon|condensed matter|superconduct|physics|nobel|양자|광자|квант/i;
const hardware = /robot|hardware|semiconductor|embedded|electronics|iot|drone|chip|uav|반도체|로봇|드론|робот|железо/i;
const quant = /(?:\bquant\b|quantitative (?:finance|trading)|algo(?:rithmic)?[- ]trading|finance modeling|금융공학)/i;
const tech = /devfest|developer|opensource|open.source|web3|blockchain|technology|engineer|data|software|computing|cyber|기술|개발|데이터|소프트웨어|технолог|разработ/i;
const kzCities = /астан[аеуы]|astana|алматы|almaty|актобе|aqtobe|aktobe|қазақстан|kazakhstan|семей|karaganda|караганда|шымкент|shymkent|тараз|taraz|павлодар|pavlodar|қостанай|kostanay|атырау|atyrau/i;
const krCities = /daejeon|seoul|pangyo|suwon|busan|incheon|daegu|gwangju|seongnam|대전|서울|판교|수원|부산|인천|대구|광주|성남/i;
const closed = /(?:registration|applications?|submissions?|sign[- ]?ups?) (?:is |are |has |have )?(?:now )?(?:closed|ended|finished)|sold out|event (?:has ended|is over|completed)|접수\s*(?:마감되었습니다|종료되었습니다|종료)|모집\s*(?:마감되었습니다|종료되었습니다)|신청\s*(?:마감되었습니다|종료되었습니다)|регистрация (?:закрыта|окончена|завершена)|при[её]м заявок (?:заверш[её]н|закрыт|окончен)|тіркеу аяқталды/i;
const open = /(?:registration|applications?|sign[- ]?ups?) (?:is |are )?(?:now )?open|(?:신청|접수|모집)\s*중|регистрация открыта|при[её]м заявок открыт|өтінім қабылдау ашық/i;
const register = /^(?:(?:register|apply|sign\s*up|join hackathon|request to join|rsvp)(?: now| here| for (?:this event|the hackathon))?|(?:참가|사전|온라인)?\s*(?:신청|접수)(?:하기| 바로가기| 링크)?|(?:подать заявку|принять участие|зарегистрироваться|форма регистрации|регистрация|өтінім беру|тіркелу))(?:\s*[→›»])?$/i;
const newsHost = /(^|\.)(?:msn\.com|yahoo\.com|news\.google\.com|bing\.com|hellodd\.com|koreadaily\.com|mk\.co\.kr|etnews\.com)$/i;
const online = /\bonline\b|\bvirtual\b|\bremote\b|온라인|비대면|онлайн/i;

function classify(title, content, kind, schemaHack=false) {
  const summary = content.slice(0,1000);
  const topic = title+' '+summary;
  const kinds = new Set(kind?[kind]:[]);
  if (schemaHack || hack.test(title)) kinds.add('hackathon');
  if (startup.test(title) || /(?:입주|지원)기업 모집|demo\s*day|데모데이/i.test(title)) kinds.add('startup');
  if (research.test(title)) kinds.add('research');
  if (seminar.test(title)) kinds.add('seminar');
  if (club.test(title)) kinds.add('club');
  if (ai.test(title)||agents.test(title)||tech.test(title)||quantum.test(title)||hardware.test(title)||quant.test(title)) kinds.add('tech');

  const interests = [
    [agents,26,'по AI-агентам и их инструментам'],
    [quantum,24,'по квантовым системам и материалам'],
    [/robot|로봇|робот|uav|drone|드론/i,21,'по робототехнике'],
    [hardware,21,'по электронике и аппаратным системам'],
    [quant,23,'по количественным стратегиям и моделированию'],
    [ai,15,'по прикладному ИИ'],
    [tech,7,'по разработке и инженерным инструментам'],
  ];
  const interestInTitle = interests.find(([pattern])=>pattern.test(title));
  const matched = interestInTitle ?? interests.find(([pattern])=>pattern.test(topic));
  const theme = matched?.[2];
  const subject = title.replace(/^(?:\[.{1,35}\]\s*)/,'').slice(0,118);
  const why = /robot.*rescue|rescue.*robot|unitree.*rescue/i.test(topic) ? 'Запрограммировать робота для спасательного сценария.' :
    /wigner crystal/i.test(title) && /graphene/i.test(title) ? 'Разобрать эффекты взаимодействия в графене.' :
    /agentic.{0,20}payments/i.test(title) ? 'Разобрать, как ИИ-агенты инициируют платежи.' :
    /\bdevin\b/i.test(title) ? 'Посмотреть применение программного агента Devin в разработке.' :
    /devfest/i.test(title) && ai.test(summary) ? 'Послушать, как разработчики внедряют ИИ в свои сервисы.' :
    kinds.has('hackathon') ? (theme?'Собрать проект '+theme+'.':'Собрать и представить проект на «'+subject+'».') :
    kinds.has('research') ? 'Подать заявку на исследовательскую работу'+(theme?' '+theme:'')+'.' :
    kinds.has('startup') ? (/grant|fund|지원사업|грант/i.test(title) ? 'Проверить, подходит ли проект под условия финансирования.' :
      /pitch|battle|경진|demo/i.test(title) ? 'Посмотреть, как команды представляют и защищают свои проекты.' :
      'Проверить условия набора и подать заявку со своим проектом.') :
    kinds.has('club') ? 'Найти студенческую команду для совместного проекта.' :
    theme ? 'Разобрать подходы '+theme+'.' : 'Разобрать тему «'+subject+'» с докладчиком.';
  const interest = (matched?.[1]??0)+(kinds.has('research')?15:kinds.has('hackathon')||kinds.has('startup')?10:0)+
    (/\bstudents?\b|대학생|студент|студенттер/i.test(summary)?4:0);
  return {kinds:[...kinds],why,interest};
}

const months = {
  january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12,
  января:1,февраля:2,марта:3,апреля:4,мая:5,июня:6,июля:7,августа:8,сентября:9,октября:10,ноября:11,декабря:12,
  қаңтар:1,ақпан:2,наурыз:3,сәуір:4,мамыр:5,маусым:6,шілде:7,тамыз:8,қыркүйек:9,қазан:10,қараша:11,желтоқсан:12,
};
const monthWord = Object.keys(months).concat(Object.keys(months).slice(0,12).map(x=>x.slice(0,3))).join('|');
const namedDate = new RegExp('(?:(\\d{1,2})\\s*(?:[–—-]\\s*(\\d{1,2})\\s*)?('+monthWord+')\\.?\\s*,?\\s*(20\\d{2})|('+monthWord+')\\.?\\s+(\\d{1,2})\\s*,?\\s*(20\\d{2}))','giu');
const timeZones = {KST:'+09:00',PST:'-08:00',PDT:'-07:00',EST:'-05:00',EDT:'-04:00',CST:null,CDT:'-05:00',MST:'-07:00',MDT:'-06:00',GMT:'Z',UTC:'Z'};
const pad = number=>String(number).padStart(2,'0');
const isoDay = (year,month,day)=>year+'-'+pad(month)+'-'+pad(day);
const findMonth = word=>months[word.toLowerCase()] ?? Object.entries(months).find(([key])=>key.startsWith(word.toLowerCase()))?.[1];

function timing(rest) {
  const time = rest.match(/^\s*(?:[년г.,(][^) \n,]{0,4}\)?\s*)*(?:at\s+|[@,·(]\s*)?(?:до\s+)?(\d{1,2})(?:[:시](\d\d)?|(?=\s*(?:a\.?m\.?|p\.?m\.?)))(?:\s*(a\.?m\.?|p\.?m\.?))?/i);
  if (!time) return '';
  const hr = Number(time[1]);
  const hours = time[3] ? hr%12 + (time[3][0].toLowerCase()==='p'?12:0) : hr;
  const zone = rest.slice(time[0].length).match(/^\s*(?:[\[(]\s*)?(?:(?:UTC|GMT)\s*([+-]\d{1,2})(?::?(\d\d))?|([+-]\d\d:?\d\d)|(KST|PST|PDT|EST|EDT|CST|CDT|MST|MDT|UTC|GMT)\b)/i);
  const suffix = zone?.[1] ? zone[1][0]+pad(zone[1].slice(1))+':'+(zone[2]??'00') :
    zone?.[2] ?? timeZones[zone?.[3]?.toUpperCase()] ?? '';
  return 'T'+pad(hours)+':'+(time[2]??'00')+suffix;
}

function textDates(text) {
  const dates = [];
  const numeric = /\b(20\d{2})\s*[-년./]\s*(\d{1,2})\s*[-월./]\s*(\d{1,2})(?!\d)/g;
  for (const m of text.matchAll(numeric)) {
    let rest = text.slice(m.index+m[0].length,m.index+m[0].length+55);
    const localDate = isoDay(m[1],m[2],m[3]);
    dates.push({index:m.index,value:date(localDate+timing(rest))});
    const end = rest.match(/^\s*(?:일|[.(][^)\n]{0,3}\))?\s*(?:~|–|—| έως | to )\s*(\d{1,2})[./월]\s*(\d{1,2})(?!\d)/i);
    if (end) {
      const suffix = timing(rest.slice(end[0].length));
      dates.push({index:m.index+m[0].length,value:date(isoDay(m[1],end[1],end[2])+suffix)});
    }
  }
  for (const m of text.matchAll(/\b(\d\d)[./](\d\d)[./](20\d{2})(?!\d)/g)) {
    dates.push({index:m.index,value:date(isoDay(m[3],m[2],m[1])+timing(text.slice(m.index+m[0].length,m.index+m[0].length+48)))});
  }
  for (const m of text.matchAll(namedDate)) {
    const year = m[4]??m[7], month = findMonth(m[3]??m[5]);
    dates.push({index:m.index,value:date(isoDay(year,month,m[1]??m[6])+(!m[2]?timing(text.slice(m.index+m[0].length,m.index+m[0].length+55)):''))});
    if (m[2]) dates.push({index:m.index+1,value:date(isoDay(year,month,m[2])+timing(text.slice(m.index+m[0].length,m.index+m[0].length+55)))});
  }
  return dates.filter(x=>x.value).sort((a,b)=>a.index-b.index).map(x=>x.value);
}

function field(text, regexp) {
  const lines = text.split('\n');
  for (let index=0;index<lines.length;index++) {
    const line = lines[index].trim();
    if (!regexp.test(line)) continue;
    const values = textDates(line);
    if (values.length) return values;
    if (line.length<85) {
      const following = lines[index+1]?.trim()??'';
      if (!/^(?:장소|접수|신청|등록일|일시|дедлайн|registration|application|when|location)/i.test(following)) {
        const after = textDates(following);
        if (after.length) return after;
      }
    }
  }
  return [];
}

function links(html,base) {
  const result = [];
  for (const m of html.matchAll(/<a\b([^>]{0,2000})>([\s\S]*?)<\/a\s*>/gi)) {
    const href = attr(m[1],'href');
    const url = publicUrl(href,base);
    if (!href || href.startsWith('#')) continue;
    const title = clean(m[2]).slice(0,420);
    result.push({url:url?.href, href, title, raw:m[2], attrs:m[1], index:m.index});
  }
  return result;
}

function meta(html,property) {
  for (const m of html.matchAll(/<meta\b[^>]{0,3500}>/gi)) {
    if (attr(m[0],'property')===property || attr(m[0],'name')===property) return attr(m[0],'content');
  }
  return '';
}

function city(text) {
  const cities = [
    [/daejeon|대전|тэджон/i,'Тэджон'],[/seoul|서울|сеул/i,'Сеул'],[/pangyo|판교/i,'Пангё'],
    [/suwon|수원/i,'Сувон'],[/busan|부산/i,'Пусан'],[/incheon|인천/i,'Инчхон'],
    [/daegu|대구/i,'Тэгу'],[/gwangju|광주/i,'Кванджу'],[/seongnam|성남/i,'Соннам'],
    [/астан[аеуы]|astana/i,'Астана'],[/алматы|almaty/i,'Алматы'],[/актобе|aktobe|aqtobe/i,'Актобе'],
    [/s[eé]mey|семей/i,'Семей'],[/karaganda|караганда/i,'Караганда'],
    [/shymkent|шымкент/i,'Шымкент'],[/taraz|тараз/i,'Тараз'],
  ];
  return cities.find(([pattern])=>pattern.test(text))?.[1] ?? null;
}
function attendance(record) {
  const place = Array.isArray(record.location)?record.location[0]:record.location;
  const addr = place?.address;
  const locality = typeof addr==='string' ? addr : addr?.addressLocality ?? addr?.addressRegion ?? '';
  const venue = typeof place==='string' ? place : place?.name ?? '';
  const mode = record.eventAttendanceMode??'';
  const virtual = /Online/.test(mode) || place?.['@type']==='VirtualLocation' || locality==='Online';
  const mixed = /Mixed/.test(mode);
  const where = city(locality+' '+venue) ?? clean(locality);
  return {where:virtual?'Онлайн':mixed?(where?where+' + онлайн':'Онлайн и очно'):where||null,
    virtual:virtual||mixed, country:addr?.addressCountry?.name??addr?.addressCountry};
}

function contextualStatus(text) {
  if (closed.test(text)) return 'closed';
  if (/registration (?:is )?not (?:yet )?open|coming soon.{0,25}registration|접수예정|등록 예정/i.test(text)) return 'upcoming';
  if (/registration (?:is )?not required|no registration required|사전등록 불필요|регистрация не требуется/i.test(text)) return 'none';
  if (/join (?:the )?waitlist|waitlist (?:is )?open|лист ожидания/i.test(text)) return 'waitlist';
  return open.test(text)?'open':'unknown';
}

function descriptionOf(html) {
  return clean(meta(html,'og:description')||meta(html,'description')).slice(0,900);
}

function eventReady(region, source, record, candidate, now) {
  const url = publicUrl(record.url)?.href;
  if (!url || !record.title || record.title.length<5) return null;
  const topic = classify(record.title,record.description??'',source.kind,record.hack);
  if (!topic.kinds.length || (source.adapter==='rss' && !record.start && !record.deadline)) return null;
  const title = record.title.trim().slice(0,240);
  const location = record.location ?? source.location ?? null;
  if (region==='online' && !record.virtual && !record.remoteApply) return null;
  if (region==='kz' && ['rss','claude'].includes(source.adapter) && !kzCities.test(location??'') && !kzCities.test(title) && record.country!=='KZ') return null;
  if (region==='korea' && ['rss','claude'].includes(source.adapter) && !krCities.test(location??'') && !krCities.test(title) && record.country!=='KR') return null;
  if (region==='kaist' && source.adapter==='rss' && !/kaist|카이스트|한국과학기술원/i.test(title+' '+(record.description??'')+' '+url)) return null;
  const event = {...topic,title,url,location,
    regions:[region,...(region!=='online'&&record.virtual&&region!=='kaist'?['online']:[])],
    start:record.start??null,end:record.end??null,deadline:record.deadline??null,
    deadlineKind:record.deadlineKind??null,status:record.status??'unknown',
    apply:record.apply??null,authority:record.authority??(source.official?3:1),
    aliases:candidate?.aliases??[], source:source.id,
  };
  if (!active(event,now) && !['closed','cancelled'].includes(event.status) && !event.start && !event.deadline) return null;
  return event;
}

function candidatesFor(source,html,base,region,now) {
  const discovered = [];
  const add = (url,title='',hint={})=>{
    const link = publicUrl(url,base);
    if (!link || canonical(link.href)===canonical(base)) return;
    if (hint.end && hint.end.day<new Date(now-2*DAY).toISOString().slice(0,10)) return;
    if (discovered.some(x=>canonical(x.url)===canonical(link.href))) return;
    discovered.push({url:link.href,title, ...hint});
  };
  if (source.adapter==='schema') {
    for (const x of eventsIn(html)) {
      const info = attendance(x);
      const desc = x.description??'';
      if (source.id==='seoul-calendar' && !classify(x.name??'',desc).kinds.length &&
        !(agents.test(desc)||ai.test(desc)||hardware.test(desc))) continue;
      add(x.url??x['@id'],x.name,{end:date(x.endDate??x.startDate),location:info.where,virtual:info.virtual});
    }
    if (source.id==='hackathon-korea') {
      for (const item of structured(html).flatMap(x=>x.itemListElement??[])) {
        if (item.url && new URL(item.url,base).origin===new URL(base).origin &&
          /\/events\/[^/]+$/.test(new URL(item.url,base).pathname)) add(item.url,item.name);
      }
    }
  } else if (source.adapter==='gdg') {
    const results = next(html)?.prerenderData?.upcomingEvents?.results;
    if (!Array.isArray(results)) throw new Error('upcoming event list missing');
    for (const x of results) add(x.url,x.title,{end:date(x.end_date??x.start_date)});
  } else if (source.adapter==='devpost') {
    const items = JSON.parse(html).hackathons;
    if (!Array.isArray(items)) throw new Error('hackathon list missing');
    for (const x of items) {
      if (x.open_state!=='open' || x.invite_only || x.displayed_location?.location!=='Online') continue;
      add(x.url,x.title,{kind:'hackathon',virtual:true,interest:classify(x.title,(x.themes??[]).map(t=>t.name).join(' '),'hackathon').interest});
    }
    // Preserve room for soon-closing items in source order while prioritizing the remaining slots by relevance.
    return [...discovered.slice(0,3),...discovered.slice(3).sort((a,b)=>b.interest-a.interest)].slice(0,source.max);
  } else if (source.adapter==='kstartup') {
    for (const item of html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
      const id = item[1].match(/go_view\((\d+)\)/)?.[1];
      const title = clean(item[1].match(/<p class=["']tit["']>([\s\S]*?)<\/p>/i)?.[1]);
      if (!id||!title) continue;
      const deadline = textDates(clean(item[1]).match(/마감일자\s*([\d.-]+)/)?.[1]??'')[0];
      if (deadline && deadline.day<new Date(now-DAY).toISOString().slice(0,10)) continue;
      const url = new URL(base);
      url.searchParams.set('schM','view');
      url.searchParams.set('pbancSn',id);
      add(url.href,title,{deadline,openHint:/class=["']flag day["'][^>]*>\s*D-(?:DAY|\d+)/i.test(item[1])});
    }
  } else if (source.adapter==='rss') {
    if (!/<rss[\s>]/i.test(html)) throw new Error('RSS response missing');
    for (const m of html.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
      const item = m[1];
      const published = Date.parse(clean(tag(item,'pubDate')));
      if (Number.isFinite(published) && published<now-35*DAY) continue;
      const destination = publicUrl(decode(tag(item,'link').replace(/^<!\[CDATA\[|\]\]>$/g,'').trim()));
      const target = publicUrl(destination?.searchParams.get('url')??destination?.href);
      const title = clean(tag(item,'title'));
      if (!target || newsHost.test(target.hostname) || !classify(title,'').kinds.length) continue;
      add(target.href,title);
    }
  } else if (source.adapter==='claude') {
    const unescaped = html.replace(/\\+"/g,'"');
    const geo = region==='kz'?/(?:\bKZ\b|Astana|Almaty|Aktobe|Kazakhstan)/i:region==='korea'?/(?:\bKR\b|Daejeon|Seoul|Pangyo|Suwon|Korea)/i:online;
    // The organizer hierarchy names the location in its rendered link text.
    for (const link of links(html,base)) {
      if (link.url && /\/claude[-\w]*$/i.test(new URL(link.url).pathname) &&
        new URL(link.url).hostname==='luma.com' && geo.test(link.title)) add(link.url,link.title);
    }
    for (const m of unescaped.matchAll(/"href":"(https:\/\/luma\.com\/[a-z\d_-]+)"([\s\S]{0,4800}?)(?="href":|$)/gi)) {
      if (geo.test(m[2].replace(/"className":"[^"]*"/g,''))) add(m[1],'Claude Community');
    }
  } else if (source.adapter==='hackalem') {
    for (const m of html.matchAll(/(?:\/hackathons\/|"id":")([0-9a-f]{8}-[a-f\d-]{27})/gi)) {
      if (m[0].startsWith('/')) add('/hackathons/'+m[1]);
    }
  } else {
    for (const link of links(html,base)) {
      if (!link.url || !link.title) continue;
      const url = new URL(link.url);
      if (!source.external && url.origin!==new URL(base).origin) continue;
      if (source.host && !source.host.test(url.hostname)) continue;
      if (!source.pattern?.test(url.pathname+url.search)) continue;
      if (source.format==='mlh'&&(!/utm_source=mlh/.test(url.search)||!online.test(link.title))) continue;
      if (source.format==='devhunt'&&url.hostname==='devhunt.org') continue;
      if (['onoff','themed'].includes(source.format)&&!classify(link.title,'').kinds.length) continue;
      if (source.format==='itfest' && !/^\d\d\s/.test(link.title)) continue;
      if (source.format==='apart' && !online.test(link.title)) continue;
      if (source.format==='club' && !/모집|recruit/i.test(link.title)) continue;
      if (source.id==='ee-recruiting'||source.id==='physics-recruiting') {
        if (!research.test(link.title) && !club.test(link.title) && !hack.test(link.title)) continue;
      }
      if (source.format==='physics') {
        const row = html.slice(html.lastIndexOf('<tr',link.index),link.index);
        const start = textDates(clean(row))[0];
        if (!start) continue;
        add(link.url,link.title,{end:start});
      } else if (source.format==='campus') {
        const block = html.slice(html.lastIndexOf('card--body',link.index),link.index);
        const [start,end] = field(bodyText(block),eventLabels);
        const title = clean(tag(block,'strong'));
        if (title) add(link.url,title,{start,end:end??start});
      } else {
        const title = clean(tag(link.raw,'strong'))||link.title.replace(/^\d\d\s+|\s+Подробнее$|^종료된 이벤트입니다\s+/g,'');
        const hint = source.format==='apart'?{virtual:true,end:textDates(title)[0]}:{};
        add(link.url,title,hint);
      }
    }
  }
  return discovered.slice(0,source.max??5);
}

function fromSchema(x,html,url,source,now) {
  const info = attendance(x);
  const offers = (Array.isArray(x.offers)?x.offers:[x.offers]).filter(Boolean);
  const available = offer=>/(?:InStock|LimitedAvailability|OnlineOnly)$/.test(offer.availability??'');
  const unavailable = offer=>/(?:SoldOut|OutOfStock|Discontinued)$/.test(offer.availability??'');
  const hasRegistration = /(^|\.)devpost\.com$|^gdg\.community\.dev$|(^|\.)luma\.com$/.test(new URL(url).hostname);
  const snippet = clean(x.description??'') || descriptionOf(html);
  let status = contextualStatus(snippet);
  if (/EventCancelled|EventPostponed|EventCompleted/.test(x.eventStatus??'')) status='cancelled';
  else if (offers.length && offers.every(unavailable)) status='closed';
  else if (status==='unknown' && hasRegistration && offers.some(available)) status='open';
  const offer = offers.length===1?offers[0]:null;
  const validFrom = date(offer?.validFrom);
  if (status==='open' && validFrom?.at>now) status='upcoming';
  const offerUrl = offer && publicUrl(offer.url,url)?.href;
  const gdgZone = new URL(url).hostname==='gdg.community.dev' ?
    next(html)?.eventData?.event_timezone : null;
  const end = date(x.endDate);
  const offerEnd = hasRegistration && offer ? date(offer.validThrough,gdgZone) : null;
  const deadline = offerEnd && offerEnd.at!==end?.at ? offerEnd : null;
  const record = {title:clean(x.name), description:snippet,url,location:info.where??city(x.name??''), country:info.country,
    start:date(x.startDate),end,deadline,status,virtual:info.virtual,
    hack:Array.isArray(x['@type'])?x['@type'].includes('Hackathon'):x['@type']==='Hackathon',
    apply:status==='open' && offerUrl && (canonical(offerUrl)!==canonical(url) || (hasRegistration&&new URL(url).hostname==='gdg.community.dev')) ? offerUrl : null,
  };
  if (source.id==='nazarbayev') {
    // The university template labels the displayed wall clock as UTC even for Astana venues.
    // Publish the visible civil day until a timezone is explicitly supplied on the page.
    record.start = date(x.startDate?.slice(0,10));
    record.end = date(x.endDate?.slice(0,10));
  }
  return record;
}

const eventLabels = /^(?:일시|날짜|행사\s*(?:일시|일정|기간)|이벤트\s*기간|개최\s*(?:일시|일정)|교육\s*기간|운영\s*기간|체험\s*기간|기간\s*:|Date(?: and time)?\s*:|When\s*:|Event (?:date|period|schedule)|(?:Дата|Даты) (?:начала|проведения|мероприятия)|өткізу күні)\s*/i;
const applicationLabels = /(?:신청|접수|모집|등록|지원)\s*(?:기간|기한|마감)\s*[:：]?|^(?:마감일자|Applications? (?:close|deadline|period)|Registration (?:closes|deadline|period)|(?:срок|дедлайн) (?:регистрации|подачи)|регистрация\s*:|при[её]м заявок до|өтінім қабылдау мерзімі)/i;
const preciseApplication = /(?:deadline (?:to (?:apply|register)|for (?:applications|registration))|(?:apply|register|sign up) (?:by|until)|(?:registration|applications?) (?:deadline|closes|close|ends|end)|последний день подачи заявок|(?:при[её]м заявок|регистрация) до|신청(?:마감|기한)|접수마감)/i;

function fromText(html,url,source,candidate,now) {
  const host = new URL(url).hostname;
  const scope = source.format==='business' ? html.match(/<section id="view_cmt"[\s\S]*?<\/section>/i)?.[0] :
    source.format==='physics' ? html.split('<table class="mo-board"')[0] : null;
  const content = scope || tag(html,'article') || tag(html,'main') || html;
  const body = bodyText(content);
  let title = clean(tag(content,'h1')) || candidate.title || clean(meta(html,'og:title')||tag(html,'title'));
  if (source.format==='business') title = clean(tag(content,'b')) || candidate.title;
  if (source.format==='maths') title = clean(content.match(/<td\b[^>]*>\s*제목\s*<\/td>\s*<td\b[^>]*>([\s\S]*?)<\/td>/i)?.[1]) || candidate.title;
  if (source.format==='campus') title = clean(content.match(/<strong class="ui-list__title">([\s\S]*?)<\/strong>/i)?.[1]) || candidate.title;
  const snippet = descriptionOf(html);
  let [start,end] = field(body,eventLabels);
  if (source.format==='campus') {
    start ??= candidate.start;
    end ??= candidate.end;
  }
  let regs = field(body,preciseApplication);
  if (!regs.length) regs = field(body,applicationLabels);
  let deadline = regs.at(-1) ?? candidate.deadline;
  let status = contextualStatus(body);
  if (regs.length>=2 && status!=='closed' && status!=='cancelled') {
    const opens = regs[0];
    const earliest = opens.at ?? Date.parse(opens.day+'T00:00:00Z')-14*3_600_000;
    if (earliest>now) status='upcoming';
  }
  if (source.format==='business' && !start) [start] = field(body,/^(?:일시|Date|Time)\s*:?/i);
  if (source.format==='itfest') {
    if (!start) [start,end] = textDates(body.slice(0,5500));
    // Festival tracks publish individual registration windows on their detail pages.
    if (!deadline) deadline = field(body,/регистрац.{0,15}(?:до|:)|при[её]м заявок|тіркеу мерзімі/i).at(-1);
  }
  if (source.id==='k-startup' && candidate.openHint && status==='unknown') status='open';
  if (source.format==='campus' && /연구\s*체험|참가자 모집/i.test(title) && !deadline && status==='unknown') return null;
  if (source.format==='onoff') {
    const window = bodyText(html.match(/<span class="available">[\s\S]{0,900}/i)?.[0]??'').slice(0,150);
    deadline = textDates(window)[0] ?? deadline;
    if (/신청가능/.test(body) && status==='unknown') status='open';
  }
  const venues = [...body.matchAll(/(?:^|\n)\s*(?:\d\.\s*)?(?:행사장소|이벤트장소|장소|Location|Venue|Where|Место проведения|Өтетін орны)\s*[:：]?\s*(?:\n\s*)?([^\n]{2,120})/gi)].map(x=>x[1]);
  const geo = city(venues.join(' ') || candidate.location || '') ?? city(title);
  const virtual = Boolean(venues.some(venue=>online.test(venue)) ||
    /^(?:format|формат|형태)\s*[:：]\s*(?:fully\s*)?(?:online|онлайн|온라인)/im.test(body));
  const location = virtual ? (geo?geo+' + онлайн':'Онлайн') : geo || null;
  // Search results must have dedicated event markup or labels on an organizer/registration page.
  if (source.adapter==='rss' && !/\b(?:events?|hackathons?|challenge|apply|seminars?)\b|\/p_news_event\d\/|\/notices\/|\/boards\/view\//i.test(new URL(url).pathname)) return null;
  const registerHere = [...content.matchAll(/<a\b([^>]{0,2000})>([\s\S]*?)<\/a\s*>/gi)]
    .filter(x=>register.test(clean(x[2]))).map(x=>({title:clean(x[2]),url:publicUrl(attr(x[1],'href'),url)?.href}))
    .find(x=>x.url && registrationTarget(x.url,url));
  if (status==='unknown' && registerHere && /^(?:apply now|register now|신청하기|접수하기|зарегистрироваться)$/i.test(registerHere.title)) status='open';
  return {title,
    url,description:snippet||body.slice(0,850),location,virtual,start,end,deadline,status,
    apply:status!=='closed'&&registerHere?.url||null,
    authority:source.official?3:host.endsWith('.kaist.ac.kr')?4:1,
  };
}

function registrationTarget(target,base) {
  if (canonical(target)===canonical(base)) return false;
  const url = new URL(target);
  return /(?:^|\.)forms\.gle$|^tally\.so$|^form\.typeform\.com$|^luma\.com$/.test(url.hostname) ||
    /\/(?:forms\/d|register|registration|application|apply|rsvp|ticket|participate)(?:\/|$)/i.test(url.pathname);
}

function definition(html,name) {
  return clean(html.match(new RegExp('<dt\\b[^>]*>\\s*'+name+'\\s*</dt>\\s*<dd\\b[^>]*>([\\s\\S]*?)</dd>','i'))?.[1]);
}

function actualPage(html,url,source,candidate,now) {
  const host = new URL(url).hostname;
  const eventSchemas = structured(html).filter(isEvent);
  const pageTitle = titleKey(meta(html,'og:title')||clean(tag(html,'title')));
  const schema = eventSchemas.find(item=>canonical(publicUrl(item.url??item['@id'],url)?.href)===canonical(url)) ??
    (eventSchemas.length===1 && eventSchemas[0].name && pageTitle.includes(titleKey(eventSchemas[0].name)) ? eventSchemas[0] : null);
  let related = [];
  let event = null;
  if (schema?.startDate || (schema?.endDate && source.format==='aical')) {
    event = fromSchema(schema,html,url,source,now);
    if (host.endsWith('.devpost.com')) {
      const submit = [...html.matchAll(/<time\b[^>]{0,800}>/gi)].find(x=>attr(x[0],'id')==='time-left')?.[0];
      const join = links(html,url).find(x=>attr(x.attrs,'data-main-register-button')==='true' && register.test(x.title) && x.url);
      event.deadline = date(submit&&attr(submit,'datetime'));
      event.deadlineKind = event.deadline ? 'submission' : null;
      if (join && event.status!=='closed' && event.status!=='cancelled') {
        event.apply=join.url;
        event.status='open';
      }
      event.authority = 5;
    } else if (host==='luma.com') {
      const detail = next(html)?.initialData?.data;
      const availability = detail?.registration_availability;
      if (event.status!=='cancelled') {
        if (availability==='open' && !detail.sold_out) event.status='open';
        if (detail?.waitlist_active && (detail?.sold_out || availability==='waitlist')) event.status='waitlist';
        else if (detail?.sold_out || /^(?:closed|sold-out|sold_out|ended)$/.test(availability??'')) event.status='closed';
        if (/^(?:not-started|not_started|coming-soon|upcoming)$/.test(availability??'')) event.status='upcoming';
      }
      const types = detail?.ticket_types?.filter(ticket=>!ticket.is_hidden&&!ticket.is_disabled) ?? [];
      const ends = types.map(ticket=>date(ticket.end_at,ticket.timezone??detail.event?.timezone));
      if (ends.length && ends.every(Boolean)) {
        event.deadline = ends.sort((a,b)=>(b.at??0)-(a.at??0))[0];
      }
      event.apply = event.status==='open' ? url : null;
      event.authority=5;
    } else if (host==='gdg.community.dev') {
      event.authority=5;
    } else if (host==='koreahackathons.com') {
      related = (Array.isArray(schema.offers)?schema.offers:[schema.offers]).flatMap(x=>x?.url??[])
        .filter(link=>publicUrl(link) && canonical(link)!==canonical(url));
      event.authority=2;
    } else if (host==='jams.shippedby.app') {
      if (schema.url && canonical(schema.url)!==canonical(url)) related.push(schema.url);
      // The directory marks listing-only dates. Its generated end-of-day timestamp is not an exact deadline.
      const deadlineLabel = definition(html,'Deadline');
      const listedDay = textDates(deadlineLabel)[0];
      const preciseEnd = date(schema.endDate);
      const deadline = listedDay && preciseEnd && !/date from the listing/i.test(deadlineLabel) &&
        /\((?:UTC|[A-Z]{2,4}[+-]\d{1,2})\)/.test(deadlineLabel) ? preciseEnd : listedDay;
      event.deadline = deadline;
      event.deadlineKind = deadline ? 'submission' : null;
      if (deadline && deadline.at===null) {
        event.start = date(schema.startDate?.slice(0,10));
        event.end = date(schema.endDate?.slice(0,10));
      }
      const status = definition(html,'Status');
      event.status = /^Open$/i.test(status)?'open':/^(?:Closed|Ended)$/i.test(status)?'closed':'unknown';
      event.apply = null;
    } else if (source.format==='aical') {
      const ticket = html.match(/<div class="tk-stub">([\s\S]{1,850}?)<\/div>/i)?.[1]??'';
      const close = clean(ticket.match(/<span class="lbl">([\s\S]*?)<\/span>/i)?.[1]);
      const when = ticket.match(/<time\b[^>]{0,750}>/i)?.[0]??'';
      event.deadline = /^(?:Registration closes|Submissions? close[sd]?)$/i.test(close) ? date(attr(when,'datetime')) : null;
      event.deadlineKind = event.deadline && /submission/i.test(close)?'submission':null;
      event.hack = hack.test(schema.name??'');
      event.apply = null;
      if (schema.location?.url) related.push(schema.location.url);
    } else if (source.format==='apart') {
      const scope = tag(html,'main')||html;
      const text = bodyText(scope);
      if (/\bsubmissions close\b/i.test(text) && /\bAoE\b|Anywhere on Earth/i.test(text) && event.end?.zone==='UTC-12:00') {
        event.deadline = event.end;
        event.deadlineKind = 'submission';
      }
    } else if (event.status==='unknown' && source.official) {
      const parsed = fromText(html,url,source,candidate,now);
      event.apply ??= parsed?.apply??null;
      event.deadline ??= parsed?.deadline??null;
      if (parsed && ['open','closed','waitlist','none','upcoming'].includes(parsed.status)) event.status=parsed.status;
    }
  } else {
    event = fromText(html,url,source,candidate,now);
  }
  if (event) {
    if (source.id==='hackathon-korea' && hack.test(event.title+' '+event.description.slice(0,420))) event.hack = true;
    event.location ??= candidate.location ?? null;
    event.virtual ||= candidate.virtual && /^(?:www\.)?(?:luma\.com|[\w-]+\.devpost\.com|apartresearch\.com)$/.test(host);
    event.hack ||= candidate.kind==='hackathon';
  }
  return {event,related};
}

function organizerSessions(html,base) {
  const out = [];
  for (const block of html.split(/<div class="panel-heading">/).slice(1)) {
    const start = textDates(clean(tag(block,'strong')))[0];
    const title = clean(block.match(/<p>\s*<strong>Title<\/strong>\s*<\/p>\s*<p>([\s\S]*?)<\/p>/i)?.[1]);
    if (!start || !title) continue;
    const description = clean(block.match(/<strong>Abstract<\/strong>\s*<\/p>\s*<p[^>]*>([\s\S]*?)<\/p>/i)?.[1]);
    // A text fragment takes the reader to the named session on the organizer's program.
    const url = base+'#:~:text='+encodeURIComponent(title).replace(/-/g,'%2D');
    const venue = clean(html.match(/(?:Place|Venue)\s*:\s*([^<]{4,180})/i)?.[1]);
    const virtual = /\(Online\)/i.test(clean(block.match(/<strong>Language<\/strong>\s*<\/p>\s*<p[^>]*>([\s\S]*?)<\/p>/i)?.[1]));
    out.push({title,url,start,description,location:virtual?'Онлайн':city(venue||html.slice(0,4200)),virtual,status:'unknown'});
  }
  return out;
}

function accelerator(html,url,now) {
  const content = tag(html,'article');
  const lines = bodyText(content);
  const batch = lines.match(/accepting applications for the ([A-Za-z]+ 20\d{2}) Batch/i)?.[1];
  if (!batch) return [];
  const link = links(content,url).find(x=>x.url && new URL(x.url).hostname==='apply.ycombinator.com');
  const period = field(lines,/(?:on-time deadline|deadline to apply|apply by)/i);
  const late = /(?:you can still apply|accept(?:ing)? late applications|late applications)/i.test(lines);
  const deadline = period[0];
  const missed = Boolean(deadline && (deadline.at??Date.parse(deadline.day+'T23:59:59Z'))<=now);
  // The deadline published for an on-time decision does not close late applications.
  return [{title:'Y Combinator · '+batch+' Batch',url,apply:link?.url??null,
    description:lines.slice(0,800),location:/San Francisco/i.test(lines)?'Сан-Франциско · заявка онлайн':null,
    deadline:missed&&late?null:deadline,remoteApply:Boolean(link),status:link&&(!missed||late)?'open':'unknown'}];
}

const MAX_FETCHES = 45;
const MAX_BYTES = 1_750_000;
const CONCURRENCY = 5;
async function readPage(fetcher,url,budget) {
  let nextUrl = publicUrl(url);
  for (let redirects=0;nextUrl && redirects<4;redirects++) {
    if (budget.used>=MAX_FETCHES) throw new Error('request budget exhausted');
    budget.used++;
    const response = await fetcher(nextUrl.href,{
      signal:AbortSignal.timeout(6500),redirect:'manual',
    });
    if ([301,302,303,307,308].includes(response.status)) {
      nextUrl = publicUrl(response.headers.get('location'),nextUrl);
      await response.body?.cancel();
      if (!nextUrl) throw new Error('invalid redirect');
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('HTTP '+response.status);
    }
    if (Number(response.headers.get('content-length'))>MAX_BYTES) {
      await response.body?.cancel();
      throw new Error('response too large');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('empty response');
    let size = 0, html = '';
    const decoder = new TextDecoder();
    for (;;) {
      const {done,value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size>MAX_BYTES) {
        await reader.cancel();
        throw new Error('response too large');
      }
      html += decoder.decode(value,{stream:true});
    }
    return {html:html+decoder.decode(),finalUrl:nextUrl.href};
  }
  throw new Error('redirect limit');
}

async function limited(items,callback) {
  let nextIndex = 0;
  const result = [];
  await Promise.all(Array.from({length:Math.min(items.length,CONCURRENCY)},async()=>{
    for (;;) {
      const index = nextIndex++;
      if (index>=items.length) return;
      result[index] = await callback(items[index]);
    }
  }));
  return result;
}

export async function scanRegion(region,{now=Date.now(), sources=registry[region], previous=[], fetcher=fetch, log=console}={}) {
  const budget = {used:0};
  const failures = new Set();
  const events = [];
  const seen = new Set();
  const fail = (source,error)=>{
    failures.add(source.id);
    log.warn('Radar source',region,source.id,error.message);
  };
  const listings = await limited(sources,async source=>{
    try {
      const {html,finalUrl} = await readPage(fetcher,source.url,budget);
      if (source.adapter==='computing' || source.adapter==='yc') {
        const records = source.adapter==='yc'?accelerator(html,finalUrl,now):organizerSessions(html,finalUrl);
        for (const record of records) {
          const opportunity = eventReady(region,source,record,null,now);
          if (opportunity) events.push(opportunity);
        }
        return {source,candidates:[]};
      }
      return {source,candidates:candidatesFor(source,html,finalUrl,region,now)};
    } catch(error) {
      fail(source,error);
      return {source,candidates:[]};
    }
  });

  const candidates = [];
  // Round-robin preserves representation when several busy listings share the fetch budget.
  for (let offset=0;offset<Math.max(0,...listings.map(x=>x.candidates.length));offset++) {
    for (const {source,candidates:entries} of listings) {
      const entry = entries[offset];
      const key = canonical(entry?.url);
      if (!key||seen.has(key)) continue;
      candidates.push({source,entry});
      seen.add(key);
    }
  }
  const revisits = [];
  for (const entry of previous) {
    const source = sources.find(item=>item.id===entry.source);
    const key = canonical(entry.url);
    if (!source || !key || seen.has(key) || ['yc','computing'].includes(source.adapter)) continue;
    revisits.push({source,entry});
    seen.add(key);
    if (revisits.length>=3) break;
  }
  const eventLimit = Math.max(0,MAX_FETCHES-budget.used-6);
  const detailJobs = [...candidates.slice(0,sources.length),...revisits,...candidates.slice(sources.length)];
  const related = [];
  await limited(detailJobs.slice(0,eventLimit),async ({source,entry})=>{
    try {
      const {html,finalUrl} = await readPage(fetcher,entry.url,budget);
      const result = actualPage(html,finalUrl,source,entry,now);
      if (result.event) {
        const event = eventReady(region,source,result.event,{aliases:[entry.url,...result.related]},now);
        if (event) events.push(event);
      }
      for (const url of result.related.slice(0,1)) {
        const key = canonical(url);
        if (!key||seen.has(key)) continue;
        related.push({source,entry:{...entry,url,aliases:[entry.url,finalUrl]}});
        seen.add(key);
      }
    } catch(error) {
      fail(source,error);
    }
  });
  await limited(related.slice(0,Math.max(0,MAX_FETCHES-budget.used)),async ({source,entry})=>{
    try {
      const {html,finalUrl} = await readPage(fetcher,entry.url,budget);
      const {event} = actualPage(html,finalUrl,source,entry,now);
      const card = event && eventReady(region,source,event,entry,now);
      if (card) events.push(card);
    } catch(error) {
      fail(source,error);
    }
  });
  const merged = mergeEvents(events).sort((a,b)=>rank(b,now)-rank(a,now));
  // Keep closure evidence so a stale mirror in a different direction cannot reopen an event.
  const live = merged.filter(event=>active(event,now)).slice(0,45);
  const closures = merged.filter(event=>['closed','cancelled'].includes(event.status) ||
    event.deadline && !active({...event,end:null,start:null},now)).slice(0,30);
  log.info?.('Radar scan',region,'fetches',budget.used,'sources',sources.length,'active',live.length,'failed',failures.size);
  return {events:live,closures,incomplete:failures.size>0,failed:[...failures],requests:budget.used};
}

export async function verifyApplicationLinks(scan,{fetcher=fetch,log=console}={}) {
  const budget = {used:0};
  const targets = scan.events.filter(event=>event.apply && canonical(event.apply)!==canonical(event.url));
  const closedForms = [];
  await limited(targets,async event=>{
    try {
      const form = await readPage(fetcher,event.apply,budget);
      const host = new URL(form.finalUrl).hostname;
      if (!/^(?:docs\.google\.com|tally\.so)$/.test(host)) return;
      if (/no longer accepting responses|not accepting responses|форма больше не принимает ответы|더 이상 응답을 받지/i.test(form.html)) {
        event.status = 'closed';
        event.authority = Math.max(event.authority,5);
        closedForms.push(event);
      } else if (event.status==='unknown' && /<form\b[^>]*action=["'][^"']*formResponse/i.test(form.html)) {
        event.status = 'open';
      }
    } catch(error) {
      event.apply = null;
      log.warn('Radar application link',event.source,error.message);
    }
  });
  return {
    ...scan,
    events:scan.events.filter(event=>event.status!=='closed'),
    closures:[...scan.closures,...closedForms],
    applicationRequests:budget.used,
  };
}
