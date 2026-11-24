import test from 'node:test';
import assert from 'node:assert/strict';
import { date, active, mergeEvents, updateHistory, urgent } from '../radar.mjs';
import { messages, select } from '../telegram.mjs';
import { scanRegion } from '../sources.mjs';

const now = Date.parse('2026-11-24T14:00:00Z');
const event = (fields = {}) => ({
  title: 'Quantum hardware hackathon', url: 'https://demo.example/event/42',
  regions: ['kaist'], kinds: ['hackathon'], status: 'unknown',
  start: date('2026-11-26'), why: 'Собрать прототип квантового устройства.',
  ...fields,
});

test('offset and civil dates stay distinct, including invalid and DST-ambiguous times', () => {
  assert.equal(date('2026-11-26T15:00:00+05:00').at, Date.parse('2026-11-26T10:00:00Z'));
  assert.equal(date('2026-11-26T15:00').at, null);
  assert.equal(date('2026-11-26T15:00:00Z', 'Asia/Almaty').day, '2026-11-26');
  assert.equal(date('2026-02-30'), null);
  assert.equal(date('2026-11-01T01:30','America/New_York').at, null);
  assert.equal(date('2026-03-08T02:30','America/New_York').at, null);
  assert.equal(date('2026-11-01T03:30','America/New_York').at, Date.parse('2026-11-01T08:30Z'));
  assert.equal(urgent(event({deadline: date('2026-11-24T23:30:00+09:00')}), now), 'today');
  assert.equal(urgent(event({deadline: date('2026-11-27T23:00:00+09:00')}), now), 'soon');
  assert.equal(urgent(event({deadline: date('2026-11-25T04:00')}), now), null);
});

test('past events, closed applications and undated headlines are excluded', () => {
  assert.equal(active(event({status:'closed'}), now),false);
  assert.equal(active(event({start:date('2026-11-21')}), now),false);
  assert.equal(active(event({deadline:date('2026-11-21')}), now),false);
  assert.equal(active(event({start:null}), now),false);
  assert.equal(active(event({start:date('2026-11-23'),end:date('2026-11-27')}), now),true);
});

test('same registration, canonical tracking URL and near-identical title merge transitively', () => {
  const merged = mergeEvents([
    event({url:'https://other.example/event/42',title:'Quantum Hardware Hackathon 2026',regions:['online'],apply:'https://form.example/apply?id=61'}),
    event({url:'https://demo.example/event/42?utm_source=x',apply:'https://form.example/apply?id=61',status:'open'}),
    event({regions:['korea'],status:'closed',authority:5}),
    event({title:'Quantum hardware hackathon',url:'https://another.example/event/71',start:date('2027-06-26')}),
  ]);
  assert.equal(merged.length,2);
  assert.deepEqual(new Set(merged[0].regions),new Set(['kaist','online','korea']));
  assert.equal(merged[0].status,'closed');
});

test('tracks repeated cards and detects changed deadlines and event dates', () => {
  const first = event({deadline:date('2026-11-25T16:00:00Z')});
  const prev = updateHistory([first], {}, now).history;
  const shown = Object.fromEntries(Object.entries(prev).map(([key, entry]) => [key,{...entry,shown:now,pending:null}]));
  const again = updateHistory([first],shown,now+1000).events[0];
  assert.equal(again.change,null);
  assert.equal(again.shown,now);
  const changed = updateHistory([event({deadline:date('2026-11-27T16:00:00Z'), start:date('2026-11-28')})],shown,now+1000).events[0];
  assert.equal(changed.change,'dates');
});

test('themes are strict, URL buttons are actionable and messages split at card boundaries', () => {
  const hot = event({title:'A < B & C',deadline:date('2026-11-24T23:30:00+09:00'),apply:'https://demo.example/apply?a=1&b=2',status:'open'});
  const meetup = event({title:'Meetup',kinds:['tech'],url:'https://demo.example/event/43'});
  const startup = event({title:'Seed grant',kinds:['startup'],url:'https://demo.example/event/44'});
  const items = [hot, meetup, startup];
  assert.deepEqual(select(items,'/deadlines',now),[hot]);
  assert.deepEqual(select(items,'/hackathons',now),[hot]);
  assert.deepEqual(select(items,'/startups',now),[startup]);
  const result = messages([hot, ...Array.from({length:30},(_,i)=>event({
    title:'Карточка '+i+' 💡'.repeat(95),url:'https://demo.example/event/x'+i,
    why:'Проект '.repeat(40),
  }))],{now,incomplete:true});
  assert.ok(result.length>1);
  assert.match(result[0].text,/^<b>Подать заявку сегодня/);
  assert.match(result[0].text,/A &lt; B &amp; C/);
  assert.equal(result[0].reply_markup.inline_keyboard[0][0].url,hot.apply);
  assert.equal(result.map(x=>x.text).join().match(/Источники проверены частично/g).length,1);
  for(const message of result) {
    assert.ok(message.text.length<=3900);
    assert.equal((message.text.match(/<b>/g)??[]).length,(message.text.match(/<\/b>/g)??[]).length);
    assert.ok(message.reply_markup.inline_keyboard.every(row=>row.length===1));
  }
});

test('an independent source still yields verified events when another source fails and Gemini is absent', async () => {
  const source = (id) => ({id, url:'https://example.com/'+id, adapter:'schema', official:true});
  const json = { '@type':'ItemList', itemListElement:[{item:{'@type':'Event',name:'Quantum seminar',url:'https://example.com/quantum',startDate:'2026-11-28T10:00:00+09:00'}}]};
  const result = await scanRegion('kaist',{ now, sources:[source('good'),source('bad')], fetcher:async url=>{
    if(url.endsWith('/bad')) return new Response('',{status:503});
    return new Response('<title>Quantum seminar</title><script type="application/ld+json">'+JSON.stringify(url.endsWith('/quantum')?json.itemListElement[0].item:json)+'</script>');
  }});
  assert.deepEqual(result.events.map(x=>x.title),['Quantum seminar']);
  assert.equal(result.incomplete,true);
});

test('failed direct registration links fall back to announcements and closed forms suppress cards', async () => {
  const {verifyApplicationLinks} = await import('../sources.mjs');
  const invalid = event({apply:'https://example.com/registration'});
  const closed = event({url:'https://example.com/2', apply:'https://docs.google.com/forms/d/abc'});
  const result = await verifyApplicationLinks({events:[invalid,closed],closures:[]},{
    fetcher:async url=>url===invalid.apply ?
      new Response(null,{status:403}) : new Response('This form is no longer accepting responses'),
    log:{warn(){}},
  });
  assert.equal(result.events[0].apply,null);
  assert.equal(result.closures[0].status,'closed');
  const [message] = messages(result.events,{now});
  assert.equal(message.reply_markup.inline_keyboard[0][0].url,invalid.url);
  assert.match(message.reply_markup.inline_keyboard[0][0].text,/Открыть анонс/);
});
