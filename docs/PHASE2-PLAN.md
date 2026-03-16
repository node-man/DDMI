---
title: "Phase 2 구현 계획서 — 시각화"
date: "2026-03-16"
type: plan
phase: 2
estimated_duration: "7 weeks"
---

# Phase 2 구현 계획서 — 시각화

> 기본기 위에 차별화를 얹는다. 프로젝트 지식의 구조를 눈으로 보고, 손으로 다룬다.

## 1. 기술 전환 계획: htmx → React + Vite

### 전환 전략

**한 번에 교체.** 점진적 마이그레이션이 아니라 Week 1에서 React + Vite를 셋업하고, 기존 htmx 페이지(`src/dashboard/pages/*.html`)를 완전히 대체한다.

```
현재 (MVP-1):
  Hono 서버 (port 3000)
    ├── HTML 페이지 (htmx) ← 제거
    └── /api/* 엔드포인트   ← 유지

Phase 2:
  Hono API 서버 (port 3001)
    └── /api/* 엔드포인트   ← 유지 + 확장
  Vite dev server (port 3000)
    ├── React SPA           ← 신규
    └── proxy /api/* → :3001 ← 개발 시 프록시
  프로덕션:
    Hono 서버 (port 3000)
      ├── /api/* 엔드포인트
      └── /* → dist/client/ (Vite 빌드 산출물)
```

### 변경되는 파일

| 파일 | 변경 |
|------|------|
| `src/dashboard/server.ts` | htmx 페이지 라우트 제거, API 전용으로 리팩터. 프로덕션 모드에서 Vite 빌드 산출물 서빙 |
| `src/dashboard/pages/*.html` | 삭제 (React로 대체) |
| `src/dashboard/static/style.css` | 삭제 (Tailwind 또는 CSS Modules로 대체) |
| `src/client/` | **신규** — React + Vite 프론트엔드 디렉토리 |
| `vite.config.ts` | **신규** — Vite 설정, proxy 포함 |
| `tsconfig.client.json` | **신규** — React용 별도 tsconfig |

### 프론트엔드 디렉토리 구조

```
src/client/
├── index.html
├── main.tsx
├── App.tsx
├── vite-env.d.ts
├── api/                    # API 호출 레이어
│   └── client.ts           # fetch wrapper (타입 안전)
├── components/
│   ├── layout/
│   │   ├── Sidebar.tsx
│   │   ├── Header.tsx
│   │   └── Layout.tsx
│   ├── health/
│   │   ├── HealthDashboard.tsx
│   │   ├── StatCard.tsx
│   │   ├── TrendChart.tsx
│   │   └── WarningList.tsx
│   ├── explorer/
│   │   ├── FileNavigator.tsx
│   │   ├── DocumentViewer.tsx
│   │   ├── SearchPanel.tsx
│   │   └── FileMetaBadge.tsx
│   ├── graph/
│   │   ├── KnowledgeGraph.tsx
│   │   ├── GraphControls.tsx
│   │   ├── ChunkZoom.tsx
│   │   └── TimeSlider.tsx
│   ├── conflicts/
│   │   ├── ConflictStudio.tsx
│   │   ├── DiffView.tsx
│   │   ├── ContextMap.tsx
│   │   └── DecisionGate.tsx
│   └── audit/
│       ├── AuditTimeline.tsx
│       ├── EventCard.tsx
│       └── ImpactTrace.tsx
├── hooks/
│   ├── useApi.ts           # SWR-style data fetching
│   ├── useGraph.ts         # D3 force simulation
│   └── useSSE.ts           # Server-Sent Events
├── types/
│   └── api.ts              # API 응답 타입 (서버와 공유)
└── styles/
    └── globals.css
```

---

## 2. 주차별 분해

### Sprint 0: Drizzle ORM 마이그레이션 (Phase 2 시작 전)

**목표:** raw SQL 문자열 → Drizzle ORM 타입 안전 쿼리로 전환.

**이유:** Phase 2에서 API 12개가 추가되는데, 현재 sqlite.ts의 raw SQL (30+ 쿼리, 7 테이블)은:
- 컬럼명 변경 시 런타임에서야 발견되는 에러
- `?` 순서와 파라미터 순서 불일치 시 silent data corruption
- TypeScript가 SQL 문자열 내부 오류를 못 잡음

