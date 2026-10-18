import { defineConfig } from 'vite';
import { rm, readdir } from 'node:fs/promises';

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

/** 개발 서버에서 /wad/index.json 으로 public/wad 안의 WAD 파일 목록을 알려 준다 (WAD 고르기 화면용) */
const wadList = () => ({
  name: 'wad-list',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/wad/index.json', async (_req, res) => {
      let names = [];
      try { names = (await readdir(new URL('./public/wad', import.meta.url))).filter((n) => /\.wad$/i.test(n)).sort(); } catch { /* 폴더 없음 */ }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(names));
    });
  },
});

export default defineConfig({
  server: { port: 5173, open: false },
  plugins: [wadList(), stripWad()],
});
