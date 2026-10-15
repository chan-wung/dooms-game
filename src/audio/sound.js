/**
 * 효과음 (WAD 의 DS* lump = DMX 형식: 헤더 8바이트 + 부호 없는 8비트 PCM).
 * 소리 위치에 따라 볼륨(거리)과 좌우(Stereo Panner)를 정한다 — 원작 s_sound.c 와 같은 규칙.
 */
const CLOSE_DIST = 200, CLIP_DIST = 1200;   // 이 안은 최대 볼륨, 이 밖은 안 들림
const MAX_VOICES = 24;

/** DMX lump → { rate, samples: Float32Array } (잘못된 형식이면 null) */
export function decodeDmx(bytes) {
  if (bytes.length < 8) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint16(0, true) !== 3) return null;
  const rate = dv.getUint16(2, true);
  let n = dv.getUint32(4, true);
  if (n > bytes.length - 8) n = bytes.length - 8;
  // 앞뒤 16바이트는 여유용 패딩
  const start = 8 + 16, count = Math.max(0, n - 32);
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i++) samples[i] = (bytes[start + i] - 128) / 128;
  return { rate, samples };
}

/** 소리 위치 → { volume 0..1, pan -1..1 }. 안 들리면 null */
export function spatialize(src, listener) {
  if (!src || !listener) return { volume: 1, pan: 0 };
  const dx = src.x - listener.x, dy = src.y - listener.y;
  const adx = Math.abs(dx), ady = Math.abs(dy);
  const dist = adx < ady ? adx + ady - adx / 2 : adx + ady - ady / 2;
  if (dist > CLIP_DIST) return null;
  const volume = dist <= CLOSE_DIST ? 1 : (CLIP_DIST - dist) / (CLIP_DIST - CLOSE_DIST);
  // 오른쪽은 시계 방향(각도 감소) → 소리가 오른쪽에 있으면 pan > 0
  const pan = dist < 1 ? 0 : Math.max(-1, Math.min(1, -Math.sin(Math.atan2(dy, dx) - listener.angle) * 0.75));
  return { volume, pan };
}

export class SoundSystem {
  constructor(wad) {
    this.wad = wad;
    this.ctx = null;
    this.buffers = new Map();
    this.voices = 0;
    this.sfxVolume = 0.8;
    this.musicVolume = 0.5;
    this.sfxOn = true;
    this.listener = null;       // { x, y, angle } — 매 프레임 갱신
  }

  /** 브라우저 정책상 사용자 입력(클릭/키) 뒤에 오디오를 시작해야 한다 */
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      // 총소리·폭발이 겹쳐도 찢어지지 않게 마스터에 컴프레서
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -12; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.2;
      this.master.connect(comp);
      comp.connect(this.ctx.destination);
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = this.sfxVolume;
      this.sfxBus.connect(this.master);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = this.musicVolume;
      this.musicBus.connect(this.master);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  setSfxVolume(v) { this.sfxVolume = v; if (this.sfxBus) this.sfxBus.gain.value = v; }
  setMusicVolume(v) { this.musicVolume = v; if (this.musicBus) this.musicBus.gain.value = v; }

  buffer(name) {
    let b = this.buffers.get(name);
    if (b !== undefined) return b;
    b = null;
    const lump = `DS${name}`;
    if (this.wad.has(lump)) {
      const d = decodeDmx(this.wad.getLump(lump));
      if (d && d.samples.length) {
        b = this.ctx.createBuffer(1, d.samples.length, d.rate);
        b.copyToChannel(d.samples, 0);
      }
    }
    this.buffers.set(name, b);
    return b;
  }

  /** 소리 재생. src = 소리 나는 곳 { x, y } (없으면 플레이어 자신: 가운데·최대 볼륨) */
  play(name, src = null) {
    if (!this.sfxOn || !this.ensure() || this.voices >= MAX_VOICES) return;
    const buf = this.buffer(name);
    if (!buf) return;
    const sp = spatialize(src, this.listener);
    if (!sp || sp.volume <= 0) return;

    const node = this.ctx.createBufferSource();
    node.buffer = buf;
    const gain = this.ctx.createGain();
    gain.gain.value = sp.volume;
    let tail = gain;
    node.connect(gain);
    if (this.ctx.createStereoPanner) {
      const pan = this.ctx.createStereoPanner();
      pan.pan.value = sp.pan;
      gain.connect(pan);
      tail = pan;
    }
    tail.connect(this.sfxBus);
    this.voices++;
    node.onended = () => { this.voices--; };
    node.start();
  }
}