**작업:**
- [x] `drizzle-orm` + `drizzle-kit` 설치 (0.45.1 + 0.31.9)
- [x] `src/storage/schema.ts` — 7개 테이블 Drizzle 스키마 정의
- [ ] `src/storage/sqlite.ts` — raw SQL → Drizzle 쿼리로 리팩터
- [ ] 기존 FTS5 virtual table은 raw SQL 유지 (Drizzle 미지원)
- [ ] 150 tests 전부 통과 확인
- [ ] CRUD 30+ 함수의 파라미터 타입 안전 확인

**검증:** `npx vitest run` 전부 통과 + `npx tsc` 0 errors

### Week 1: React + Vite 셋업 + 프로젝트 골격

**목표:** 개발 환경 완성. 빌드 → 서빙까지 end-to-end 작동.

| Day | 작업 | 산출물 | 검증 기준 |
|-----|------|--------|----------|
| Day 1 | npm 의존성 설치, `vite.config.ts` + `tsconfig.client.json` 작성, `src/client/` 디렉토리 생성 | `vite.config.ts`, `tsconfig.client.json`, `src/client/index.html`, `src/client/main.tsx` | `npm run dev:client`로 Vite dev server 시작, 브라우저에서 React 앱 로드 |
| Day 2 | Hono 서버를 API 전용으로 리팩터. `src/dashboard/server.ts`에서 HTML 라우트 제거, Vite 프록시 설정 | `src/dashboard/server.ts` 수정 | `/api/health` 프록시 통해 React 앱에서 호출 성공 |
| Day 3 | Layout 컴포넌트 (`Sidebar`, `Header`, `Layout`), 라우팅 (React Router) | `src/client/components/layout/*.tsx`, `src/client/App.tsx` | 5개 페이지 라우트 이동 가능 (Health, Explorer, Graph, Conflicts, Audit) |
| Day 4 | API 클라이언트 레이어, 타입 정의 (`src/client/api/client.ts`, `src/client/types/api.ts`) | `src/client/api/client.ts`, `src/client/types/api.ts` | 타입 안전한 API 호출, `useApi` 훅 작동 |
| Day 5 | 프로덕션 빌드: `vite build` → Hono에서 정적 파일 서빙, `npm run dev` 스크립트 통합 | `package.json` scripts 수정, 프로덕션 서빙 로직 | `npm run build && ddmi serve`로 SPA 정상 서빙 |

**Week 1 완료 기준:**
- `npm run dev:client` — Vite dev server + API 프록시 작동
- `npm run build` — Vite + tsc 빌드 성공
- `ddmi serve` — API + SPA 프로덕션 서빙
- 5개 빈 페이지 라우팅 동작

---

### Week 2: Health Dashboard

**목표:** 기존 `/api/health` 데이터를 활용한 시각적 대시보드. 가장 빠른 성과.

| Day | 작업 | 산출물 | 검증 기준 |
|-----|------|--------|----------|
| Day 1 | `StatCard` 컴포넌트 — 숫자 + 레이블 + 아이콘 + 변화량 표시 | `src/client/components/health/StatCard.tsx` | 6개 지표(Files, Chunks, Relations, Conflicts, Audit Events, Chain Status) 카드 렌더링 |
| Day 2 | `/api/health/history` 엔드포인트 추가 (SQLite에 스냅샷 저장), `TrendChart` 컴포넌트 (Recharts line chart) | `src/dashboard/server.ts` 확장, `src/client/components/health/TrendChart.tsx` | 7일간 트렌드 라인 차트 표시 |
| Day 3 | 건강도 게이지 (일관성 점수 = 1 - conflicts/relations), 문서 커버리지 게이지 | `HealthDashboard.tsx` 통합 | 게이지가 0~100% 범위로 정확하게 표시 |
| Day 4 | `WarningList` — 조기 경고 목록 (3개월 미갱신 파일, 새 충돌 감지, 피드백 데이터 알림) | `src/client/components/health/WarningList.tsx`, `/api/health/warnings` 엔드포인트 | 경고 조건 충족 시 경고 카드 표시 |
| Day 5 | 자동 새로고침 (30초 폴링 → Phase 3에서 SSE로 전환), 반응형 레이아웃 마무리 | `useApi.ts` 폴링 로직 | 데이터 변경 시 30초 내 UI 반영 |

