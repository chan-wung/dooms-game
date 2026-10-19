/**
 * 번역: 한국어·영어 사전의 키가 같은지, 치환·대체 동작, 엔딩 이야기가 화면에 들어가는 길이인지 확인한다.
 * WAD 가 필요 없다.
 */
import { t, setLang, getLang, dictKeys, dictValue } from '../src/app/i18n.js';

const out = []; const ok = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`);

const en = new Set(dictKeys('en')), ko = new Set(dictKeys('ko'));
const onlyEn = [...en].filter((k) => !ko.has(k)), onlyKo = [...ko].filter((k) => !en.has(k));
ok('사전: 영어에만 있는 키 없음', onlyEn.length === 0, onlyEn.join(','));
ok('사전: 한국어에만 있는 키 없음', onlyKo.length === 0, onlyKo.join(','));

const sameShape = [...en].filter((k) => Array.isArray(dictValue('en', k)) !== Array.isArray(dictValue('ko', k)));
ok('사전: 배열 문구는 두 언어 모두 배열', sameShape.length === 0, sameShape.join(','));

const vars = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join();
const badVars = [...en].filter((k) => !Array.isArray(dictValue('en', k)) && vars(dictValue('en', k)) !== vars(dictValue('ko', k)));
ok('사전: {변수} 가 두 언어에서 같음', badVars.length === 0, badVars.join(','));

ok('기본 언어는 영어', getLang() === 'en' && t('menu.resume') === 'RESUME');
setLang('ko');
ok('한국어로 전환', getLang() === 'ko' && t('menu.resume') === '계속하기');
setLang('xx');
ok('모르는 언어는 무시', getLang() === 'ko');
ok('변수 치환', t('menu.map', { name: 'E1M1' }) === '맵  < E1M1 >');
ok('없는 키는 키 그대로', t('no.such.key') === 'no.such.key');
setLang('en');
ok('영어 치환', t('game.needKeyDoor', { key: t('key.blue') }) === 'You need a blue key to open this door.');

// 엔딩 이야기: 줄 수·줄 길이 (320px 화면, 글자 x=10 부터 세로 10 + 11×줄)
for (const k of ['finale.e1', 'finale.e2', 'finale.e3', 'finale.e4', 'story.C1', 'story.C2', 'story.C3', 'story.C4', 'story.C5', 'story.C6']) {
  const lines = dictValue('ko', k);
  ok(`${k}: 한국어 ${lines.length}줄 ≤ 17`, lines.length <= 17);
  const wide = lines.filter((l) => [...l].reduce((w, c) => w + (c === ' ' ? 4 : c.charCodeAt(0) < 128 ? 5 : 10), 0) > 300);
  ok(`${k}: 한국어 줄 폭 ≤ 300px`, wide.length === 0, wide.join(' | '));
}

console.log(out.join('\n'));
process.exit(out.some((l) => l.startsWith('FAIL')) ? 1 : 0);
