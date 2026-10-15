import fs from 'node:fs';
import { Wad } from '../src/wad/wad.js';
import { parseMus, MUS_TICKS_PER_SEC } from '../src/audio/music.js';
import { decodeDmx, spatialize } from '../src/audio/sound.js';
const b = fs.readFileSync(new URL('../public/wad/DOOM1.WAD', import.meta.url));
const wad = new Wad(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
for (const l of wad.lumps.filter((x) => x.name.startsWith('D_'))) {
  const song = parseMus(wad.getLump(l.name));
  if (!song) { console.log(l.name, 'FAIL 파싱'); continue; }
  const on = song.events.filter((e) => e.type === 'on'), off = song.events.filter((e) => e.type === 'off');
  const progs = new Set(song.events.filter((e) => e.type === 'ctrl' && e.ctrl === 0).map((e) => e.value));
  const notes = on.map((e) => e.note), chans = new Set(song.events.map((e) => e.ch));
  const drums = on.filter((e) => e.ch === 15).length;
  console.log(l.name.padEnd(9), `${(song.length / MUS_TICKS_PER_SEC).toFixed(1)}초`.padStart(8), `이벤트 ${String(song.events.length).padStart(5)}  음 ${String(on.length).padStart(5)}/끄기 ${String(off.length).padStart(5)}  타악 ${String(drums).padStart(4)}  악기 ${[...progs].join(',')}  채널 ${chans.size}  음역 ${Math.min(...notes)}~${Math.max(...notes)}`);
}
// 효과음 변환: 55개 전부
let ok = 0, bad = [];
for (const l of wad.lumps.filter((x) => x.name.startsWith('DS'))) { const d = decodeDmx(wad.getLump(l.name)); if (d && d.samples.length > 100 && d.rate === 11025) ok++; else bad.push(l.name); }
console.log('효과음 변환 성공', ok, '실패', bad.join(' ') || '없음');
console.log('거리 감쇠: 가까움', JSON.stringify(spatialize({x:100,y:0},{x:0,y:0,angle:0})), '중간', JSON.stringify(spatialize({x:700,y:0},{x:0,y:0,angle:0})), '멀리', JSON.stringify(spatialize({x:1300,y:0},{x:0,y:0,angle:0})));
console.log('좌우: 왼쪽(위, +y)', spatialize({x:0,y:300},{x:0,y:0,angle:0}).pan.toFixed(2), '오른쪽(아래)', spatialize({x:0,y:-300},{x:0,y:0,angle:0}).pan.toFixed(2));