**Week 2 완료 기준:**
- Health Dashboard에 6개 지표 카드 + 트렌드 차트 + 건강도 게이지 + 경고 목록
- 기존 htmx 대시보드 대비 정보량과 시각적 품질 모두 우위
- `/api/health`, `/api/health/history`, `/api/health/warnings` 엔드포인트 작동

**신규 API 엔드포인트:**

| 엔드포인트 | 메서드 | 응답 | 데이터 소스 |
|-----------|--------|------|------------|
| `/api/health/history` | GET | `{ snapshots: [{ date, files, chunks, relations, conflicts }] }` | SQLite `health_snapshots` 테이블 (신규) |
| `/api/health/warnings` | GET | `{ warnings: [{ type, severity, message, targetFile? }] }` | SQLite 쿼리 조합 (stale files, new conflicts, feedback count) |

---

### Week 3: Knowledge Explorer — 파일 탐색

**목표:** 프로젝트의 모든 MD 파일을 메타데이터와 함께 탐색. 파일 선택 시 MD 프리뷰.

| Day | 작업 | 산출물 | 검증 기준 |
|-----|------|--------|----------|
| Day 1 | `/api/files` 엔드포인트 (파일 목록 + 메타데이터: docType, chunkCount, lastModified, feedbackFrequency, conflictCount) | `src/dashboard/server.ts` 확장 | JSON 응답에 모든 파일의 메타데이터 포함 |
| Day 2 | `FileNavigator` — 트리 뷰 + 리스트 뷰 전환, docType 배지, 정렬 (이름/수정일/활용도) | `src/client/components/explorer/FileNavigator.tsx`, `FileMetaBadge.tsx` | 100개 파일 목록 1초 내 렌더링 |
| Day 3 | `/api/files/:id/content` 엔드포인트 (원본 MD 내용 반환), `DocumentViewer` (react-markdown 렌더링) | `src/client/components/explorer/DocumentViewer.tsx` | MD 파일 선택 시 렌더링된 프리뷰 표시 |
| Day 4 | 어노테이션 오버레이 — 청크 경계 표시, 충돌 섹션 빨간 사이드바, backlinks 목록 | `DocumentViewer.tsx` 확장 | 충돌이 있는 청크에 시각적 표시, backlink 클릭으로 이동 |
| Day 5 | `SearchPanel` — 키워드 + 시맨틱 통합 검색 (기존 `context_assemble` 로직 재사용), 스코어 breakdown 표시 | `src/client/components/explorer/SearchPanel.tsx`, `/api/search` 엔드포인트 | 검색 결과에 점수 분해 표시 (semantic, keyword, authority, recency) |

**Week 3 완료 기준:**
- 파일 목록 탐색 (트리/리스트 뷰 전환)
- MD 프리뷰 + 어노테이션 (충돌 표시, backlinks)
- 통합 검색 + 스코어 breakdown

**신규 API 엔드포인트:**

| 엔드포인트 | 메서드 | 응답 | 데이터 소스 |
|-----------|--------|------|------------|
| `/api/files` | GET | `{ files: [{ id, path, docType, chunkCount, lastModified, feedbackFrequency, conflictCount }] }` | SQLite `files` + `chunks` + `conflicts` + `feedback_log` JOIN |
| `/api/files/:id/content` | GET | `{ id, path, content, chunks: [{ id, heading, startLine, endLine }] }` | SQLite `files` + 원본 파일 읽기 + `chunks` |
| `/api/files/:id/backlinks` | GET | `{ backlinks: [{ sourceFileId, sourceChunkId, relationType }] }` | SQLite `relations` 역방향 조회 |
| `/api/search` | POST | `{ results: [{ chunkId, fileId, heading, score, breakdown: { semantic, keyword, authority, recency } }] }` | Curator 스코어링 로직 재사용 |

---

### Week 4: Knowledge Explorer 마무리 + Knowledge Graph 착수

**목표:** Explorer 필터/정렬 완성. Graph의 D3.js 기반 force-directed 레이아웃 구현.

