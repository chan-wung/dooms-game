# doom-js — 진행 상황

레이캐스터 데모(`legacy/`)를 졸업하고 **진짜 DOOM 엔진**(WAD + BSP)을 만드는 중. 전체 계획: `~/.claude/plans/zippy-waddling-rain.md`

**실행:** `npm install` → `npm run dev` → http://localhost:5173
**WAD:** 셰어웨어 `DOOM1.WAD`를 `public/wad/`에 넣거나 화면에 드래그&드롭 (저장소 커밋 금지)

## Phase 체크리스트
- [x] Phase 0 — Vite 셋업 + WAD 로딩 (`src/wad/wad.js`)
- [x] Phase 1 — 레벨 파싱 + 2D 오토맵 (`src/wad/level.js`, `src/ui/automap.js`)
- [x] Phase 2 — BSP 렌더러(단색) (`src/render/{bsp,renderer,screen}.js`, `src/game/player.js`)
- [x] Phase 3 — 텍스처·플랫·조명 (`src/gfx/{palette,patch,textures}.js`, 렌더러에 텍스처/조명 적용)
  - 남은 것: 양면선의 중간 텍스처(창살·격자 등 masked mid texture)는 아직 안 그림 → Phase 5 스프라이트 클리핑과 함께 처리
  - E1M2·E1M4·E1M7 일부 위치의 구멍(검정)은 원작 WAD에 상/하단 텍스처가 없는 선이 있어서 생기는 현상(vanilla의 HOM과 동일)
- [ ] Phase 4 — 충돌·물리·문/리프트
- [ ] Phase 5 — Things·스프라이트
- [ ] Phase 6 — 전투·몬스터·HUD
- [ ] Phase 7 — 사운드·메뉴·레벨 진행·배포
