import test from 'node:test';
import assert from 'node:assert/strict';
import worker, {buildSnapshot, RadarStore, webhookSecret} from '../worker.mjs';
import {date, DAY} from '../radar.mjs';

const now = Date.now();
const tomorrow = date(new Date(now+DAY).toISOString());
const upcoming = (i,kinds,source='feed')=>({
  title:'Opportunity '+i,url:'https://example.com/event/'+i,location:'Онлайн',
  start:tomorrow,end:null,deadline:null,status:'open',why:'Проверить условия участия.',
  kinds,regions:['online'],authority:3,source,
});
const scan = (events=[],options={})=>({events,closures:[],incomplete:false,failed:[],...options});
const empty = {scans:{},history:{},events:[],date:null};
const every = online=>({kaist:scan(),korea:scan(),kz:scan(),online});

test('partially failed regions retain only current records from unavailable sources', () => {
  const failed = {...upcoming(1,['tech'],'failed'),start:date(new Date(now+10*DAY).toISOString())};
  const working = upcoming(2,['tech'],'working');
  const first = buildSnapshot(empty,every(scan([failed,working])),now);
  const next = buildSnapshot(first,every(scan([],{
    incomplete:true,failed:['failed'],
  })),now+3000);
  assert.equal(next.incomplete,true);
  assert.deepEqual(next.events.map(x=>x.title),[failed.title]);
  const repeated = buildSnapshot(next,every(scan([],{incomplete:true,failed:['failed']})),now+2*DAY);
  assert.equal(repeated.events.length,1);
  const resumed = buildSnapshot(repeated,every(scan([],{
    incomplete:true,failed:['failed'],
  })),now+4*DAY);
  assert.equal(resumed.events.length,0);
});

test('a closure on an official source suppresses the same active event on a mirror', () => {
  const listing = upcoming(1,['hackathon']);
  const closure = {...listing,regions:['korea'],status:'closed',authority:5};
  const snapshot = buildSnapshot(empty,{...every(scan([listing])),korea:scan([],{closures:[closure]})},now);
  assert.equal(snapshot.events.length,0);
});

function fakeRadar(token='synthetic-worker-test-token') {
  const env = {TELEGRAM_BOT_TOKEN:token,OWNER_CHAT_ID:'41'};
  const responses = [];
  const state = new Map();
  const store = new RadarStore({
    blockConcurrencyWhile: callback=>callback(),
    storage:{get:async key=>structuredClone(state.get(key)),put:async (key,value)=>state.set(key,structuredClone(value)),setAlarm:async ()=>{}},
  },env);
  env.RADAR = {idFromName:name=>name,get:()=>({fetch:(url,options)=>store.fetch(new Request(url,options))})};
  const api = async (url,options)=>{
    assert.equal(new URL(url).hostname,'api.telegram.org');
    responses.push({method:new URL(url).pathname.split('/').pop(),...JSON.parse(options.body)});
    return Response.json({ok:true,result:{message_id:responses.length}});
  };
  return {env,store,api,responses};
}

test('Telegram keyboard, owner check and pagination use the actual webhook handler without Gemini', async t=>{
  const {store,env,api,responses} = fakeRadar();
  t.mock.method(globalThis,'fetch',api);
  const opportunities = [
    ...Array.from({length:9},(_,i)=>upcoming(i,['hackathon'])),
    upcoming(9,['startup']),
  ];
  await store.publish({scans:every(scan(opportunities)),now});
  responses.length=0;
  async function sendUpdate(update,authorized=true) {
    const tasks = [];
    const result = await worker.fetch(new Request('https://radar.example/telegram',{
      method:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':authorized?await webhookSecret(env.TELEGRAM_BOT_TOKEN):'bad'},
      body:JSON.stringify(update),
    }),env,{waitUntil:promise=>tasks.push(promise)});
    await Promise.all(tasks);
    return result.status;
  }
  const privateMessage = (text,id=41)=>({message:{text,chat:{id,type:'private'}}});
  assert.equal(await sendUpdate(privateMessage('/start'),false),403);
  await sendUpdate(privateMessage('/start',42));
  assert.equal(responses.length,0);
  await sendUpdate(privateMessage('/start'));
  assert.deepEqual(responses[0].reply_markup.keyboard[2],['⚡ Хакатоны','🚀 Стартапы']);
  await sendUpdate(privateMessage('⚡ Хакатоны'));
  const hacks = responses.at(-1);
  assert.match(hacks.text,/Хакатоны/);
  assert.doesNotMatch(hacks.text,/Opportunity 9/);
  const more = hacks.reply_markup.inline_keyboard.at(-1)[0].callback_data;
  assert.equal(more,'radar:/hackathons:1');
  await sendUpdate({callback_query:{id:'x',data:more,from:{id:41},message:{chat:{id:41,type:'private'}}}});
  assert.equal(responses.at(-2).method,'answerCallbackQuery');
  assert.match(responses.at(-1).text,/Opportunity 8/);
  await sendUpdate(privateMessage('🚀 Стартапы'));
  assert.match(responses.at(-1).text,/Opportunity 9/);
  await sendUpdate(privateMessage('📅 Дедлайны'));
  assert.equal(responses.at(-1).text,'Подходящих возможностей пока нет.');
});

test('a Telegram failure keeps delivery pending and an alarm retries without replaying success', async t=>{
  const {store,api,responses} = fakeRadar();
  let first = true;
  t.mock.method(globalThis,'fetch',async (url,options)=>{
    if (first) {
      first = false;
      return Response.json({ok:false,error_code:503},{status:503});
    }
    return api(url,options);
  });
  await store.publish({scans:every(scan([upcoming(1,['tech'])])),now});
  assert.equal(responses.length,0);
  await store.alarm();
  await store.alarm();
  assert.equal(responses.length,1);
  await store.publish({scans:every(scan([upcoming(1,['tech'])])),now});
  assert.equal(responses.length,1);
});