| Day | 작업 | 산출물 | 검증 기준 |
|-----|------|--------|----------|
| Day 1 | Explorer 필터 (docType, 날짜 범위, 충돌 여부), 검색 결과 필터 연동 | `SearchPanel.tsx` 확장 | 필터 조합으로 결과 좁히기 동작 |
| Day 2 | `/api/graph` 엔드포인트 (노드: 파일, 엣지: 관계, 메타데이터 포함) | `src/dashboard/server.ts` 확장 | 전체 그래프 데이터 JSON 응답 < 500ms |
| Day 3 | `KnowledgeGraph` — D3.js force simulation 기본 구현. 노드 = 파일 (크기 = 토큰 수, 색상 = docType), 엣지 = 관계 | `src/client/components/graph/KnowledgeGraph.tsx` | 50개 노드 + 100개 엣지 그래프 렌더링, 드래그 가능 |
| Day 4 | 엣지 색상 (references=파랑, depends_on=초록, contradicts=빨강), 충돌 노드 펄스 애니메이션, 노드 호버 툴팁 | `KnowledgeGraph.tsx` 확장 | 관계 타입별 시각적 구분 명확 |
| Day 5 | `GraphControls` — 줌/패닝, 관계 타입별 필터 토글, 레이아웃 리셋 | `src/client/components/graph/GraphControls.tsx` | 필터 토글로 특정 관계만 표시/숨기기 |

**Week 4 완료 기준:**
- Knowledge Explorer 완성 (탐색 + 프리뷰 + 검색 + 필터)
- Knowledge Graph 기본 force-directed 레이아웃 동작
- 노드/엣지 시각적 구분, 드래그/줌/필터

**신규 API 엔드포인트:**

| 엔드포인트 | 메서드 | 응답 | 데이터 소스 |
|-----------|--------|------|------------|
| `/api/graph` | GET | `{ nodes: [{ id, path, docType, tokenCount, conflictCount }], edges: [{ source, target, type, weight }] }` | SQLite `files` + `relations` + `conflicts` |
| `/api/graph/clusters` | GET | `{ clusters: [{ id, label, fileIds: [] }] }` | LanceDB 임베딩 기반 2D 투영 (UMAP 또는 PCA) |

---

### Week 5: Knowledge Graph 완성 + Conflict Resolution Studio

**목표:** 그래프 고급 기능 (시간 슬라이더, 청크 줌). 충돌 해결 전용 UI.

| Day | 작업 | 산출물 | 검증 기준 |
|-----|------|--------|----------|
| Day 1 | `TimeSlider` — 날짜 범위 슬라이더, 선택 범위 내 관계만 표시, 애니메이션 재생 | `src/client/components/graph/TimeSlider.tsx` | 슬라이더 드래그로 그래프가 시간에 따라 성장하는 애니메이션 |
| Day 2 | `ChunkZoom` — 파일 노드 더블클릭 시 내부 청크 펼침, 청크 간 관계 표시 | `src/client/components/graph/ChunkZoom.tsx`, `/api/graph/chunks/:fileId` 엔드포인트 | 파일 더블클릭 → 청크 노드 펼쳐지고 관계선 표시 |
| Day 3 | 노드 클릭 → 사이드 패널 (파일 프리뷰 + 관계 목록 + 감사 이력 요약). Graph ↔ Explorer 연동 | `KnowledgeGraph.tsx` 확장 | 그래프 노드 클릭으로 Explorer의 DocumentViewer와 연동 |
| Day 4 | `ConflictStudio` — 충돌 목록, `DiffView` (diff2html side-by-side) | `src/client/components/conflicts/ConflictStudio.tsx`, `DiffView.tsx` | 두 충돌 청크의 diff 하이라이트 표시 |
| Day 5 | `ContextMap` — 충돌 쌍 중심 미니 그래프 (영향받는 문서 표시), `DecisionGate` — 승인/거부/수정 지시 UI | `ContextMap.tsx`, `DecisionGate.tsx` | 충돌 해결 액션이 `/api/conflicts/:id/resolve`로 전송, audit_log에 기록 |

