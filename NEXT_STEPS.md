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
- [x] Phase 4 — 충돌·물리·문/리프트 (`src/game/{blockmap,physics,sectors,specials,player,game}.js`)
  - 구현: BLOCKMAP 충돌·벽 슬라이딩·계단(24)·낙하, 35Hz 고정 tic + 원작 관성/마찰, 문(키 문 포함)·리프트·바닥·계단·조명 효과·텔레포트·출구·데미지 바닥·비밀 구역·벽 스크롤
  - 디버그 키: `N` noclip, `K` 열쇠 전부, `R` 재시작
  - 남은 것: 총으로 작동하는 선(G1/GR, 특수 46), 크러셔·도넛·영구 리프트(공유웨어 맵에서 거의 안 씀), 문/리프트 소리(Phase 7)
  - 열쇠는 Phase 5 픽업 구현 후 실제로 획득 가능 (그 전에는 K 키로 테스트)
- [x] Phase 5 — Things·스프라이트 (`src/gfx/sprites.js`, `src/game/{info,mobj,items}.js`, 렌더러 스프라이트/깊이 버퍼)
  - 구현: 스프라이트 8방향 회전·반전, 난이도 플래그 배치, 애니메이션/풀브라이트, 픽셀 깊이 버퍼로 벽·계단 뒤 가림, 양면선 투명 중간 텍스처(창살), solid 물체 충돌, 아이템 획득(체력·방어구·탄약·무기·열쇠·파워업), 방어구 흡수
  - 몬스터는 지금은 서 있는 모습만 (AI·공격은 Phase 6). 무기 소지/탄약은 상태만 있고 발사는 Phase 6
  - 모르는 thing 종류가 생기면 콘솔에 `아직 모르는 thing 종류` 로 출력됨
- [x] Phase 6 — 전투·몬스터·HUD (`src/game/{states,monsters,combat,weapons}.js`, `src/ui/hud.js`)
  - 구현: 무기 6종(주먹·권총·샷건·체인건·전기톱·로켓), 자동 조준·히트스캔·로켓/폭발 범위 피해, 몬스터 AI(좀비맨·샷건맨·임프·데몬·스펙터·바론 + 통 폭발),
    시선·소음으로 깨우기, 문 열기, 넉백·고통·사망·잔혹 사망, 아이템 드롭, E1M8 바론 전멸 시 출구 바닥, 상태바(체력·방어구·탄약·무기 칸·열쇠·얼굴), 사격 반응 밝기
  - 조작: Ctrl/F/마우스 왼쪽 = 발사, 1~5 = 무기, 휠 = 무기 순환
  - 안 한 것: 플라즈마·BFG(셰어웨어에 스프라이트 없음), 카코데몬·로스트소울(없음), 소리(Phase 7), 투명 화면 팔레트 틴트(CSS 오버레이로 대체)
- [ ] Phase 7 — 사운드·메뉴·레벨 진행·배포
