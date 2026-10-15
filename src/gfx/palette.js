/**
 * PLAYPAL(팔레트 14장) + COLORMAP(밝기 단계 34장) 로딩.
 * COLORMAP 0 = 최대 밝기, 31 = 가장 어두움, 32 = 무적(반전), 33 = 검정.
 * 렌더러가 바로 쓸 수 있게 "밝기 단계별 256색 → 32비트 픽셀" 표를 미리 만든다.
 */
const rgbaOf = (play, pal, i) => {
  const o = pal * 768 + i * 3;
  return (0xff000000 | (play[o + 2] << 16) | (play[o + 1] << 8) | play[o]) >>> 0; // ABGR (리틀엔디언 RGBA)
};

/** @returns {{ rgba: Uint32Array, lit: Uint32Array[] }} lit[밝기단계][팔레트 인덱스] = 픽셀 */
export function loadPalette(wad, palIndex = 0) {
  const play = wad.getLump('PLAYPAL');
  const cmap = wad.getLump('COLORMAP');
  const rgba = new Uint32Array(256);
  for (let i = 0; i < 256; i++) rgba[i] = rgbaOf(play, palIndex, i);

  const numMaps = Math.floor(cmap.length / 256);
  const lit = Array.from({ length: numMaps }, (_, m) => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) t[i] = rgba[cmap[m * 256 + i]];
    return t;
  });
  return { rgba, lit };
}