**Week 5 완료 기준:**
- Knowledge Graph에 시간 슬라이더 + 청크 줌 + 사이드 패널 작동
- Conflict Studio에서 diff 뷰 + 컨텍스트 맵 + 해결 워크플로 동작
- 기존 `/api/conflicts/:id/resolve` API 재사용

**신규 API 엔드포인트:**

| 엔드포인트 | 메서드 | 응답 | 데이터 소스 |
|-----------|--------|------|------------|
| `/api/graph/chunks/:fileId` | GET | `{ chunks: [{ id, heading, tokenCount, score }], relations: [{ source, target, type }] }` | SQLite `chunks` + `relations` |
| `/api/conflicts/:id/context` | GET | `{ conflict, relatedFiles: [{ id, path, relationship }] }` | SQLite `conflicts` + `relations` 그래프 탐색 |

---

### Week 6: Audit Timeline + Conflict Studio 마무리

**목표:** 감사 이력을 인터랙티브 타임라인으로. Conflict Studio 세부 기능 완성.

| Day | 작업 | 산출물 | 검증 기준 |
|-----|------|--------|----------|
| Day 1 | `AuditTimeline` — 수직 타임라인 UI, `EventCard` (Actor 아바타 + 행동 + 대상 + rationale) | `src/client/components/audit/AuditTimeline.tsx`, `EventCard.tsx` | 50개 이벤트 타임라인 렌더링, 스크롤 |
| Day 2 | 타임라인 필터 (Actor별, 이벤트 유형별, 파일별), 기간 선택 (1주/1개월/전체) | `AuditTimeline.tsx` 확장 | 필터 조합으로 이벤트 좁히기 |
| Day 3 | 해시 체인 무결성 표시 (상단 배너), `ImpactTrace` — 이벤트 클릭 시 관련 후속 이벤트 하이라이트 | `ImpactTrace.tsx`, `/api/audit/:id/impact` 엔드포인트 | 이벤트 선택 → 연관 이벤트 시각적 강조 |
| Day 4 | Conflict Studio — 해결 이력 참고 기능 (과거 유사 충돌의 해결 방식 표시), AI 분석 결과 표시 영역 | `ConflictStudio.tsx` 확장 | 충돌 상세에서 "이전 유사 충돌" 목록 표시 |
| Day 5 | Audit ↔ Explorer 연동 (이벤트 클릭 → 해당 파일 프리뷰), Audit ↔ Graph 연동 (이벤트의 대상 노드 하이라이트) | 크로스 컴포넌트 연동 | 타임라인 이벤트 → Explorer/Graph 네비게이션 |

**Week 6 완료 기준:**
- Audit Timeline에 필터 + 기간 선택 + 무결성 배너 + Impact Trace 동작
- Conflict Studio에 해결 이력 참고 + AI 분석 표시
- 3개 뷰 간 크로스 네비게이션 작동

**신규 API 엔드포인트:**

| 엔드포인트 | 메서드 | 응답 | 데이터 소스 |
|-----------|--------|------|------------|
| `/api/audit/:id/impact` | GET | `{ event, downstream: [{ id, eventType, timestamp }] }` | SQLite `audit_events` basedOn 관계 추적 |
| `/api/conflicts/history` | GET | `{ resolved: [{ id, chunkA, chunkB, resolvedBy, note, resolvedAt }] }` | SQLite `conflicts` WHERE status='resolved' |

---

### Week 7: 통합 테스트 + 마무리 + 성능 최적화

**목표:** 전체 통합 검증, 성능 최적화, 프로덕션 빌드 안정화.

| Day | 작업 | 산출물 | 검증 기준 |
|-----|------|--------|----------|
| Day 1 | E2E 테스트 — 5개 뷰 각각의 핵심 시나리오 (Playwright 또는 Vitest + happy-dom) | `src/client/__tests__/*.test.tsx` | 전체 E2E 테스트 통과 |
| Day 2 | API 통합 테스트 — 신규 엔드포인트 전체 검증, 에러 케이스 (빈 DB, 대규모 데이터) | `src/dashboard/server.test.ts` 확장 | 모든 API 엔드포인트 테스트 통과 |
| Day 3 | 성능 최적화 — Knowledge Graph 200+ 노드 벤치마크, 가상화 (노드 LOD), API 응답 캐싱 | 벤치마크 결과 문서화 | 200개 노드 그래프 60fps 유지, API 응답 < 500ms |
| Day 4 | 프로덕션 빌드 안정화 — Vite 번들 최적화, 코드 스플리팅 (D3.js lazy load), 에러 바운더리 | `vite.config.ts` 최적화 | 프로덕션 번들 < 500KB (gzip), 초기 로드 < 2초 |
| Day 5 | 기존 htmx 파일 삭제, 문서 업데이트 (README, CHANGELOG), v0.3.0 릴리스 준비 | 파일 정리, `CHANGELOG.md` | `ddmi serve` 명령으로 전체 기능 정상 동작 |

