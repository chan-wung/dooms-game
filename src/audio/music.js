/**
 * 음악: WAD 의 D_* lump (MUS 형식)을 읽어 Web Audio 로 합성해 재생한다.
 *  - MUS = DOOM 전용 간단한 MIDI 변형. 이벤트: 음 끄기/켜기, 피치 벤드, 컨트롤러(악기·볼륨·팬), 곡 끝. 시간 단위 1/140초.
 *  - 합성은 진짜 악기 소리가 아니라 파형(사인/삼각/톱니/사각) + 엔벨로프 + 노이즈 타악기로 흉내 낸 간이 신스다.
 */
export const MUS_TICKS_PER_SEC = 140;

/** MUS lump → { events: [{ t, type, ch, ... }], length } (잘못된 형식이면 null) */
export function parseMus(bytes) {
  if (bytes.length < 16 || bytes[0] !== 0x4d || bytes[1] !== 0x55 || bytes[2] !== 0x53 || bytes[3] !== 0x1a) return null;
  const scoreStart = bytes[6] | (bytes[7] << 8);
  const events = [];
  const lastVolume = new Array(16).fill(100);
  let pos = scoreStart, time = 0, ended = false;

  while (pos < bytes.length && !ended) {
    const b = bytes[pos++];
    const hasDelay = (b & 0x80) !== 0, type = (b >> 4) & 7, ch = b & 15;
    switch (type) {
      case 0: events.push({ t: time, type: 'off', ch, note: bytes[pos++] & 127 }); break;
      case 1: {
        const nb = bytes[pos++];
        if (nb & 128) lastVolume[ch] = bytes[pos++] & 127;
        events.push({ t: time, type: 'on', ch, note: nb & 127, vel: lastVolume[ch] });
        break;
      }
      case 2: events.push({ t: time, type: 'bend', ch, value: bytes[pos++] }); break;
      case 3: events.push({ t: time, type: 'sys', ch, ctrl: bytes[pos++] }); break;
      case 4: events.push({ t: time, type: 'ctrl', ch, ctrl: bytes[pos], value: bytes[pos + 1] }); pos += 2; break;
      case 6: ended = true; break;
      default: break; // 5 = 마디 끝, 7 = 미사용
    }
    if (hasDelay && !ended) {
      let delay = 0, x;
      do { x = bytes[pos++]; delay = delay * 128 + (x & 127); } while (x & 128 && pos < bytes.length);
      time += delay;
    }
  }
  return { events, length: time };
}

const midiFreq = (n) => 440 * 2 ** ((n - 69) / 12);

/** GM 악기 번호(0~127) → 합성 음색 */
function timbre(program) {
  if (program < 8) return { wave: 'triangle', attack: 0.004, release: 0.18, cutoff: 3500 };      // 피아노
  if (program < 16) return { wave: 'sine', attack: 0.002, release: 0.35, cutoff: 6000 };         // 종/마림바
  if (program < 24) return { wave: 'square', attack: 0.01, release: 0.08, cutoff: 1800 };        // 오르간
  if (program < 32) return { wave: program < 26 ? 'triangle' : 'sawtooth', attack: 0.003, release: 0.12, cutoff: program < 26 ? 4000 : 2200 }; // 기타
  if (program < 40) return { wave: 'sawtooth', attack: 0.004, release: 0.08, cutoff: 900 };      // 베이스
  if (program < 56) return { wave: 'sawtooth', attack: 0.09, release: 0.25, cutoff: 2500 };      // 현악/합창
  if (program < 64) return { wave: 'sawtooth', attack: 0.02, release: 0.1, cutoff: 2600 };       // 금관
  if (program < 80) return { wave: 'square', attack: 0.02, release: 0.1, cutoff: 2200 };         // 목관/파이프
  if (program < 96) return { wave: 'sawtooth', attack: 0.03, release: 0.2, cutoff: 3000 };       // 신스
  return { wave: 'triangle', attack: 0.01, release: 0.25, cutoff: 3000 };
}

export class MusicPlayer {
  /** @param {{ ctx: AudioContext, bus: GainNode }} out 소리를 내보낼 곳 */
  constructor(getOut) {
    this.getOut = getOut;       // () => { ctx, bus } (사용자 입력 뒤에야 만들어지므로 지연 호출)
    this.song = null;
    this.timer = null;
    this.voices = [];
    this.noise = null;
    this.on = true;
  }

