# Phase 2.7 구현 계획서 — UX 강화 + MCP 심화 + Agent 통합

> Knowledge Graph를 인간이 읽을 수 있게 개선하고, MCP 프로토콜 활용도를 높이고,
> AI 에이전트 경험을 강화한다.

- **선행 조건**: Phase 2.6 완료 (v0.3.0 publish)
- **목표**: 인간(Dashboard)과 에이전트(MCP) 양쪽의 ddmi 활용 경험을 개선
- **버전**: v0.4.0
- **참고**: `docs/COMPETITIVE-ANALYSIS.md`, First Principles 그래프 분석 (2026-03-17)

---

## 1. 왜 필요한가

### Dashboard: Knowledge Graph가 읽을 수 없다

18노드에서 이미 스파게티. First Principles 분석 결과:
- **핵심 원인**: "모든 노드와 엣지를 한 화면에 보여줘야 한다"는 거짓 전제
- **라이브러리(React Flow)가 문제가 아니라**, 뭘 그릴지를 잘못 정한 것
- 500노드 타겟에서 전체 그래프는 어떤 라이브러리로도 불가능 (인지 한계)

### Agent: MCP 활용도가 낮다

현재 4 tools, 0 resources, 0 prompts. GitNexus는 7+5+2.

---

## 2. 목표 지표

| 지표 | 현재 | 목표 | 측정 방법 |
|------|------|------|-----------|
| 그래프 동시 표시 노드 | 18 (전부) | **≤ 15** | UI 확인 |
| 그래프 엣지 교차 수 | 15+ | **≤ 3** | 시각적 확인 |
| "관련 문서 찾기" 클릭 수 | N/A (탐색 불가) | **≤ 2클릭** | UX 테스트 |
| MCP resources | 0 | **4** | MCP inspector |
| MCP prompts | 0 | **2** | MCP inspector |
| aimux retry 성공률 | 미구현 | **429 복구 90%+** | AI 로그 |

---

## 3. 작업 분해

### Week 1: Knowledge Graph 재설계 (안1 → 안3)

**원칙**: "전체를 그리지 않는다. 사용자가 보고 싶은 것만 그린다."

**Day 1: Ego-centric Graph (안1)**

```
변경 파일: src/client/components/graph/KnowledgeGraph.tsx
```

- 기본 뷰: 노드 하나도 안 그림. "문서를 선택하세요" 또는 검색창
- 노드 선택(클릭/검색) → 해당 문서 중심 + 1홉 직접 연결만 표시
- 중심 노드 크게, 연결 노드 보통 크기
- dagre 방사형 배치 (rankdir: 'LR' 또는 circular)
- React Flow 그대로 사용

**Day 2: 엣지 필터링 + 스타일 차별화**

```
변경 파일: src/client/components/graph/KnowledgeGraph.tsx
```

- 관계 유형별 토글 체크박스 (references / depends_on / derived_from / contradicts)
- 기본값: `depends_on` + `derived_from`만 ON (핵심 구조만)
- 엣지 스타일:
  - `depends_on`: 실선 굵게, 파란색
  - `references`: 점선, 회색
  - `derived_from`: 실선, 초록색
  - `contradicts`: 파선, 빨간색
- 노드 크기 = 연결 수 비례 (hub 노드 강조)

**Day 3: Overview (안3 - 클러스터 뷰)**

```
변경 파일: src/client/components/graph/KnowledgeGraph.tsx
```

- 뷰 모드 전환 버튼: `Overview` / `Focus`
- **Overview 모드**: docType별 클러스터를 단일 노드로 축약
  - "agent (3)" / "plan (5)" / "spec (2)" 같은 요약 노드
  - 클러스터 간 엣지만 표시 (교차 최소)
  - 클러스터 클릭 → Focus 모드로 전환 (해당 그룹 내 문서 표시)
- **Focus 모드**: ego-centric (Day 1에서 구현한 것)

**Day 4-5: 인터랙션 + 테스트**

- 노드 hover → 관계 수/유형 툴팁
- 노드 더블클릭 → Explorer 페이지로 이동 (MD 프리뷰)
- 충돌 있는 노드에 빨간 배지
- 시각적 테스트: 18파일, 50파일(시뮬), 100파일(시뮬)에서 가독성 확인

**검증 기준**:
- [ ] Ego-centric: 선택 노드 + 1홉만 표시, 엣지 교차 ≤ 3
- [ ] Overview: docType 클러스터 6~8개 노드만 표시
- [ ] 뷰 모드 전환 (Overview ↔ Focus) 동작
- [ ] 엣지 필터링 토글 동작
- [ ] 500노드 시뮬에서 동시 표시 ≤ 15

### Week 2: MCP Resources + Prompts + Skills

**Day 1-2: MCP Resources (4종)**

```
새 파일: src/mcp/resources/
변경 파일: src/mcp/server.ts
```

| URI | 반환 | 용도 |
|-----|------|------|
| `ddmi://project/stats` | 파일 수, 청크 수, 관계 수, 충돌 수, 마지막 인덱싱 | 프로젝트 상태 파악 |
| `ddmi://project/graph` | 파일 간 관계 요약 (상위 10개) | 문서 구조 이해 |
| `ddmi://project/conflicts` | 미해결 충돌 목록 | 작업 전 충돌 확인 |
| `ddmi://project/schema` | 문서 유형, 관계 유형, 스코어링 가중치 | ddmi 구조 이해 |