**Week 7 완료 기준:**
- 전체 테스트 통과 (단위 + API + E2E)
- 200개 노드 Knowledge Graph 60fps
- 프로덕션 빌드 + 서빙 정상
- v0.3.0 릴리스 가능 상태

---

## 3. 확정 기술 스택 + npm 의존성

### 핵심 결정 (2026-03-16 확정)

| 용도 | 선택 | 이유 |
|------|------|------|
| UI 프레임워크 | React 19 + Vite 8 | 컴포넌트 재사용, 생태계 |
| 스타일링 | **Tailwind CSS 4** + **shadcn/ui** | 유틸리티 CSS + Radix 기반 접근성 컴포넌트 |
| 그래프 | **React Flow (@xyflow/react 12)** | React 네이티브, 노드/엣지 인터랙션 내장 |
| 차트 | **Apache ECharts 6** | 풍부한 차트 종류, 대규모 데이터 성능 |
| MD 프리뷰 | react-markdown 10 | remark 생태계 재사용 |
| Diff 뷰 | diff2html 3 | side-by-side 렌더링 |
| 아이콘 | Lucide React | shadcn 기본 아이콘 셋 |
| UI 레퍼런스 | Vercel/Linear 스타일 | 다크 테마, 미니멀, 타이포그래피 중심 |

### dependencies (프로덕션)

| 패키지 | 버전 | 용도 |
|--------|------|------|
| `react` | 19.2.4 | UI |
| `react-dom` | 19.2.4 | DOM |
| `react-router-dom` | ^7.0.0 | SPA 라우팅 |
| `@xyflow/react` | 12.10.1 | Knowledge Graph |
| `echarts` | 6.0.0 | Health 차트, 트렌드 |
| `echarts-for-react` | 3.0.6 | React 래퍼 |
| `react-markdown` | 10.1.0 | MD 프리뷰 |
| `remark-gfm` | 4.0.1 | GFM 지원 |
| `diff2html` | 3.4.56 | 충돌 diff 뷰 |
| `lucide-react` | 0.577.0 | 아이콘 |
| `class-variance-authority` | 0.7.1 | shadcn 변형 관리 |
| `clsx` | 2.1.1 | 조건부 클래스 |
| `tailwind-merge` | 3.5.0 | Tailwind 클래스 충돌 해결 |

### devDependencies (개발)

| 패키지 | 버전 | 용도 |
|--------|------|------|
| `vite` | 8.0.0 | 빌드 + dev server |
| `@vitejs/plugin-react` | 6.0.1 | Vite React 플러그인 |
| `tailwindcss` | 4.2.1 | 유틸리티 CSS |
| `@tailwindcss/vite` | 4.2.1 | Vite 통합 |
| `@types/react` | 19.2.14 | 타입 |
| `@types/react-dom` | 19.2.3 | 타입 |

### shadcn/ui 컴포넌트 (copy-paste, npm 설치 아님)

Button, Badge, Card, Dialog, Tabs, Table, Input, Select, Sidebar, Tooltip

---

## 4. 기존 API 확장

### 현재 API (유지)

| 엔드포인트 | 용도 | 변경 |
|-----------|------|------|
| `GET /api/health` | 프로젝트 건강 지표 | 필드 추가 (feedbackCount, staleFileCount) |
| `GET /api/conflicts` | 열린 충돌 목록 | 변경 없음 |
| `POST /api/conflicts/:id/resolve` | 충돌 해결 | 변경 없음 |
| `GET /api/audit` | 감사 이벤트 목록 | 변경 없음 |

### 신규 API (Phase 2에서 추가)

