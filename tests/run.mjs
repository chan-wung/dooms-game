/**
 * 전체 테스트 실행: 각 스크립트의 출력에 FAIL/ERROR 가 있으면 실패로 끝낸다.
 * 사용: npm test  (public/wad/DOOM1.WAD 가 필요하다)
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../public/wad/DOOM1.WAD', import.meta.url))) {
  console.error('public/wad/DOOM1.WAD 가 없어 테스트를 건너뜁니다.');
  process.exit(0);
}

const suites = ['things', 'movement', 'combat', 'skill', 'save', 'audio', 'render'];
let failed = 0;
for (const name of suites) {
  const r = spawnSync(process.execPath, [new URL(`./${name}.mjs`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')], { encoding: 'utf8', timeout: 600000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const pass = (out.match(/^PASS/gm) || []).length;
  const bad = out.split('\n').filter((l) => /^FAIL|ERROR|Error:/.test(l));
  console.log(`${bad.length || r.status ? '✘' : '✔'} ${name.padEnd(9)} PASS ${pass}${bad.length ? `  FAIL ${bad.length}` : ''}`);
  for (const l of bad) console.log('    ' + l);
  if (bad.length || r.status) failed++;
}
process.exit(failed ? 1 : 0);