**Day 3: MCP Prompts (2종) + Skills 생성**

```
새 파일: src/mcp/prompts/, src/cli/skills.ts
변경 파일: src/mcp/server.ts, src/cli/main.ts
```

| 이름 | 용도 |
|------|------|
| `drift_check` | "이 변경이 기존 결정과 충돌하나?" 가이드 |
| `context_review` | "이 작업에 필요한 컨텍스트가 충분한가?" 가이드 |

- `ddmi skills` CLI: 인덱스 결과 → `.claude/skills/generated/project-knowledge.md` 자동 생성

**Day 4-5: aimux v0.2.0 — Credential Scheduler + Retry**

```
변경 파일: packages/aimux/src/
```

- Credential Scheduler: provider → model → credential 스케줄링 (CLIProxyAPI 패턴)
- Retry + Cooldown: 429 → cooldown + 다음 credential 전환
- retry-after 파싱: provider별

**검증 기준**:
- [ ] MCP inspector에서 4 리소스 + 2 프롬프트 동작
- [ ] `ddmi skills` → .claude/skills/ 파일 생성
- [ ] aimux retry: 429 시 자동 cooldown

### Week 3: 통합 + v0.4.0

**Day 1-2: 통합 테스트**

- Graph 개선 + MCP + Skills + aimux 전체 end-to-end 확인
- 4 provider 테스트 (올라마 배치 분할 포함)
- Claude Code에서 MCP resources 접근 확인

**Day 3-4: 문서화 + publish**

- README 업데이트 (Graph 기능, MCP 리소스/프롬프트)
- CHANGELOG.md 업데이트
- aimux@0.2.0 → ddmi@0.4.0 순차 publish

**Day 5: Phase 2.7 회고**

- Graph 개선 전/후 스크린샷 비교
- MCP 활용도 평가
- Phase 3 계획 업데이트

**검증 기준**:
- [ ] aimux@0.2.0 + ddmi@0.4.0 npm publish 성공
- [ ] 전체 MCP 기능 동작 (4 tools + 4 resources + 2 prompts)
- [ ] Graph 가독성 개선 스크린샷 확인

---

## 4. Knowledge Graph 아키텍처 변경 상세

### 현재 → 목표

```
현재:
  /api/graph → 전체 노드 + 전체 엣지 → React Flow → dagre → 스파게티

Phase 2.7:
  /api/graph → 전체 데이터 (캐시)
    ↓
  [Overview 모드]          [Focus 모드]
  docType별 클러스터 축약    선택 노드 + 1홉
  6~8개 요약 노드            5~15개 노드
  클러스터 간 엣지만          직접 연결만
    ↓                        ↓
  클러스터 클릭 → Focus     노드 클릭 → 중심 변경
```

### 컴포넌트 구조

```
KnowledgeGraph.tsx (기존, 리팩터)
├── GraphToolbar.tsx (NEW) — 뷰 모드 전환, 엣지 필터, 검색
├── OverviewGraph.tsx (NEW) — docType 클러스터 뷰
├── FocusGraph.tsx (NEW) — ego-centric 뷰
└── GraphNode.tsx (기존, 크기 차등 추가)
```

### 데이터 흐름

```typescript
// 클라이언트에서 필터링 (API 변경 불필요)
const allNodes = graphData.nodes;
const allEdges = graphData.edges;

// Overview: docType별 축약
const clusters = groupBy(allNodes, 'docType');
const clusterEdges = aggregateEdges(allEdges, clusters);

// Focus: 선택 노드 + 1홉
const focusNodes = [selectedNode, ...getNeighbors(selectedNode, allEdges)];
const focusEdges = allEdges.filter(e => focusNodes.includes(e.source) || focusNodes.includes(e.target));
```

API 변경 없이 클라이언트에서만 필터링. 기존 `/api/graph` 그대로 사용.

---

## 5. 전체 로드맵 위치

```
Phase 2.6 (v0.3.0) — 내부 품질 + 출시
  배치 분할, expandRelations, npm publish

Phase 2.7 (v0.4.0) — UX + 통합 ← 이번
  Week 1: Knowledge Graph 재설계 (ego-centric → overview → hybrid)
  Week 2: MCP Resources/Prompts + Skills + aimux v0.2.0
  Week 3: 통합 + v0.4.0 publish

Phase 3 (v0.5.0) — Intelligence
  피드백 학습, multi-repo, shared_memory
```

---

## 6. 마일스톤 요약

| 주차 | 산출물 | 성공 기준 |
|------|--------|-----------|
| Week 1 | Knowledge Graph 재설계 | Overview + Focus 모드, 엣지 교차 ≤ 3, 500노드 시뮬 통과 |
| Week 2 | MCP 4 resources + 2 prompts + Skills + aimux v0.2.0 | Claude Code에서 동작, retry 성공 |
| Week 3 | 통합 + v0.4.0 publish | 스크린샷 비교, npm publish |