| 엔드포인트 | 메서드 | Week | 용도 |
|-----------|--------|------|------|
| `/api/health/history` | GET | 2 | 건강 지표 트렌드 (7일/30일) |
| `/api/health/warnings` | GET | 2 | 조기 경고 목록 |
| `/api/files` | GET | 3 | 파일 목록 + 메타데이터 |
| `/api/files/:id/content` | GET | 3 | 파일 원본 + 청크 정보 |
| `/api/files/:id/backlinks` | GET | 3 | 역방향 관계 (이 파일을 참조하는 문서) |
| `/api/search` | POST | 3 | 통합 검색 (keyword + semantic) |
| `/api/graph` | GET | 4 | 전체 그래프 데이터 (노드 + 엣지) |
| `/api/graph/clusters` | GET | 4 | 시맨틱 클러스터 |
| `/api/graph/chunks/:fileId` | GET | 5 | 파일 내 청크 수준 그래프 |
| `/api/conflicts/:id/context` | GET | 5 | 충돌의 관련 파일 맵 |
| `/api/conflicts/history` | GET | 6 | 해결된 충돌 이력 |
| `/api/audit/:id/impact` | GET | 6 | 이벤트의 하류 영향 추적 |

### SQLite 스키마 추가

```sql
-- 건강 지표 스냅샷 (일별)
CREATE TABLE IF NOT EXISTS health_snapshots (
  date TEXT PRIMARY KEY,           -- YYYY-MM-DD
  files INTEGER NOT NULL,
  chunks INTEGER NOT NULL,
  relations INTEGER NOT NULL,
  conflicts INTEGER NOT NULL,
  auditEvents INTEGER NOT NULL,
  feedbackCount INTEGER NOT NULL DEFAULT 0
);
```

스냅샷은 `ddmi serve` 시작 시 + 24시간 간격으로 자동 기록. `ddmi index` 완료 시에도 기록.

---

## 5. 검증 기준 요약

### 기능 검증

| 컴포넌트 | 핵심 검증 시나리오 |
|---------|------------------|
| Health Dashboard | 6개 지표 정확히 표시, 트렌드 차트 7일 데이터, 경고 조건 충족 시 표시 |
| Knowledge Explorer | 100개 파일 탐색 < 1초, MD 프리뷰 렌더링, 검색 결과 스코어 breakdown 표시 |
| Knowledge Graph | 200개 노드 60fps, 관계 타입별 색상 구분, 시간 슬라이더 애니메이션, 청크 줌 |
| Conflict Studio | diff 하이라이트 정확도, 해결 액션 → audit_log 기록, 컨텍스트 맵 연관 파일 표시 |
| Audit Timeline | 50개 이벤트 타임라인, 필터 동작, Impact Trace 하류 이벤트 추적 |

### 성능 검증

| 항목 | 기준 |
|------|------|
| 초기 페이지 로드 | < 2초 (프로덕션 빌드) |
| API 응답 시간 | < 500ms (모든 엔드포인트) |
| Knowledge Graph 렌더링 | 200개 노드 + 500개 엣지에서 60fps |
| 프로덕션 번들 크기 | < 500KB gzip (D3.js lazy load) |
| 메모리 사용량 | < 300MB RSS (서버 + 클라이언트) |

### 품질 검증

| 항목 | 기준 |
|------|------|
| 테스트 커버리지 | 신규 API 엔드포인트 100%, 컴포넌트 핵심 로직 80%+ |
| 타입 안전성 | API 응답 타입 서버-클라이언트 공유, `strict: true` |
| 에러 처리 | 모든 API 호출에 에러 바운더리, 빈 상태 UI |
| 접근성 | 키보드 네비게이션, ARIA 레이블 (기본 수준) |

---

## 6. 리스크 분석

### R1. D3.js 학습 곡선 — 영향도: 높음

**위험:** D3.js force simulation + React 통합은 복잡하다. D3가 DOM을 직접 조작하는 반면 React는 가상 DOM을 사용하므로 충돌 가능.

