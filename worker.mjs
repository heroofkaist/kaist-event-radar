import {active, DAY, mergeEvents, regions, seoulDay, updateHistory, urgent} from './radar.mjs';
import {buttonCommands, dailySelection, keyboard, messages, select} from './telegram.mjs';
import {scanRegion,verifyApplicationLinks} from './sources.mjs';

const storeName = 'daily-radar';
const snapshotKey = 'snapshot-v1';
const pageSize = 8;
const maximumAttempts = 5;
const commands = new Set(Object.values(buttonCommands));

async function telegram(env,method,payload) {
  let response;
  try {
    response = await fetch('https://api.telegram.org/bot'+env.TELEGRAM_BOT_TOKEN+'/'+method,{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),
      signal:AbortSignal.timeout(6500),redirect:'manual',
    });
  } catch {
    throw new Error('Telegram '+method+' connection failed');
  }
  const result = await response.json().catch(()=>null);
  if (!response.ok || !result?.ok) {
    throw new Error('Telegram '+method+' HTTP '+response.status+' API '+(result?.error_code??'unknown'));
  }
  return result.result;
}

export async function webhookSecret(token) {
  if (!token) return null;
  const bytes = new TextEncoder().encode('event-radar:webhook:v1:'+token);
  const hash = await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(hash)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

function send(env,chat,message) {
  const {cards,...payload} = message;
  return telegram(env,'sendMessage',{chat_id:chat,link_preview_options:{is_disabled:true},...payload});
}

function stub(env,name) {
  const ns = env.RADAR;
  return ns.get(ns.idFromName(name));
}

function requestObject(env,name,path,payload) {
  return stub(env,name).fetch('https://radar.internal/'+path,{
    method:'POST',body:JSON.stringify(payload),headers:{'content-type':'application/json'},
  }).then(response=>{
    if (!response.ok) throw new Error('Radar '+path+' HTTP '+response.status);
    return response;
  });
}

function emptyState() {
  return {scans:{},history:{},events:[],date:null,incomplete:true,delivery:null};
}

export function buildSnapshot(oldState,scans,now) {
  const state = {...oldState,scans:{...oldState.scans},date:seoulDay(now)};
  for (const region of regions) {
    const previous = state.scans[region];
    const current = scans[region];
    if (!current) {
      if (previous) state.scans[region] = {...previous,events:previous.events.map(event=>({...event,stale:true}))};
      continue;
    }
    const prior = previous?.events ?? [];
    const retain = current.incomplete ? prior.filter(event=>current.failed.includes(event.source) &&
      now-(event.verifiedAt ?? previous.time)<3*DAY).map(event=>({...event,stale:true})) : [];
    const seenNow = [...current.events,...current.closures].map(event=>({...event,verifiedAt:now}));
    state.scans[region] = {
      time:now,incomplete:current.incomplete,
      events:mergeEvents([...seenNow,...retain]),
    };
  }
  state.incomplete = regions.some(region=>state.scans[region]?.time!==now || state.scans[region].incomplete);
  const fresh = Object.values(state.scans).filter(scan=>now-scan.time<3*DAY);
  const events = mergeEvents(fresh.flatMap(scan=>scan.events.filter(event=>now-(event.verifiedAt??scan.time)<3*DAY))).filter(event=>active(event,now));
  const updates = updateHistory(events,oldState.history,now);
  state.events = select(updates.events,'/scan',now).slice(0,160);
  state.history = updates.history;
  return state;
}

function owner(env) {
  return String(env.OWNER_CHAT_ID??'').trim();
}

export class RadarStore {
  constructor(ctx,env) {
    this.ctx = ctx;
    this.env = env;
    this.delivery = null;
  }

  async fetch(request) {
    const activity = new URL(request.url).pathname;
    const input = await request.json();
    if (activity==='/region' && regions.includes(input.region)) {
      const scan = await scanRegion(input.region,{now:input.now,previous:input.previous});
      try {
        return await requestObject(this.env,'links-'+input.region,'links',scan);
      } catch(error) {
        console.warn('Radar application checks',input.region,error.message);
        for (const event of scan.events) {
          if (event.apply!==event.url) event.apply = null;
        }
        return Response.json(scan);
      }
    }
    if (activity==='/links') {
      return Response.json(await verifyApplicationLinks(input));
    }
    if (activity==='/prior') {
      const snapshot = await this.ctx.storage.get(snapshotKey);
      const candidates = {};
      for (const region of regions) {
        const scan = snapshot?.scans[region];
        if (scan && input.now-scan.time<3*DAY) {
          candidates[region] = select(scan.events,'/scan',input.now).slice(0,12).map(event=>({
            url:event.url,title:event.title,source:event.source,location:event.location,
          }));
        }
      }
      return Response.json(candidates);
    }
    if (activity==='/publish') {
      await this.publish(input);
      return new Response('OK');
    }
    if (activity==='/reply') {
      await this.reply(input);
      return new Response('OK');
    }
    return new Response(null,{status:404});
  }

  async publish({scans,now}) {
    await this.ctx.blockConcurrencyWhile(async()=>{
      const previous = await this.ctx.storage.get(snapshotKey) ?? emptyState();
      if (previous.date && previous.date>=seoulDay(now)) return;
      const state = buildSnapshot(previous,scans,now);
      const cards = dailySelection(state.events,now);
      const batches = messages(cards,{now,incomplete:state.incomplete});
      if (cards.length) {
        batches.at(-1).reply_markup.inline_keyboard.push([{text:'Все возможности',callback_data:'radar:/scan:0'}]);
      }
      state.delivery = {now,next:0,attempts:0,batches};
      if (owner(this.env)) await this.ctx.storage.setAlarm(Date.now()+90_000);
      await this.ctx.storage.put(snapshotKey,state);
    });
    return this.deliver();
  }

  async alarm() {
    return this.deliver();
  }

  async deliver() {
    if (this.delivery) return this.delivery;
    this.delivery = this.sendPending().finally(()=>{this.delivery=null;});
    return this.delivery;
  }

  async sendPending() {
    const chat = owner(this.env);
    if (!chat || !this.env.TELEGRAM_BOT_TOKEN) return;
    const snapshot = await this.ctx.storage.get(snapshotKey);
    const job = snapshot?.delivery;
    if (!job || job.next>=job.batches.length || Date.now()-job.now>DAY ||
      job.attempts>=maximumAttempts) return;
    try {
      for (;job.next<job.batches.length;) {
        const batch = job.batches[job.next];
        await send(this.env,chat,batch);
        const sent = new Set(batch.cards??[]);
        for (const event of snapshot.events.filter(card=>sent.has(card.key))) {
          const record = snapshot.history[event.key];
          record.shown = job.now;
          record.notified = urgent(event,job.now);
          record.pending = null;
          event.shown = record.shown;
          event.notified = record.notified;
        }
        job.next++;
        await this.ctx.storage.put(snapshotKey,snapshot);
        console.info('Telegram accepted digest batch',job.next);
      }
    } catch(error) {
      console.warn(error.message);
      job.attempts++;
      await this.ctx.storage.put(snapshotKey,snapshot);
      if (job.attempts<maximumAttempts) await this.ctx.storage.setAlarm(Date.now()+job.attempts*90_000);
    }
  }

  async reply({command,page=0}) {
    const state = await this.ctx.storage.get(snapshotKey) ?? emptyState();
    const now = Date.now();
    const items = select(state.events,command,now);
    const start = Math.min(page*pageSize,Math.max(0,Math.ceil(items.length/pageSize)-1)*pageSize);
    const more = commands.has(command) && items.length>start+pageSize ? 'radar:'+command+':'+(Math.floor(start/pageSize)+1) : null;
    const incomplete = state.incomplete || state.date!==seoulDay(now);
    for (const message of messages(items.slice(start,start+pageSize),{now,command,incomplete,more})) {
      await send(this.env,owner(this.env),message);
    }
  }
}

async function handleUpdate(env,update) {
  const callback = update?.callback_query;
  if (callback) {
    const chat = callback.message?.chat;
    const route = /^radar:(\/[a-z]+):(\d{1,2})$/.exec(callback.data??'');
    if (chat?.type!=='private' || String(chat.id)!==owner(env) || String(callback.from?.id)!==owner(env) ||
      !route || !commands.has(route[1])) return;
    await telegram(env,'answerCallbackQuery',{callback_query_id:callback.id});
    await requestObject(env,storeName,'reply',{command:route[1],page:Number(route[2])});
    return;
  }
  const message = update?.message;
  const chat = message?.chat;
  if (chat?.type!=='private' || typeof message.text!=='string') return;
  const text = message.text.trim();
  const command = buttonCommands[text] ?? text.replace(/^(\/[a-z]+)@[a-z0-9_]+$/i,'$1');
  if (command==='/id') return send(env,chat.id,{text:String(chat.id)});
  if (String(chat.id)!==owner(env)) return;
  if (command==='/start' || command==='/help') {
    return send(env,chat.id,{
      text:'KAIST Event Radar · ежедневно в 09:00 KST\n/kaist · /korea · /kz · /online\n/scan · /deadlines · /hackathons · /startups',
      reply_markup:keyboard,
    });
  }
  if (!command) return;
  await requestObject(env,storeName,'reply',{command:command.slice(0,150)});
}

export async function scheduledRun(env,now=Date.now()) {
  const scans = {};
  let previous = {};
  try {
    previous = await (await requestObject(env,storeName,'prior',{now})).json();
  } catch(error) {
    console.warn('Radar previous snapshot',error.message);
  }
  await Promise.all(regions.map(async region=>{
    try {
      const response = await requestObject(env,'scan-'+region,'region',{region,now,previous:previous[region]});
      scans[region] = await response.json();
    } catch(error) {
      console.warn('Radar region',region,error.message);
    }
  }));
  await requestObject(env,storeName,'publish',{scans,now});
}

export default {
  async fetch(request,env,ctx) {
    const {pathname} = new URL(request.url);
    if (pathname==='/' && request.method==='GET') return new Response('Event Radar');
    if (pathname!=='/telegram' || request.method!=='POST') return new Response(null,{status:404});
    const secret = await webhookSecret(env.TELEGRAM_BOT_TOKEN);
    if (!secret || request.headers.get('X-Telegram-Bot-Api-Secret-Token')!==secret) {
      return new Response(null,{status:403});
    }
    const update = await request.json().catch(()=>null);
    ctx.waitUntil(handleUpdate(env,update).catch(error=>console.warn('Radar reply',error.message)));
    return new Response('OK');
  },
  async scheduled(event,env) {
    await scheduledRun(env,event.scheduledTime);
  },
};
