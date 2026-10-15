import { defineConfig } from 'vite';
import { rm } from 'node:fs/promises';

/**
 * 빌드 결과(dist)에서 WAD 를 지운다.
 * 개발 중에는 public/wad/DOOM1.WAD 를 쓰지만, 배포본에는 게임 데이터를 싣지 않고
 * 방문자가 자기 WAD 를 올리게(브라우저에만 저장) 한다.
 */
const stripWad = () => ({
  name: 'strip-wad',
  apply: 'build',
  async closeBundle() { await rm(new URL('./dist/wad', import.meta.url), { recursive: true, force: true }); },
});

export default defineConfig({
  server: { port: 5173, open: false },
  plugins: [stripWad()],
});