**대응:**
- D3는 force simulation 계산만 담당, 렌더링은 React (SVG JSX)로 처리 — "D3 as math library" 패턴
- Week 4 Day 3에 기본 구현 후 Day 4~5에서 시각적 개선. 실패 시 Week 5 Day 1까지 버퍼
- 참고 구현체 선정: [d3-force-graph](https://github.com/vasturiano/react-force-graph) 구조 참고

### R2. 200+ 노드 그래프 성능 — 영향도: 중간

**위험:** 대규모 그래프에서 force simulation + SVG 렌더링이 프레임 드롭 유발.

**대응:**
- 100개 이상 노드 시 Canvas 렌더링으로 전환 (SVG → Canvas 2D)
- 화면 밖 노드 렌더링 스킵 (viewport culling)
- force simulation `alpha` 감쇠 조정 (빠른 안정화)
- Week 7 Day 3에 200개 노드 벤치마크, 미달 시 Canvas 전환

### R3. 프론트엔드 코드량 폭증 — 영향도: 중간

**위험:** 5개 컴포넌트 × 3~5 하위 컴포넌트 = 20+ 파일. 백엔드 위주였던 코드베이스에 프론트엔드 비중이 급증.

**대응:**
- `src/client/` 디렉토리 분리로 백엔드/프론트엔드 경계 명확화
- API 타입을 `src/client/types/api.ts`에서 한 곳에 관리
- 컴포넌트는 단일 책임 원칙 준수 (한 파일 200줄 이하)
- Week 1에서 디렉토리 구조와 컨벤션을 확정하고 이후 일관성 유지

### R4. Hono + Vite 통합 복잡도 — 영향도: 낮음

**위험:** 개발 시 두 서버(Vite dev + Hono API)를 동시에 띄우고 프록시해야 함. 프로덕션에서는 Hono가 정적 파일도 서빙해야 함.

**대응:**
- Vite의 `server.proxy` 설정으로 `/api/*` → Hono 서버로 프록시 (검증된 패턴)
- 프로덕션: `@hono/node-server`의 `serveStatic` 미들웨어로 `dist/client/` 서빙
- Week 1 Day 2에서 양방향 검증 완료

### R5. 시간 초과 — 영향도: 중간

**위험:** 7주 계획이지만, D3.js 어려움이나 예상 못한 API 확장으로 지연 가능.

**대응:**
- 우선순위: Health Dashboard(필수) > Explorer(필수) > Graph(핵심) > Conflict Studio(중요) > Audit Timeline(선택적)
- 최악의 경우 Week 7의 Audit Timeline을 Phase 2.5로 연기
- 각 Week 종료 시 "Go/No-Go" 결정 — 1주 이상 지연 시 범위 축소

---

## 7. 마일스톤 요약

| 마일스톤 | Week | 주요 산출물 | 버전 |
|---------|------|-----------|------|
| M1: Dev Environment | 1 | React + Vite 셋업, 프로덕션 빌드 파이프라인 | — |
| M2: Health Dashboard | 2 | 지표 카드 + 트렌드 + 경고 | v0.3.0-alpha.1 |
| M3: Knowledge Explorer | 3 | 파일 탐색 + MD 프리뷰 + 검색 | v0.3.0-alpha.2 |
| M4: Knowledge Graph (Basic) | 4 | Force-directed 그래프 + 필터 | v0.3.0-alpha.3 |
| M5: Graph Advanced + Conflict Studio | 5 | 시간 슬라이더 + 청크 줌 + diff 뷰 | v0.3.0-beta.1 |
| M6: Audit Timeline | 6 | 인터랙티브 타임라인 + Impact Trace | v0.3.0-beta.2 |
| M7: Release | 7 | 통합 테스트 + 성능 최적화 + v0.3.0 | **v0.3.0** |

---

## 8. Co-Founder 의견 반영 확인

| 의견 | 반영 위치 |
|------|----------|
| htmx → React 한 번에 전환 | Section 1: "점진적 마이그레이션이 아니라 Week 1에서 완전 교체" |
| Hono API 유지 + Vite dev server 프록시 | Section 1: 개발/프로덕션 아키텍처 다이어그램 |
| Health Dashboard 가장 먼저 | Week 2에 배치 (가장 먼저 완성되는 시각화 컴포넌트) |
| Knowledge Graph를 중간에 배치 | Week 4~5에 배치 (마지막이 아닌 중간, Explorer 다음) |