  /** 곡 재생 시작 (같은 곡이면 그대로 둔다) */
  play(song, name) {
    if (this.name === name && this.timer) return;
    this.stop();
    this.name = name;
    this.song = song;
    if (!song || !this.on) return;
    const out = this.getOut();
    if (!out) return;
    this.ctx = out.ctx; this.bus = out.bus;
    this.channels = Array.from({ length: 16 }, () => ({ program: 0, volume: 100, pan: 64, bend: 0 }));
    this.index = 0;
    this.startTime = this.ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 25);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const v of this.voices) { try { v.osc.stop(); } catch { /* 이미 끝남 */ } }
    this.voices = [];
    this.name = null;
  }

  setEnabled(on) {
    this.on = on;
    if (!on) { const n = this.name, s = this.song; this.stop(); this.name = null; this.pending = { n, s }; }
    else if (this.pending) { const { n, s } = this.pending; this.pending = null; this.play(s, n); }
  }

  /** 앞으로 0.15초 안에 올 이벤트를 미리 예약 (타이머 흔들림에 안 끊기도록) */
  schedule() {
    const ctx = this.ctx, song = this.song;
    if (!ctx || !song) return;
    const horizon = ctx.currentTime + 0.15;
    for (let guard = 0; guard < 400; guard++) {
      if (this.index >= song.events.length) {
        // 곡 끝: 처음부터 반복
        this.startTime += song.length / MUS_TICKS_PER_SEC;
        this.index = 0;
        if (this.startTime > horizon) return;
        continue;
      }
      const ev = song.events[this.index];
      const when = this.startTime + ev.t / MUS_TICKS_PER_SEC;
      if (when > horizon) return;
      this.index++;
      this.handle(ev, Math.max(when, ctx.currentTime));
    }
  }

  handle(ev, when) {
    const ch = this.channels[ev.ch];
    switch (ev.type) {
      case 'on': this.noteOn(ev.ch, ev.note, ev.vel, when); break;
      case 'off': this.noteOff(ev.ch, ev.note, when); break;
      case 'bend': ch.bend = ((ev.value - 128) / 128) * 2; this.applyBend(ev.ch, when); break; // ±2 반음
      case 'ctrl':
        if (ev.ctrl === 0) ch.program = ev.value;
        else if (ev.ctrl === 3) ch.volume = ev.value;
        else if (ev.ctrl === 4) ch.pan = ev.value;
        break;
      case 'sys':
        if (ev.ctrl === 10 || ev.ctrl === 11) for (const v of this.voices.filter((x) => x.ch === ev.ch)) this.release(v, when);
        break;
      default: break;
    }
  }

  applyBend(chIdx, when) {
    const bend = this.channels[chIdx].bend;
    for (const v of this.voices) if (v.ch === chIdx && v.osc.detune) v.osc.detune.setValueAtTime(bend * 100, when);
  }

  noteOn(chIdx, note, vel, when) {
    if (this.voices.length > 36) this.release(this.voices[0], when);   // 동시 음 제한
    const ctx = this.ctx, ch = this.channels[chIdx];
    const level = (vel / 127) * (ch.volume / 127) * 0.22;
    if (chIdx === 15) { this.drum(note, level * 1.6, ch.pan, when); return; }

    const t = timbre(ch.program);
    const osc = ctx.createOscillator();
    osc.type = t.wave;
    osc.frequency.value = midiFreq(note);
    osc.detune.value = ch.bend * 100;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = Math.min(t.cutoff + note * 25, 12000);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.linearRampToValueAtTime(level, when + t.attack);
    gain.gain.exponentialRampToValueAtTime(Math.max(level * 0.55, 0.0002), when + t.attack + 0.4);
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    osc.connect(filter); filter.connect(gain);
    if (pan) { pan.pan.value = (ch.pan - 64) / 64; gain.connect(pan); pan.connect(this.bus); } else gain.connect(this.bus);
    osc.start(when);
    const v = { osc, gain, ch: chIdx, note, release: t.release, started: when };
    osc.onended = () => { const i = this.voices.indexOf(v); if (i >= 0) this.voices.splice(i, 1); };
    this.voices.push(v);
  }

  noteOff(chIdx, note, when) {
    const v = this.voices.find((x) => x.ch === chIdx && x.note === note && !x.releasing);
    if (v) this.release(v, when);
  }

  release(v, when) {
    if (v.releasing) return;
    v.releasing = true;
    const g = v.gain.gain, t = Math.max(when, v.started + 0.01);
    g.cancelScheduledValues(t);
    g.setValueAtTime(Math.max(g.value, 0.0002), t);
    g.exponentialRampToValueAtTime(0.0001, t + v.release);
    try { v.osc.stop(t + v.release + 0.02); } catch { /* 이미 정지 */ }
  }

  /** 타악기: 번호별로 북(사인 + 피치 하강) 또는 노이즈 */
  drum(note, level, panVal, when) {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.setValueAtTime(level, when);
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) { pan.pan.value = (panVal - 64) / 64; out.connect(pan); pan.connect(this.bus); } else out.connect(this.bus);

    const tonal = [35, 36, 41, 43, 45, 47, 48, 50].includes(note);
    if (tonal) {                       // 킥/톰
      const o = ctx.createOscillator();
      const base = note <= 36 ? 110 : 90 + (note - 41) * 14;
      o.frequency.setValueAtTime(base * 1.8, when);
      o.frequency.exponentialRampToValueAtTime(base * 0.4, when + 0.12);
      out.gain.exponentialRampToValueAtTime(0.0001, when + (note <= 36 ? 0.22 : 0.3));
      o.connect(out); o.start(when); o.stop(when + 0.35);
      return;
    }
    if (!this.noise) {                 // 흰 잡음 버퍼 (한 번만 생성)
      const len = ctx.sampleRate;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    const hat = [42, 44, 46].includes(note), cymbal = [49, 51, 52, 53, 55, 57, 59].includes(note);
    f.frequency.value = hat ? 7000 : cymbal ? 5000 : 1500;
    const dur = hat ? 0.05 : cymbal ? 0.5 : 0.16;       // 하이햇은 짧게, 심벌은 길게, 스네어는 중간
    out.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    src.connect(f); f.connect(out);
    src.start(when, Math.random() * 0.5); src.stop(when + dur + 0.02);
  }
}
