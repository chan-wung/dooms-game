/**
 * 패치(컬럼 기반 그림) 포맷 디코더.
 * 헤더: width, height, leftOffset, topOffset (각 int16) + 열별 오프셋 uint32[width]
 * 열 = 포스트 반복: [topdelta u8][length u8][unused u8][픽셀 length개][unused u8], topdelta 0xFF 로 끝.
 * 벽 텍스처 합성, 스프라이트, HUD 그래픽이 모두 이 포맷이다.
 */
export function decodePatch(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = dv.getInt16(0, true), height = dv.getInt16(2, true);
  const leftOffset = dv.getInt16(4, true), topOffset = dv.getInt16(6, true);
  if (width <= 0 || width > 4096 || 8 + width * 4 > bytes.length) throw new Error('잘못된 patch 헤더');

  const columns = [];
  for (let x = 0; x < width; x++) {
    let p = dv.getUint32(8 + x * 4, true);
    const posts = [];
    while (p + 2 < bytes.length && bytes[p] !== 0xff) {
      const len = bytes[p + 1];
      posts.push({ top: bytes[p], length: len, start: p + 3 }); // start = bytes 안의 픽셀 시작 위치
      p += len + 4;
    }
    columns.push(posts);
  }
  return { width, height, leftOffset, topOffset, columns, bytes };
}
