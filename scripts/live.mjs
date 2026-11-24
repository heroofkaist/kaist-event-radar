import { writeFile } from 'node:fs/promises';
import { scanRegion, verifyApplicationLinks } from '../sources.mjs';
import { active, mergeEvents, regions, updateHistory } from '../radar.mjs';
import { dailySelection, messages } from '../telegram.mjs';

const now = process.env.RADAR_NOW ? Date.parse(process.env.RADAR_NOW) : Date.now();
if (!Number.isFinite(now)) throw new Error('RADAR_NOW must be an ISO timestamp');
const scans = {};
for (const region of regions) scans[region] = await verifyApplicationLinks(await scanRegion(region,{now}));
const events = mergeEvents(Object.values(scans).flatMap(x=>[...x.events,...x.closures])).filter(event=>active(event,now));
const counts = Object.fromEntries(regions.map(region=>[region,events.filter(event=>event.regions.includes(region)).length]));
const history = updateHistory(events,{},now).events;
const digest = messages(dailySelection(history,now),{now,incomplete:Object.values(scans).some(scan=>scan.incomplete)});
const result = {asOf:new Date(now).toISOString(),unique:events.length,counts,scans,events,digest};
if (process.argv[2]) await writeFile(process.argv[2],JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({asOf:result.asOf,unique:events.length,counts,digest},null,2));
