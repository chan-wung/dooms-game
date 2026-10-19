/**
 * 문구 번역. t('키', { 변수 }) → 현재 언어의 문구 (없으면 영어 → 키 그대로).
 * 모듈 기본 언어는 영어(원작 문구)다. 화면 쪽(main.js)이 저장된 설정으로 setLang 을 부른다.
 * 값이 배열이면(엔딩 이야기 등) 배열을 그대로 돌려준다.
 */
import en from './lang/en.js';
import ko from './lang/ko.js';

const DICTS = { en, ko };
export const LANGS = ['ko', 'en'];
let lang = 'en';

export const getLang = () => lang;
export const setLang = (l) => { if (DICTS[l]) lang = l; };

export function t(key, vars) {
  let v = DICTS[lang][key] ?? DICTS.en[key] ?? key;
  if (typeof v === 'string' && vars) v = v.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return v;
}

/** 두 사전의 키 목록 (테스트용) */
export const dictKeys = (l) => Object.keys(DICTS[l]);
export const dictValue = (l, key) => DICTS[l][key];
