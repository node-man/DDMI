# ddmi — Document-Driven Memory Infrastructure

> AI Agent가 프로젝트의 과거 결정을 잊지 않고, 모순을 만들지 않도록 보장하는 인프라.
> Drift monitor & integrity layer for the multi-agent era.

---

## 1. Identity — 정체성

### 한 줄 정의

**ddmi는 Multi-agent 환경에서 프로젝트의 MD 파일들을 의미적으로 인덱싱하고, Agent에게 최적의 컨텍스트를 조립해 제공하며, 인간 감독자에게 결정 게이트를 제공하는 지식 인프라다.**

### 왜 존재하는가 (First Principles)

1. **AI가 생산하는 텍스트 산출물은 기하급수적으로 늘어난다.** MD든 다른 포맷이든, 구조화된 텍스트의 폭발은 멈추지 않는다.
2. **컨텍스트 윈도우가 아무리 커져도, "무엇을 넣을지 큐레이션"하는 문제는 사라지지 않는다.** 더 많은 정보 제공 ≠ 더 나은 이해. Context rot 현상으로 품질이 떨어진다.
3. **Multi-agent 시대에 "공유된 지식 구조"에 대한 수요는 폭증한다.** 여러 Agent가 하나의 프로젝트에서 동시에 작업할 때, 공유된 의미 구조 없이는 충돌과 중복이 불가피하다.

### 무엇이 아닌가

- ✕ MD 에디터가 아니다 (Typora, Obsidian의 편집 기능과 경쟁하지 않는다)
- ✕ 단순 검색 엔진이 아니다 (grep/ripgrep 대체가 아니다)
- ✕ 장식용 그래프가 아니다 — 충돌, 의존성, 시간축, 중요도를 함께 시각화하는 **운영 그래프**다
- ✕ 포맷 변환 도구가 아니다 (MD→PDF는 범용 AI가 이미 잘 한다)

### 첫 번째 고객

**페르소나:** Claude Code, Codex, Gemini CLI 등 AI 코딩 에이전트를 사용하고, MD 파일 100개 이상인 리포지토리를 다루는 1인 개발자 또는 2~5인 소규모 팀.

**이 사람이 겪는 고통:**
1. Agent에게 작업을 시킬 때마다 "어떤 MD를 컨텍스트에 넣어야 할지" 수동으로 골라야 한다. 빠뜨리면 Agent가 이전 결정과 모순되는 코드를 생성한다.
2. 프로젝트 지식이 파편화되어 있어서, 3개월 전 ADR과 지난주 스펙이 충돌하는지 알 방법이 없다. 사람이 전부 기억해야 한다.
3. Agent가 늘어나면(코드 작성 Agent + 리뷰 Agent + 문서화 Agent) 같은 MD를 서로 다르게 해석하거나, 동시에 수정하려다 충돌한다.

**첫 사용 시나리오:**
```
npx ddmi init          ← 프로젝트에 30초 설정
ddmi index             ← MD 파일 자동 인덱싱
# Claude Code에서 작업 시작 시 context_assemble 자동 호출
# → 관련 결정문서, 스펙, 회의록이 자동으로 컨텍스트에 포함
# → Agent가 이전 결정과 일관된 코드를 생성
```

**MVP-0 성공 기준:** 이 고객이 일주일간 실제 프로젝트에서 ddmi를 사용하고, "수동으로 컨텍스트를 고르는 것보다 낫다"고 판단하여 계속 사용하는가.

### AI 발전과의 관계 — 왜 단발성이 아닌가

| AI가 발전하면… | ddmi에 미치는 영향 |
|---|---|
| Agent가 더 많은 MD를 더 빠르게 생산 | → 프로젝트 복잡도 폭증 → **큐레이션 가치 증가** |
| 컨텍스트 윈도우가 10M+ 도달 | → "전체 덤프"보다 "큐레이션된 8K"가 여전히 우월 → **Curator 가치 유지** |
| Multi-agent 조율이 표준화 | → Agent 간 공유 메모리/이벤트 인프라 필요 → **ddmi가 인프라 역할** |
| Agent가 자율적 결정 증가 | → 감사 추적/거버넌스 규제 수요 → **Audit Trail 가치 폭증** |
| 사람의 역할이 "작성자"에서 "감독자"로 전환 | → "편집기"보다 "Decision Gate" 필요 → **Human Supervision 레이어 핵심** |

### 핵심 비유

```
Git : 코드 = ddmi : 프로젝트 지식

Git은 코드를 "저장"하는 게 아니라 "변경을 추적하고 협업을 가능하게" 한다.
ddmi는 MD를 "관리"하는 게 아니라 "의미를 이해하고 Agent 협업을 가능하게" 한다.
```

---

## 2. Architecture — 아키텍처

### 전체 구조

```
┌─────────────────────┐     ┌─────────────────────┐
│   Agent Interface   │     │  Human Supervision   │
│                     │     │                      │
│  context_assemble   │     │  Mission Control     │
│  knowledge_query    │     │  Decision Gate       │
│  shared_memory      │     │  Conflict Resolver   │
│  event_broadcast    │     │  Audit Explorer      │
│  mutate_audited     │     │  Context Editor      │
└────────┬────────────┘     └────────┬─────────────┘
         │                           │
         └──────────┬────────────────┘
                    │
         ┌──────────▼──────────┐
         │   Core: Knowledge   │
         │       Engine        │
         │                     │
         │  Context Curator    │  ← 심장: 최적 컨텍스트 조립
         │  Relation Engine    │  ← 관계 추출 + 충돌 감지
         │  Audit Trail        │  ← 결정 근거 추적
         │  Semantic Index     │  ← 다층 임베딩 + 메타데이터
         └──────────┬──────────┘
                    │
         ┌──────────▼──────────┐
         │      Storage        │
         │                     │
         │  Local .md files    │  ← 원본 불변
         │  SQLite             │  ← 관계, 감사 로그, 메타
         │  LanceDB            │  ← 벡터 임베딩
         │                     │
         │  .ddmi/          │  ← 프로젝트 루트에 생성
         │    index.db         │
         │    vectors.lance    │
         │    config.toml      │
         └─────────────────────┘
```

### 설계 원칙

1. **인덱싱은 원본 불변**: 인덱스 생성/업데이트 과정에서 .md 파일을 수정하지 않는다. 파일 변경은 오직 `mutate_audited`를 통해서만, 감사 기록과 함께 수행된다. 인덱스를 삭제해도 원본 무손실.
2. **증분 업데이트**: 파일 변경 시 해당 청크만 리인덱싱. 전체 리빌드는 초기화 시에만.
3. **Agent-first, Human-second**: 모든 기능은 Agent가 프로그래매틱으로 접근 가능해야 한다. UI는 그 위의 뷰 레이어.
4. **감사 기록 필수**: 모든 변경(mutate)에 rationale + based_on이 강제된다.
5. **로컬 우선**: 별도 서버 없이 프로젝트 디렉토리 안에서 독립 실행. `.ddmi/`는 `.gitignore`에 추가하고 언제든 원본 .md에서 rebuild 가능.
6. **CLI-first, API 지원**: LLM 기능은 사용자가 이미 보유한 CLI 도구(Claude Code, Codex, Gemini CLI, llm, Ollama 등)를 우선 활용하여 추가 비용 없이 작동한다. CLI가 없는 환경에서는 사용자의 API 키(Anthropic, OpenAI 등)로 동일 기능을 제공한다. 임베딩은 내장 transformers.js로 처리하며 별도 설정 불필요. **핵심 쿼리 경로(context_assemble)에는 LLM 호출이 0회** — CLI든 API든 필요 없이, 임베딩 + 벡터 검색 + 스코어링 알고리즘만으로 작동한다.
7. **Graceful Degradation (3단계)**: LLM provider가 없어도 ddmi는 작동한다. 기능이 점진적으로 켜지는 구조.
   - **Level 0** (임베딩 모델 다운로드 불가/오프라인): 명시적 링크 관계(`[[wikilink]]`, `[md link]`) + frontmatter 메타데이터 + BM25 키워드 검색으로 기본 컨텍스트 조립.
   - **Level 1** (transformers.js 임베딩만): + 벡터 유사도 검색. 대부분의 사용자가 여기서 시작. npm install만으로 도달.
   - **Level 2** (+ Ollama 또는 CLI LLM): + 관계 추출, 충돌 감지, 엔티티 추출, 문서 유형 분류. 풀 기능.
8. **배치 우선 AI 호출**: AI 태스크는 개별 실행하지 않고 작업큐에 모아서 배치 실행한다. CLI subprocess 오버헤드를 최소화하고 프롬프트를 병합하여 처리량을 극대화한다.

---

## 3. Core Engine — 상세 설계

### 3.1 Semantic Index

MD 파일을 의미 단위로 분해하고 벡터화하는 기반 레이어.

#### 3.1.1 파싱 + 청킹 전략

```
MD File
  → YAML frontmatter 추출 → 메타데이터 (tags, date, author, type)
  → Heading hierarchy 파싱 → 섹션 트리 구성
  → 각 섹션을 독립 청크로 분할
  → 코드블록 → 언어 + 목적 태그 부착
  → 체크리스트 → 상태 추적 (done/todo 비율)
  → 링크 추출 → 명시적 관계 기록 ([[wikilink]], [md link])
```

청크 단위: **섹션 (## 헤딩 기준)**. 섹션이 500토큰 초과 시 문단 단위로 재분할. 50토큰 미만 섹션은 인접 섹션과 병합.

#### 3.1.2 임베딩 레이어

MVP에서는 Section-level 임베딩만 생성한다. 나머지는 Phase 3에서 추가.

| 레벨 | 대상 | 용도 | MVP 포함 |
|---|---|---|---|
| Section-level | 각 섹션/청크 | 정밀한 시맨틱 검색 | **Yes** |
| Document-level | 파일 전체 | 파일 간 주제 클러스터링 | No — 섹션 벡터 평균으로 근사 |
| Entity-level | 추출된 엔티티 | 관계 그래프 노드 | No — Phase 3 |

#### 3.1.3 저장 스키마

```sql
-- SQLite: .ddmi/index.db

-- 파일 메타데이터
CREATE TABLE files (
  id TEXT PRIMARY KEY,           -- relative path hash
  path TEXT NOT NULL,             -- relative path from project root
  title TEXT,
  doc_type TEXT,                  -- decision, spec, meeting, research, etc.
  frontmatter JSON,
  checksum TEXT,                  -- 변경 감지용
  total_tokens INTEGER,
  completeness_score REAL,        -- 체크리스트 완성도 0~1
  created_at TEXT,
  updated_at TEXT,
  indexed_at TEXT
);

-- 청크 (섹션 단위)
CREATE TABLE chunks (
  id TEXT PRIMARY KEY,            -- file_id + section_path hash
  file_id TEXT REFERENCES files(id),
  section_path TEXT,              -- "## TTL 정책" 또는 "## 개요 > ### 배경"
  content TEXT,
  token_count INTEGER,
  heading_level INTEGER,
  chunk_type TEXT,                -- prose, code, checklist, table
  metadata JSON,                 -- 코드블록 언어, 체크리스트 상태 등
  created_at TEXT
);

-- 관계
CREATE TABLE relations (
  id INTEGER PRIMARY KEY,
  source_chunk_id TEXT REFERENCES chunks(id),
  target_chunk_id TEXT REFERENCES chunks(id),
  relation_type TEXT,             -- depends_on, derived_from, contradicts, supersedes, references
  confidence REAL,                -- 0~1
  discovered_by TEXT,             -- explicit (링크), ai (LLM 추출), embedding (유사도)
  evidence TEXT,                  -- 관계 근거 설명
  created_at TEXT
);

-- 감사 로그
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,            -- AUD-YYYY-MMDD-NNN
  timestamp TEXT NOT NULL,
  event_type TEXT,                -- file_created, file_modified, conflict_detected,
                                 -- conflict_resolved, decision_made, context_assembled
  actor_type TEXT,                -- human, agent, system
  actor_id TEXT,                  -- "claude-code", "김개발", "ddmi-system"
  target_file TEXT,
  target_section TEXT,
  action TEXT,                    -- 무엇을 했는가
  rationale TEXT,                 -- 왜 했는가
  based_on JSON,                 -- ["decisions/adr-007.md", "research/benchmark.md"]
  previous_value TEXT,
  new_value TEXT,
  metadata JSON
);

-- 충돌
CREATE TABLE conflicts (
  id TEXT PRIMARY KEY,            -- CONFLICT-YYYY-MMDD-NNN
  status TEXT DEFAULT 'open',     -- open, pending_human, resolved
  severity TEXT,                  -- low, medium, high
  description TEXT,
  source_chunks JSON,             -- 충돌하는 청크 ID 목록
  detected_at TEXT,
  resolved_at TEXT,
  resolved_by TEXT,
  resolution_audit_id TEXT REFERENCES audit_log(id)
);

-- 컨텍스트 피드백 (MVP-0 — 해자 데이터)
CREATE TABLE feedback_log (
  id TEXT PRIMARY KEY,            -- FB-YYYY-MMDD-NNN
  feedback_token TEXT NOT NULL,   -- context_assemble 세션 ID
  timestamp TEXT NOT NULL,
  intent TEXT,                    -- 원래 질의 intent
  task_type TEXT,                 -- implementation, review, research, planning
  outcome TEXT,                   -- helpful, partial, irrelevant, missing
  blocks_served JSON,             -- 제공된 블록 source 목록
  blocks_used JSON,               -- 실제 사용된 블록 source 목록
  blocks_irrelevant JSON,         -- 불필요했던 블록 source 목록
  missing_context TEXT,           -- 빠진 정보 설명
  scoring_weights JSON            -- 당시 적용된 가중치 스냅샷
);
CREATE INDEX idx_feedback_token ON feedback_log(feedback_token);
CREATE INDEX idx_feedback_outcome ON feedback_log(outcome);

-- Agent 공유 메모리
CREATE TABLE agent_state (
  agent_id TEXT PRIMARY KEY,
  task TEXT,
  status TEXT,                    -- active, awaiting, idle
  working_on JSON,                -- ["specs/cache-strategy.md#ttl"]
  decisions_made JSON,
  last_heartbeat TEXT
);
```

```
-- LanceDB: .ddmi/vectors.lance

Table: chunk_embeddings
  chunk_id: string (FK → chunks.id)
  vector: float32[768]           -- 임베딩 차원 (모델에 따라 변동)
  text_preview: string           -- 검색 결과 미리보기용

Table: doc_embeddings
  file_id: string (FK → files.id)
  vector: float32[768]

Table: entity_embeddings
  entity_id: string
  entity_name: string
  entity_type: string            -- person, technology, decision, concept
  vector: float32[768]
  source_chunks: list<string>
```

### 3.2 Context Curator

ddmi의 심장. Agent가 작업 시작 시 호출하며, 최적의 컨텍스트를 조립해 반환한다.

#### 파이프라인

```
1. Request Parsing
   Agent 질의 → 주제 벡터, 필요 정보 유형, 토큰 예산, 시간 범위 추출

2. Candidate Retrieval (예산의 3~5배 수집)
   ① 벡터 유사도 검색 (top-K from LanceDB)
   ② 관계 그래프 탐색 (1-hop, 2-hop 연결 청크)
   ③ 시간 가중치 (최신 문서 우선)

3. Relevance Scoring
   score = w₁ × semantic_sim      // 의미적 유사도
         + w₂ × relation_strength  // 관계 그래프 거리
         + w₃ × recency            // 시간 신선도
         + w₄ × authority          // 문서 유형 가중치
         + w₅ × task_alignment     // 태스크 유형 정합도
         - penalty × redundancy    // 이미 선택된 청크와 중복 감점

   authority 가중치 (task_type=implementation 기준):
     ADR/결정문서 = 1.0
     스펙 문서    = 0.9
     회의록       = 0.6
     리서치       = 0.5

   task_alignment 계산:
     doc_type과 task_type의 정합도를 매트릭스로 정의:
     
     | doc_type \ task_type | implementation | review | research | planning |
     |----------------------|----------------|--------|----------|----------|
     | decision (ADR)       | 1.0            | 0.9    | 0.7      | 0.8      |
     | spec                 | 0.9            | 0.8    | 0.5      | 0.9      |
     | meeting              | 0.5            | 0.6    | 0.4      | 0.7      |
     | research             | 0.4            | 0.5    | 1.0      | 0.6      |
     → doc_type이 frontmatter에 없으면 0.5 (중립)

   coverage_score 계산:
     질의의 주제 벡터와 선택된 컨텍스트 블록들의 벡터 커버리지를 측정.
     coverage = 1 - (질의 벡터와 가장 가까운 미선택 후보 top-3의 평균 유사도)
     → 높을수록 질의 주제를 잘 커버. 0.8 이상이면 양호.
     → 낮으면 (< 0.5) context_assemble 응답에 경고 포함.

   redundancy penalty:
     새로 추가할 청크와 이미 선택된 청크 중 가장 유사한 것의 코사인 유사도.
     penalty = max(0, sim - 0.7) × 2.0
     → 유사도 0.7 이하면 패널티 0, 0.85면 패널티 0.3.

   가중치 초기값 (config.toml의 [curator.weights]로 노출):
     w₁ = 0.35, w₂ = 0.20, w₃ = 0.15, w₄ = 0.15, w₅ = 0.15
     penalty_factor = 2.0

4. Budget Packing (배낭 문제)
   예산 분배 전략:
     60% — 직접 관련 청크
     25% — 근거/의존 청크
     10% — 충돌/모순 청크 (Agent가 주의해야 할 것)
      5% — 메타 요약 (프로젝트 전체 상태)

5. Assembly + Provenance
   선택 청크를 조립 + 모든 청크에 출처(source) 표기
   + 감지된 충돌 자동 포함
   + 프로젝트 메타 요약 첨부
```

### 3.3 Relation Engine

파일/청크 간 의미적 관계를 추출하고, 충돌을 감지한다.

#### 관계 유형

| type | 설명 | 예시 |
|---|---|---|
| `depends_on` | A는 B의 결정/정의에 의존 | 스펙 → ADR |
| `derived_from` | A는 B에서 파생됨 | 구현 → 스펙 |
| `contradicts` | A와 B가 모순 | TTL 3600 vs 1800 |
| `supersedes` | A가 B를 대체함 | v2 스펙 → v1 스펙 |
| `references` | A가 B를 참조함 | 벤치마크 → ADR |

#### 관계 추출 방식

1. **명시적 (explicit)**: `[[wikilink]]`, `[markdown link](path)` 파싱
2. **임베딩 기반 (embedding)**: 코사인 유사도 > 0.85인 청크 쌍 → 후보. 0.85는 초기 시작점이며, MVP-1 Week 5에서 실제 프로젝트의 유사도 분포를 시각화한 후 프로젝트별 최적값으로 조정한다. `config.toml`의 `[relations] similarity_threshold`로 노출.
3. **LLM 기반 (ai)**: 후보 쌍을 경량 LLM에 넘겨 관계 유형 + 근거 추출

#### 충돌 감지 전략

LLM에 동일 주제의 청크 쌍을 제시하고, 모순 여부 + 심각도를 판단:

```
Prompt template:
"다음 두 문서 섹션이 서로 모순되는 내용을 포함하는지 판단하세요.
모순이 있다면 severity(low/medium/high)와 구체적 설명을 제공하세요.

Section A ({source_a}):
{content_a}

Section B ({source_b}):
{content_b}"
```

**Precision/Recall 전략:** MVP-1의 충돌 감지는 **high-precision / low-recall**로 시작한다. 코사인 유사도 필터가 표현이 다른 실제 충돌(예: "TTL 3600초" vs "캐시 만료 1시간")을 놓칠 수 있으며, 이는 구조적 한계이다. Recall 개선은 Phase 3의 Entity-level 임베딩(동일 엔티티의 속성 비교)에서 다룬다. Decision Queue 노이즈 방지를 위해 초기에는 high severity 충돌만 표시하고, 사용자가 medium/low를 opt-in으로 활성화.

### 3.4 Audit Trail

모든 변경과 결정의 근거를 추적하는 불변 로그.

#### 이벤트 유형

| event_type | 트리거 | 기록 내용 |
|---|---|---|
| `file_created` | mutate_audited(action:"create") | 파일 경로, 작성자, 근거 |
| `file_modified` | mutate_audited(action:"patch") | 변경 섹션, 이전/이후 값, 근거 |
| `conflict_detected` | Relation Engine | 충돌 ID, 관련 청크, 심각도 |
| `conflict_resolved` | Decision Gate 승인 | 해결 방식, 결정자, 근거 |
| `decision_made` | Human이 Decision Gate에서 결정 | 결정 내용, 영향 파일 |
| `context_assembled` | context_assemble 호출 | 요청 Agent, 질의, 선택된 청크, 커버리지 |

---

## 4. Agent Interface (MCP Server) — 상세 설계

### 4.1 서버 설정

```toml
# .ddmi/config.toml

[server]
transport = "stdio"             # stdio (로컬) | sse (원격)
name = "ddmi"
version = "0.1.0"

[ai]
# LLM 프로바이더 — 관계 추출, 충돌 감지, 분석 등에 사용
# CLI-first: 사용자의 기존 CLI 도구를 우선 활용. CLI가 없으면 API 키로 동일 기능 제공.
provider = "auto"                # auto (자동 감지) | claude | codex | gemini | llm | ollama | pipe | api
# auto 모드 우선순위: CLI (claude/codex/gemini/llm) → Ollama → API
# cli_path = "/usr/local/bin/claude"  # 자동 감지 실패 시 수동 설정

# Ollama 사용 시
# provider = "ollama"
# ollama_model = "llama3.2"
# ollama_url = "http://localhost:11434"

# API 직접 호출 (CLI 없는 환경에서 사용)
# provider = "api"
# api_provider = "anthropic"     # anthropic | openai
# api_model = "claude-haiku"
# api_key = ""                   # 사용자의 API 키. 환경변수 ANTHROPIC_API_KEY / OPENAI_API_KEY도 지원

# Pipe 모드 (커스텀 CLI)
# provider = "pipe"
# pipe_command = "my-custom-llm --json"

[ai.tasks]
# 태스크별로 다른 프로바이더 지정 가능
# 빈번한 인덱싱 작업은 로컬, 드문 고급 분석은 CLI로 라우팅
relation_extraction = "ollama"   # 빈번, 분류 태스크 → 로컬 모델 권장
conflict_detection  = "ollama"   # 빈번, 판별 태스크 → 로컬 모델 권장
entity_extraction   = "ollama"   # 빈번, 추출 태스크 → 로컬 모델 권장
doc_classification  = "ollama"   # 드묾, 분류 태스크 → 로컬 모델 권장
conflict_analysis   = "claude"   # 드묾, 고급 추론 필요 → CLI 위임
impact_analysis     = "claude"   # 드묾, 고급 추론 필요 → CLI 위임

[embedding]
# 임베딩은 LLM CLI가 아닌 전용 경로 사용
provider = "transformers"        # transformers (권장) | ollama | llm-cli | api
model = "paraphrase-multilingual-MiniLM-L12-v2"  # 다국어 지원 (한/영/일 등). 첫 실행 시 ~260MB 다운로드
# 영어 전용 프로젝트라면 "all-MiniLM-L6-v2" (~130MB)로 교체 가능
# provider = "ollama"
# model = "nomic-embed-text"

[curator]
default_max_tokens = 8000
budget_direct = 0.60
budget_rationale = 0.25
budget_conflicts = 0.10
budget_meta = 0.05

[curator.weights]
# 스코어링 가중치 (§3.2 공식 참조). 합 = 1.0.
semantic_sim = 0.35       # w₁: 의미적 유사도
relation_strength = 0.20  # w₂: 관계 그래프 거리
recency = 0.15            # w₃: 시간 신선도
authority = 0.15           # w₄: 문서 유형 가중치
task_alignment = 0.15      # w₅: 태스크 유형 정합도
redundancy_penalty = 2.0   # penalty factor

[watcher]
enabled = true
debounce_ms = 2000
ignore_patterns = ["node_modules", ".git", ".ddmi"]
```

> **증분 업데이트 원자성:** 파일 변경 시 SQLite(메타/관계)와 LanceDB(벡터)의 상태가 일관되어야 한다. `git checkout` 등으로 다수 파일이 동시에 변경될 경우를 대비하여, debounce 후 변경 파일 목록을 모아 단일 트랜잭션(SQLite BEGIN → 청크 업데이트 → LanceDB 벡터 업데이트 → COMMIT, 실패 시 ROLLBACK)으로 처리한다.

### 4.2 MCP Tools 스펙

#### `context_assemble` — 핵심 도구

```typescript
// Agent가 작업 시작 시 가장 먼저 호출하는 도구
interface ContextAssembleInput {
  intent: string;                    // "캐시 모듈 구현"
  task_type:
    | "implementation"               // 코드/문서 작성
    | "review"                       // 리뷰/검토
    | "research"                     // 조사/분석
    | "planning";                    // 계획/설계
  max_tokens?: number;               // 컨텍스트 예산 (기본 8000)
  priority?: string[];               // ["decisions","specs"] — 정보 유형 우선순위
  exclude?: string[];                // 제외할 파일/주제
  time_range?: {
    after?: string;                  // ISO date
    before?: string;
  };
}

interface ContextAssembleOutput {
  context_blocks: ContextBlock[];
  conflicts: Conflict[];             // 감지된 충돌 (자동 포함)
  meta_summary: string;              // 프로젝트 전체 상태 snapshot
  total_tokens: number;
  coverage_score: number;            // 질의 대비 커버리지 0~1 (계산식은 §3.2 참조)
  feedback_token: string;            // 이 세션의 고유 ID — context_feedback에서 사용
  debug_scores?: DebugScoreBlock[];  // 옵션: 각 블록의 선택 근거 (가중치 튜닝용)
}

interface ContextBlock {
  content: string;                   // 실제 텍스트
  source: string;                    // "decisions/adr-007.md#캐시-전략"
  type: string;                      // decision, spec, meeting, research
  relevance: number;                 // 0~1
  tokens: number;
}

// debug_scores=true 일 때만 포함
interface DebugScoreBlock {
  source: string;
  semantic_sim: number;
  relation_strength: number;
  recency: number;
  authority: number;
  task_alignment: number;
  redundancy_penalty: number;
  final_score: number;
  selected: boolean;                 // 최종 선택 여부
}
```

#### `knowledge_query` — 지식 질의

```typescript
interface KnowledgeQueryInput {
  question: string;                  // "TTL 정책은 어떻게 결정되었나?"
  depth: "shallow" | "deep";         // shallow=직접 답, deep=근거 체인 추적
}

interface KnowledgeQueryOutput {
  answer_chunks: ContextBlock[];
  provenance_chain: ProvenanceStep[];  // depth=deep 시, 근거의 근거를 추적
}

interface ProvenanceStep {
  content: string;
  source: string;
  relation_to_previous: string;      // "이 결정의 근거" 등
}
```

#### `mutate_audited` — 감사 기록 포함 변경

```typescript
interface MutateAuditedInput {
  action: "create" | "patch" | "replace_section";
  target: string;                    // "specs/cache-strategy.md"
  content: string;                   // 변경 내용
  section?: string;                  // patch 대상 섹션 헤딩
  rationale: string;                 // "ADR-007 근거로 구현" (필수!)
  based_on: string[];                // ["decisions/adr-007.md"] (필수!)
  require_approval?: boolean;        // true면 Decision Gate로 이동
}

interface MutateAuditedOutput {
  success: boolean;
  new_conflicts: Conflict[];         // 변경 후 새로 발생한 충돌
  audit_id: string;                  // 추적 가능한 감사 ID
  approval_status: "auto" | "pending" | "approved";
}
```

> **구현 주의: 원본 포맷 보존.** `replace_section` 수행 시 remark AST를 `remark-stringify`로 재생성하면 원본의 빈 줄, 들여쓰기, 커스텀 HTML 등이 정규화되어 훼손된다. AST는 섹션의 시작/끝 줄 번호를 찾는 데만 사용하고, 실제 교체는 원본 문자열을 직접 slice하는 방식(string-based patch)으로 구현해야 한다.

#### `shared_memory` — Agent 간 상태 공유

```typescript
// 쓰기: Agent가 자기 작업 상태를 등록
interface SharedMemorySetInput {
  agent_id: string;
  task: string;
  status: "active" | "awaiting" | "idle";
  working_on: string[];              // ["specs/cache-strategy.md#ttl"]
  decisions_made?: object[];
}

// 읽기: 다른 Agent가 현재 상태 확인
interface SharedMemoryGetInput {
  query?: string;                    // "cache 관련 작업 중인 agent"
  agent_id?: string;                 // 특정 agent 조회
}

interface SharedMemoryGetOutput {
  agents: AgentState[];
}
```

#### `event_broadcast` — 이벤트 발행/구독

```typescript
interface EventSubscribeInput {
  events: EventType[];               // ["conflict_detected", "file_changed", "decision_made"]
}

interface EventPublishInput {
  event: EventType;
  data: object;
}

type EventType =
  | "conflict_detected"
  | "conflict_resolved"
  | "file_changed"
  | "decision_made"
  | "approval_requested"
  | "index_updated";
```

#### `context_feedback` — 컨텍스트 품질 피드백 (MVP-0)

```typescript
// Agent가 작업 완료 후 호출 (선택적). 스코어링 자동 학습의 데이터 소스.
// context_assemble의 feedback_token을 사용하여 세션을 연결한다.
interface ContextFeedbackInput {
  feedback_token: string;            // context_assemble에서 받은 토큰
  outcome:
    | "helpful"                      // 컨텍스트가 작업에 도움됨
    | "partial"                      // 일부만 유용
    | "irrelevant"                   // 관련 없는 컨텍스트
    | "missing";                     // 필요한 정보가 빠져 있음
  blocks_used?: string[];            // 실제로 참고한 블록의 source (선택적)
  blocks_irrelevant?: string[];      // 불필요했던 블록의 source (선택적)
  missing_context?: string;          // 빠져 있던 정보 설명 (선택적)
}

interface ContextFeedbackOutput {
  recorded: boolean;
  feedback_id: string;               // FB-YYYY-MMDD-NNN
}
```

**해자 메커니즘:** 피드백이 축적되면 프로젝트별 스코어링 가중치를 자동 조정할 수 있다. 6개월 사용 후에는 "이 프로젝트에서 어떤 문서가 어떤 작업에 유용한지"를 학습한 상태가 된다. 이 학습 데이터는 다른 도구로 옮기면 사라진다 → **전환 비용**.

### 4.3 Agent 연동 설정

```json
// .mcp.json (프로젝트 루트)
{
  "mcpServers": {
    "ddmi": {
      "command": "ddmi",
      "args": ["serve", "--watch"]
    }
  }
}
```

> Note: CLI-first 구조. CLI 도구(Claude Code, Codex 등)가 있으면 추가 비용 없이 작동한다. CLI가 없으면 `config.toml`에 API 키를 설정하여 동일 기능을 사용할 수 있다. 핵심 쿼리 경로(context_assemble)는 CLI/API 모두 불필요.

---

## 5. Human Supervision — 상세 설계

### 5.1 Mission Control Dashboard

브라우저 기반 대시보드 (localhost:3000). Agent 작업 현황을 실시간 감독.

> **다중 채널 감독**: Dashboard는 유일한 감독 채널이 아니다. 개발자 워크플로우에 맞는 다중 채널을 제공한다:
> - **CLI**: `ddmi status`에서 미해결 충돌/대기 결정 수 표시 (MVP-1)
> - **Dashboard**: 상세 조회, 충돌 분석, 승인/거부 (MVP-1)
> - **Webhook** (Slack/Discord): 충돌 감지/승인 요청 알림 (Post-MVP)
> - **터미널 알림**: bell character + 요약 메시지 (Post-MVP)

#### 핵심 패널

| 패널 | 기능 |
|---|---|
| Project Health | 지식 일관성 점수, 미해결 충돌 수, 대기 중 결정 수 |
| Active Agents | 현재 작업 중인 Agent 목록 + 각각의 작업 상태 |
| Decision Queue | 인간 승인이 필요한 항목 (충돌 해결, 파일 생성, 스펙 변경 등) |
| Audit Trail | 시간순 감사 기록 스트림 |
| Activity Feed | 전체 프로젝트 활동 로그 |

### 5.2 Decision Gate

Agent가 `require_approval: true`로 변경을 요청하거나, 시스템이 충돌을 감지하면 Decision Queue에 등록.

#### 사람의 액션 3가지

1. **승인 (Approve)** — AI 제안대로 실행. 변경 자동 적용 + Audit Trail 기록.
2. **거부 (Reject)** — 변경을 차단. 사유 기록.
3. **수정 지시 (Modify)** — 자연어로 수정 방향을 지시. Agent가 재작업.

#### 충돌 해결 플로우

```
충돌 감지 → Conflict 카드 생성 → AI가 분석 + 대안 제안
  → 영향 분석 자동 실행 (어떤 파일이 영향받는지)
  → 변경 미리보기 (diff) 생성
  → 사람이 승인/거부/수정지시
  → 실행 → 관련 파일 자동 업데이트 → Agent에 후속 작업 할당
  → Audit Trail 기록 (결정자, 근거, 영향 파일, 이전/이후 값)
```

---

## 6. Tech Stack — 기술 스택

| 영역 | 선택 | 이유 |
|---|---|---|
| **Language** | TypeScript (Node.js) | MCP SDK 1급 지원, Agent 생태계 호환성 |
| **Vector DB** | LanceDB (embedded) | 서버 불필요, 단일 디렉토리 내 임베디드 실행. .gitignore로 분리 후 rebuild 가능 |
| **Metadata DB** | SQLite (better-sqlite3) | 단일 파일, 빠른 쿼리, 프로젝트 내 독립 실행 |
| **Embedding** | @xenova/transformers (내장) | npm install만으로 완전 로컬 실행. 기본 모델: `paraphrase-multilingual-MiniLM-L12-v2` (다국어) |
| **LLM (인덱싱)** | CLI-first (Ollama → CLI → API) | 관계 추출, 충돌 감지 등. CLI가 있으면 추가 비용 $0, 없으면 사용자 API 키 |
| **LLM (분석)** | CLI-first (CLI → Ollama → API) | Decision Gate 분석. CLI는 사용자 구독에 포함, API는 사용자 키 |
| **MCP Transport** | stdio (로컬) + SSE (원격) | stdio: Claude Code/Cursor 즉시 연동. SSE: 팀 서버 |
| **MD 파서** | unified/remark 생태계 | remark-parse + remark-frontmatter + remark-gfm |
| **파일 감시** | chokidar | 크로스 플랫폼 FS 이벤트 |
| **Dashboard UI** | localhost 웹서버 (Hono + htmx) or React | MVP는 최소 UI. Tauri는 후기 옵션 |
| **패키지 배포** | npm (`npx ddmi init`) | 글로벌 CLI 설치 |

### AI Provider 아키텍처

ddmi는 **CLI-first** 전략을 취한다. 사용자의 기존 CLI 도구를 우선 활용하고, CLI가 없는 환경에서는 사용자의 API 키로 동일 기능을 제공한다. 핵심 쿼리 경로(context_assemble)에는 LLM이 불필요하므로, CLI/API 모두 없어도 기본 기능은 작동한다.

```
┌─────────────────────────────────────────────────────┐
│              AIProvider interface                    │
│   chat(prompt) → string                             │
│   chatJSON<T>(prompt, schema) → T                   │
│   healthCheck() → boolean                           │
├──────────┬──────────┬──────────┬───────────────────┤
│ CLI      │ Ollama   │ API      │ Pipe              │
│ claude   │ HTTP API │ 사용자   │ stdin/            │
│ codex    │ 완전로컬 │ API 키   │ stdout            │
│ gemini   │ 무료     │ 유료     │ 범용              │
│ llm      │          │ 항상작동 │ 어댑터            │
└──────────┴──────────┴──────────┴───────────────────┘
 우선순위: CLI → Ollama → API (auto 모드 기준)

┌─────────────────────────────────────────────────────┐
│           EmbeddingProvider interface                │
│   embed(texts) → number[][]                         │
├──────────────┬─────────────┬────────────────────────┤
│ transformers │ Ollama      │ API (사용자 키)        │
│ .js (내장)   │ nomic-embed │ OpenAI Ada            │
│ 기본값       │ 이미 설치 시│ 유료                  │
└──────────────┴─────────────┴────────────────────────┘
```

**AI 호출이 발생하는 8개 지점과 분류:**

| 지점 | 타이밍 | 빈도 | 사용 프로바이더 | 비용 |
|---|---|---|---|---|
| 청크 임베딩 | 인덱싱 시 | 파일당 5~20회 | EmbeddingProvider (transformers.js) | $0 (내장) |
| 질의 임베딩 | 쿼리 시 | 쿼리당 1회 | EmbeddingProvider (transformers.js) | $0 (내장) |
| 관계 추출 | 인덱싱 시 | 후보 쌍당 1회 | AIProvider (Ollama/CLI: $0, API: 사용자 키) | CLI가 있으면 $0 |
| 충돌 감지 | 인덱싱/변경 시 | 동일 주제 쌍당 1회 | AIProvider (Ollama/CLI: $0, API: 사용자 키) | CLI가 있으면 $0 |
| 엔티티 추출 | 인덱싱 시 | 청크당 1회 | AIProvider (Ollama/CLI: $0, API: 사용자 키) | CLI가 있으면 $0 |
| 문서 유형 분류 | 인덱싱 시 | 파일당 1회 (조건부) | AIProvider (Ollama/CLI: $0, API: 사용자 키) | CLI가 있으면 $0 |
| 충돌 분석 + 대안 | Decision Gate 시 | 충돌당 1회 (드묾) | AIProvider (CLI/API) | CLI: $0 (구독 포함), API: 사용자 키 |
| 영향 분석 | Decision Gate 시 | 결정당 1회 (드묾) | AIProvider (CLI/API) | CLI: $0 (구독 포함), API: 사용자 키 |

**핵심: 쿼리 경로(context_assemble)에는 LLM 호출이 0회.** 임베딩(transformers.js) → 벡터 검색(LanceDB) → 스코어링(수학) → 패킹(알고리즘) → 조립(문자열). 전부 전통 알고리즘.

#### CLI Subprocess 실행 방식

각 AI Provider는 `healthCheck()` 메서드를 구현한다. `ddmi init` 시점에 간단한 테스트 프롬프트(`"Say OK"`)를 보내 정상 응답 여부, JSON 출력 가능 여부, 응답 시간을 검증한다. 실패 시 해당 provider를 비활성화하고 fallback 체인의 다음 provider로 이동한다. CLI 도구의 버전 호환성을 핀(pin)하는 것은 비현실적이므로(사용자 환경 통제 불가), 대신 실행 시점 검증 + graceful fallback으로 대응한다.

긴 프롬프트는 반드시 stdin pipe 또는 임시 파일로 전달한다 (CLI 인자 길이 제한 대응):

```bash
# 기본 패턴: 프롬프트를 stdin으로 파이프
cat /tmp/ddmi-prompt-xxxxx.txt | claude -p --output-format json

# Codex
cat /tmp/ddmi-prompt-xxxxx.txt | codex -q

# Gemini CLI
cat /tmp/ddmi-prompt-xxxxx.txt | gemini prompt

# llm CLI (Simon Willison)
cat /tmp/ddmi-prompt-xxxxx.txt | llm

# Ollama (HTTP API, CLI 아닌 직접 호출)
curl -s http://localhost:11434/api/chat -d '{"model":"llama3.2","messages":[...]}'
```

#### 태스크별 라우팅 전략

```
인덱싱 작업 (빈번, 분류 태스크)
  → Ollama 사용 가능? → Ollama (로컬, 빠름, 무료)
  → Ollama 없음? → 사용자 CLI (claude -p, codex -q 등) — 구독 포함, $0
  → CLI도 없음? → API (사용자 키) — 항상 작동, 유료
  → 모두 없음? → LLM 기능 비활성화, Level 1 모드로 동작

Decision Gate 분석 (드묾, 추론 필요)
  → 사용자 CLI (claude -p, codex -q 등) — 고급 모델 활용
  → CLI 없음? → API (사용자 키) — 고급 모델 선택 가능
  → 둘 다 없음? → Ollama (품질 낮을 수 있음, 경고 표시)
```

#### AITaskQueue — 배치 작업큐 시스템

AI 태스크를 개별 실행하지 않고, 작업큐에 모아서 배치 실행한다. CLI subprocess의 프로세스 생성 오버헤드를 최소화하고, 프롬프트를 병합하여 1회 호출로 다수의 결과를 받는다.

```typescript
// src/ai/queue.ts

interface AITask {
  id: string;
  type: AITaskType;
  priority: "immediate" | "batch";
  prompt: string;
  context: object;                   // 원본 데이터 (결과 매핑용)
  resolve: (result: any) => void;
  reject: (error: any) => void;
}

type AITaskType =
  | "relation_extraction"    // batch
  | "conflict_detection"     // batch
  | "entity_extraction"      // batch
  | "doc_classification"     // batch
  | "conflict_analysis"      // immediate
  | "impact_analysis";       // immediate

class AITaskQueue {
  private queue: Map<AITaskType, AITask[]>;
  private batchSize = 10;           // 한 배치에 묶을 최대 태스크 수
  private flushInterval = 3000;     // ms — 이 시간 동안 새 태스크 없으면 flush
  private concurrentLimit = 3;      // 동시 CLI 실행 제한

  // 태스크 추가 — Promise를 반환하여 호출자가 결과를 await
  async enqueue(task): Promise<any> {
    return new Promise((resolve, reject) => {
      if (task.priority === "immediate") {
        this.executeImmediate({ ...task, resolve, reject });
      } else {
        this.addToQueue({ ...task, resolve, reject });
        this.checkFlush(task.type);
      }
    });
  }

  // 배치 flush: 같은 타입의 태스크를 묶어 1회 CLI 호출
  private async flushBatch(type: AITaskType) {
    const tasks = this.queue.get(type)?.splice(0, this.batchSize) || [];
    const mergedPrompt = buildBatchPrompt(type, tasks);
    const rawResult = await this.provider.chat(mergedPrompt);
    const results = parseBatchResponse(rawResult, tasks.length);
    tasks.forEach((task, i) => task.resolve(results[i]));
  }
}
```

**배치 프롬프트 병합 예시:**

```
// 개별 호출 (50회): 쌍마다 1회 CLI 실행
"다음 두 섹션의 관계를 분석하세요: ..."  × 50번

// 배치 호출 (5회): 10쌍을 1회 CLI에 묶어서
"다음 10개 섹션 쌍의 관계를 각각 분석하고, JSON 배열로 반환하세요.
[{ "pair_id": 1, "section_a": "...", "section_b": "..." }, ...]
→ 응답: [{ "pair_id": 1, "relation": "depends_on", "confidence": 0.9 }, ...]"
```

**flush 조건 (어느 하나라도 만족 시 실행):**
1. 큐에 `batchSize`(기본 10)개 이상 쌓임
2. `flushInterval`(기본 3초) 동안 새 태스크 없음
3. 호출자가 명시적으로 `queue.flush()` 호출 (인덱싱 완료 시)

**Immediate vs Batch 라우팅:**

| 태스크 | 모드 | 이유 |
|---|---|---|
| relation_extraction | **Batch** | 인덱싱 시 수십~수백 쌍 발생, 지연 허용 |
| conflict_detection | **Batch** | 동일, 인덱싱 시 대량 발생 |
| entity_extraction | **Batch** | 청크당 1회, 인덱싱 시 대량 발생 |
| doc_classification | **Batch** | 파일당 1회, 드물지만 배치 가능 |
| conflict_analysis | **Immediate** | Decision Gate에서 사람이 결과를 기다리는 중 |
| impact_analysis | **Immediate** | Decision Gate에서 사람이 결과를 기다리는 중 |

**성능 (100개 파일, 50개 관계 쌍 기준):**
- 개별 호출: 50회 × ~2초 = ~100초
- 배치 (10쌍/배치): 5회 × ~4초 = ~20초 (80% 절감)

**JSON 파싱 견고성:**
CLI 응답에서 JSON을 추출할 때, stdout에 경고/진행률/ANSI 코드가 섞일 수 있다.
`extractJSON(raw)` 유틸리티를 통해: (1) 첫 `{` 또는 `[` 부터 마지막 `}` 또는 `]` 까지 추출, (2) 파싱 실패 시 3회 재시도, (3) 그래도 실패 시 해당 태스크 skip + 경고 로그.

### 디렉토리 구조 (프로젝트)

```
ddmi/
├── src/
│   ├── core/
│   │   ├── index.ts              # Semantic Index (파싱, 청킹, 임베딩)
│   │   ├── curator.ts            # Context Curator (스코어링, 패킹)
│   │   ├── feedback.ts           # Feedback Loop (피드백 수집, 가중치 학습)
│   │   ├── relations.ts          # Relation Engine (관계 추출, 충돌 감지)
│   │   ├── audit.ts              # Audit Trail (로깅, 쿼리)
│   │   └── watcher.ts            # 파일 변경 감시 + 증분 업데이트
│   ├── ai/
│   │   ├── provider.ts           # AIProvider + EmbeddingProvider 인터페이스
│   │   ├── router.ts             # 태스크별 프로바이더 라우팅 로직
│   │   ├── queue.ts              # AITaskQueue — 배치 작업큐 + flush 로직
│   │   ├── providers/
│   │   │   ├── cli-subprocess.ts # Claude Code, Codex, Gemini, llm CLI 위임
│   │   │   ├── ollama.ts         # Ollama HTTP API (채팅 + 임베딩)
│   │   │   ├── pipe.ts           # stdin/stdout 범용 어댑터
│   │   │   ├── api.ts            # API 직접 호출 (fallback)
│   │   │   └── transformers.ts   # @xenova/transformers 임베딩 (내장, 기본값)
│   │   └── prompts/
│   │       ├── relation-extraction.ts  # 관계 추출 프롬프트 템플릿
│   │       ├── conflict-detection.ts   # 충돌 감지 프롬프트 템플릿
│   │       ├── entity-extraction.ts    # 엔티티 추출 프롬프트 템플릿
│   │       ├── doc-classification.ts   # 문서 유형 분류 프롬프트 템플릿
│   │       ├── conflict-analysis.ts    # 충돌 분석 + 대안 생성 프롬프트
│   │       └── impact-analysis.ts      # 영향 분석 프롬프트
│   ├── mcp/
│   │   ├── server.ts             # MCP Server 메인
│   │   ├── tools/
│   │   │   ├── context-assemble.ts
│   │   │   ├── context-feedback.ts   # MVP-0: 피드백 수집
│   │   │   ├── knowledge-query.ts
│   │   │   ├── mutate-audited.ts
│   │   │   ├── shared-memory.ts
│   │   │   └── event-broadcast.ts
│   │   └── transport.ts          # stdio / SSE 어댑터
│   ├── storage/
│   │   ├── sqlite.ts             # SQLite 스키마 + 쿼리
│   │   └── lance.ts              # LanceDB 래퍼
│   ├── dashboard/                # Mission Control UI
│   │   ├── server.ts             # Hono 웹서버
│   │   ├── pages/
│   │   └── static/
│   └── cli/
│       ├── init.ts               # ddmi init (AI provider 자동 감지 포함)
│       ├── index.ts              # ddmi index (수동 인덱싱)
│       ├── serve.ts              # ddmi serve (MCP + Dashboard)
│       ├── status.ts             # ddmi status (프로젝트 건강도)
│       └── query.ts              # ddmi query "질문" (CLI 쿼리)
├── package.json
├── tsconfig.json
└── README.md
```

### 사용자 프로젝트에 생성되는 구조

```
user-project/
├── docs/                         # 사용자의 MD 파일들
│   ├── decisions/
│   ├── specs/
│   ├── meetings/
│   └── research/
├── .ddmi/                     # ddmi 인덱스 (gitignore 권장)
│   ├── index.db                  # SQLite (메타, 관계, 감사)
│   ├── vectors.lance/            # LanceDB (임베딩)
│   └── config.toml               # 프로젝트별 설정
├── .mcp.json                     # MCP 서버 설정
└── .gitignore                    # .ddmi/ 포함
```

---

## 7. CLI Interface

```bash
# 초기화 (프로젝트 루트에서)
npx ddmi init

# 인덱싱 (최초 또는 수동 재구축)
ddmi index                     # 전체 인덱싱
ddmi index --incremental       # 변경 파일만

# MCP 서버 + Dashboard 시작
ddmi serve                     # MCP (stdio) + Dashboard (localhost:3000)
ddmi serve --watch             # + 파일 변경 감시 자동 리인덱싱
ddmi serve --transport sse     # SSE 모드 (팀 서버용)

# 프로젝트 상태 확인
ddmi status                    # 파일 수, 충돌 수, 일관성 점수 등

# CLI 쿼리 (빠른 확인용)
ddmi query "캐시 전략 관련 결정사항"
ddmi query "미해결 충돌 목록"

# 감사 로그 조회
ddmi audit --last 20           # 최근 20건
ddmi audit --file specs/cache-strategy.md  # 특정 파일 이력
```

---

## 8. MVP Roadmap

### Day 1 — 핵심 가설 검증 (착수 전 필수)

ddmi의 존재 이유인 "큐레이션 > 전체 덤프" 가설을 **구현 전에** 검증한다.

**실험 (3~4시간):**
1. 실제 MD 파일 50개 이상의 프로젝트를 선택
2. Python + sentence-transformers + LanceDB로 간단한 스크립트 작성
3. **30개 이상의 평가 질문**을 작성 (다양한 난이도/주제 분포)
4. **3가지 방식 비교:**
   - A: 전체 파일 덤프를 LLM에 입력
   - B: 벡터 유사도 상위 5개 섹션만 LLM에 입력 (단순 top-K)
   - C: 유사도 + recency + authority 가중치로 스코어링한 상위 5개 섹션 (Curator 시뮬레이션)
5. 정확도, 구체성(1~5점), 환각률 측정
6. 평가 스크립트(`eval/run_experiment.py`)를 작성하여, 이후 가중치 변경 시 자동 재평가 가능하도록 함

**성공 기준:**
- 1차: B가 A보다 20% 이상 나으면 → "큐레이션 > 전체 덤프" 확정, 본 구현 돌입.
- 2차: C가 B보다 유의미하게 나으면 → 스코어링 함수 가치 확정. C ≈ B이면 스코어링 전략 재설계.

**실패 시:** Curator 스코어링 전략을 수정하거나, ddmi의 핵심 가치를 재정의.

---

### MVP-0 (3주) — 핵심 가치 증명

**목표:** "Claude Code에서 ddmi로 최적 컨텍스트를 받아 작업하는 것"이 수동 컨텍스트 선택보다 낫다는 것을 end-to-end 검증.
**범위:** Semantic Index + Context Curator + `context_assemble` MCP 도구 1개 + CLI + 평가 프레임워크
**성공 기준:** §1의 "첫 번째 고객"이 실제 프로젝트에서 일주일간 사용 후 계속 사용하겠다고 판단.

> **MVP-0에 포함하지 않는 것 (MVP-1로 이동):**
> AI Provider 추상화(`src/ai/provider.ts`, `router.ts`), AITaskQueue, CLI Subprocess 연동, Ollama Provider, knowledge_query MCP 도구, Graceful Degradation Level 0/2. MVP-0에서 필요한 AI는 **transformers.js 임베딩 하나뿐**이다 — 쿼리 경로에 LLM 호출이 0회이므로 이것으로 충분하다.

**스케일 목표 (MVP-0 기준):**
- 파일 수: 500개 MD 파일, ~10,000 청크
- 인덱싱: 전체 5분 이내 (증분 업데이트는 변경 파일당 < 2초)
- 쿼리 응답: `context_assemble` 호출부터 결과 반환까지 < 2초
- 메모리: 인덱싱 시 < 500MB RSS, 쿼리 시 < 200MB RSS
- 수천 개 파일은 Phase 2에서 벤치마크 후 임베딩 캐시 전략 검토

#### Week 1: Semantic Index Core

**목표**: MD 파일 파싱 + 청킹 + 임베딩 저장

**작업**:
- [ ] 프로젝트 scaffolding (TypeScript, package.json, tsconfig)
- [ ] MD 파서 구현 (remark 기반: frontmatter, 헤딩 트리, 코드블록)
- [ ] 청킹 로직 (섹션 단위, 500토큰 상한, 50토큰 하한)
- [ ] 임베딩 모듈: transformers.js (다국어 모델 `paraphrase-multilingual-MiniLM-L12-v2`)
- [ ] 다국어 임베딩 품질 검증: 한국어/영어 혼합 문서 10개로 유사도 검색 정확도 수동 확인
- [ ] LanceDB 저장/검색 래퍼 (Section-level 임베딩만)
- [ ] SQLite 스키마 초기화 (files, chunks 테이블)
- [ ] `ddmi init` CLI
- [ ] `ddmi index` CLI

**검증**: 50개 MD 파일 인덱싱 시간 < 30초, 시맨틱 검색 정확도 수동 평가

#### Week 2: Context Curator + 평가 프레임워크

**목표**: 스코어링 + 예산 패킹 + 출력 조립 + 품질 평가 자동화

**작업**:
- [ ] 질의 파싱 (intent → 주제 벡터 + 정보 유형 분류)
- [ ] 후보 수집 (벡터 유사도 top-K)
- [ ] 스코어링 함수 구현 (semantic_sim, recency, authority, task_alignment, redundancy penalty)
  - 가중치 w₁~w₅는 config.toml의 `[curator.weights]`에 노출
  - 초기값: w₁=0.35, w₂=0.20, w₃=0.15, w₄=0.15, w₅=0.15
- [ ] coverage_score 계산 (§3.2 공식 구현)
- [ ] debug_scores 옵션 구현 (선택 근거 투명성)
- [ ] Budget packing (greedy 알고리즘)
- [ ] ContextBundle 조립 (blocks + provenance + meta_summary)
- [ ] `ddmi query` CLI 연동
- [ ] `ddmi eval` CLI — Day 1 평가 스크립트의 TypeScript 포팅

**검증**: Day 1 실험의 정밀 재현 — TypeScript 구현으로 동일 30개 질문에 A(전체 덤프) vs B(단순 top-K) vs C(스코어링 적용) 품질 비교. 가중치 변경 시 `ddmi eval` 한 줄로 재평가 가능.

#### Week 3: MCP Server + 실사용 검증

**목표**: context_assemble MCP 도구 구현 → Claude Code에서 실제 연동 → 첫 번째 고객 검증

**작업**:
- [ ] MCP Server 프레임워크 (stdio transport)
- [ ] context_assemble 도구 구현
- [ ] `ddmi serve` CLI (MCP 서버 시작)
- [ ] `ddmi serve --watch` (chokidar 파일 감시 + 증분 리인덱싱)
- [ ] .mcp.json 생성 자동화
- [ ] 에러 핸들링 강화
- [ ] 실제 프로젝트 (50+ MD 파일)에서 전체 플로우 테스트
- [ ] README.md 작성 (설치, 설정, 사용법)
- [ ] npm 패키지 준비

**검증**:
- Claude Code에서 `context_assemble` 호출 → 실제 컨텍스트 수신 → 코드 작성 성공
- "첫 번째 고객" 프로필에 맞는 사용자 1~2명에게 배포, 피드백 수집
- 핵심 질문: "수동으로 컨텍스트를 고르는 것보다 낫습니까?"

---

### MVP-1 (5주 추가) — AI Provider + 관계 + 감사 + 감독

**전제:** MVP-0이 핵심 가치를 검증한 후에만 착수.
**목표:** AI Provider 추상화 + Relation Engine + Audit Trail + mutate_audited + Mission Control 최소 버전

#### Week 4: AI Provider 추상화 + knowledge_query

**목표**: CLI-first AI 프로바이더 체계 구축, knowledge_query MCP 도구 추가

**작업**:
- [ ] AI Provider 추상화 레이어 (`src/ai/provider.ts`, `router.ts`)
- [ ] CLI Subprocess Provider 구현 (claude, codex, gemini, llm)
- [ ] Ollama Provider 구현
- [ ] API Provider 구현 (사용자 API 키: Anthropic, OpenAI)
- [ ] 각 provider `healthCheck()` 구현 + `ddmi init`에서 자동 감지
- [ ] AITaskQueue 배치 시스템 구현 (`src/ai/queue.ts`)
- [ ] knowledge_query MCP 도구 구현
- [ ] Graceful Degradation 3단계 구현: Level 0(BM25 + 명시적 링크) → Level 1(+ 벡터) → Level 2(+ LLM). `ddmi init`에서 사용 가능한 수준 자동 감지.
- [ ] 에러 핸들링 + JSON 파싱 견고성 (extractJSON 유틸리티)

**검증**: CLI(claude -p), Ollama, API 각각으로 간단한 LLM 태스크 실행 성공. healthCheck 실패 시 fallback 체인 정상 작동.

#### Week 5: Relation Engine + 배치 실행

**목표**: 관계 추출 + 충돌 감지 (배치 실행)

**작업**:
- [ ] 명시적 링크 파싱 ([[wikilink]], markdown link)
- [ ] 임베딩 유사도 기반 후보 관계 쌍 추출
- [ ] **유사도 임계값 튜닝**: 실제 프로젝트의 청크 간 코사인 유사도 분포 시각화 → 자연 클러스터 경계 탐색 → 최적 임계값 결정 (0.85는 시작점). Decision Queue 노이즈 방지를 위해 초기에는 high severity만 표시, 사용자 opt-in으로 medium/low 활성화.
- [ ] **충돌 검사 범위 제한**: 전체 N² 비교 대신, "최근 변경된 청크 vs 기존 청크"로 범위를 한정하여 증분 충돌 감지. 프로젝트가 커져도 비교 횟수가 선형 증가하도록 설계.
- [ ] AITaskQueue 배치 실행 완성 (flush 조건, 동시성 제한, 에러 핸들링)
- [ ] 관계 추출 프롬프트 템플릿 + 배치 프롬프트 병합 (`src/ai/prompts/`)
- [ ] 충돌 감지 프롬프트 + 심각도 판정
- [ ] relations, conflicts 테이블 저장
- [ ] Curator에 충돌 자동 포함 로직 연결

**검증**: 인위적으로 5개 모순 삽입 → 감지율 80% 이상 (high-precision/low-recall 전략). 배치 실행이 개별 호출 대비 60%+ 빠른지.

#### Week 6: Audit Trail + mutate_audited

**목표**: 감사 기록 + 파일 변경 도구

**작업**:
- [ ] Audit Trail 모듈 (append-only 설계, 해시 체인으로 탬퍼 감지)
- [ ] mutate_audited MCP 도구 구현 (create, patch, replace_section)
- [ ] 변경 후 자동 충돌 재검사 (변경된 청크만)
- [ ] audit_log 테이블 자동 기록
- [ ] `ddmi audit` CLI

**검증**: Agent가 mutate_audited로 파일 변경 → 감사 기록 생성 → 충돌 재검사 작동

#### Week 7: Mission Control v0

**목표**: 충돌 알림 + Decision Gate + Audit Trail 브라우저 UI

**작업**:
- [ ] Hono 웹서버 + 정적 파일 서빙
- [ ] Dashboard 메인 페이지 (Project Health 메트릭)
- [ ] Decision Queue 페이지 (충돌/승인 카드)
- [ ] 승인/거부/수정지시 API 엔드포인트
- [ ] Audit Trail 페이지 (시간순 로그)
- [ ] `ddmi serve`에 Dashboard 통합
- [ ] `ddmi status` CLI에 미해결 충돌/대기 결정 수 표시

**검증**: 충돌 발생 → Dashboard에 표시 → 승인 → 파일 업데이트 → Audit 기록 확인

#### Week 8: MVP-1 통합 테스트

**목표**: AI Provider + Relation + Audit + Dashboard end-to-end 검증

**작업**:
- [ ] 전체 플로우 통합 테스트
- [ ] Decision Gate에서 CLI/API를 통한 충돌 분석 + 대안 생성 (immediate 모드)
- [ ] 다국어 임베딩 스케일 검증 (한국어/영어 혼합 50+ 파일 프로젝트)
- [ ] 에러 핸들링 강화
- [ ] 문서 업데이트

**검증**: Agent가 파일 생성 → 충돌 감지 → Dashboard 표시 → 인간 승인 → 파일 수정 → 감사 기록 완성

---

## 9. Post-MVP — 확장 로드맵

### Phase 2 (Month 3~4): Mission Control — 시각화 + 탐색

> 기본기 위에 차별화를 얹는다. 모든 기능이 정성스럽게, 프로답게.

#### 2-1. Knowledge Explorer — 프로젝트의 지식 지형을 보여준다

**파일 탐색기 (File Navigator)**
- 단순한 파일 목록이 아니다. 각 파일에 **살아 있는 메타데이터**가 붙는다:
  - docType 배지 (decision, spec, meeting, research)
  - 완성도 게이지 (체크리스트 기반)
  - 최근 Agent 활용 빈도 (feedback_log에서 계산 — 많이 참조되는 문서가 위로)
  - 마지막 수정 시간 + 수정한 Actor (human or agent)
  - 관련 충돌 수 (빨간 뱃지)
- 트리 뷰 + 리스트 뷰 전환. docType별 그룹핑.

**MD 프리뷰 (Document Viewer)**
- 렌더링된 마크다운 + **ddmi 어노테이션 오버레이**:
  - 각 청크의 스코어링 히트맵 (최근 쿼리에서 얼마나 자주 선택되었는가)
  - 충돌 관련 섹션은 빨간 사이드바로 표시 — 클릭하면 상대 청크와 diff 뷰
  - 인라인 관계 표시: 이 섹션을 참조하는 다른 문서 목록 (backlinks)
  - 감사 이력 사이드패널: 이 파일의 변경 타임라인

**검색 (Unified Search)**
- 키워드 + 시맨틱 + 관계 인식 통합 검색
- "캐시 전략" 검색 시: 키워드 매칭 결과 + 의미적으로 유사한 청크 + 관계로 연결된 문서
- 검색 결과에 각 청크의 **스코어링 breakdown** 표시 (왜 이 결과가 나왔는지 투명하게)
- 필터: docType, 날짜 범위, 작성자, 충돌 여부

#### 2-2. Knowledge Graph — 프로젝트의 신경망을 시각화한다

**관계 그래프 (D3.js force-directed)**
- 노드 = 파일 (크기 = 토큰 수, 색상 = docType)
- 엣지 = 관계 (파란선 = references, 초록선 = depends_on, 빨간선 = contradicts)
- **시간 슬라이더**: 드래그하면 프로젝트가 시간에 따라 성장하는 모습을 애니메이션으로
- 노드 클릭 → 해당 파일의 프리뷰 + 관련 관계 목록 + 감사 이력
- 충돌 노드는 펄스 애니메이션으로 주의 환기
- 시맨틱 클러스터링: 유사한 주제의 문서들이 자연스럽게 모이도록 (임베딩 2D 투영)

**청크 수준 줌 (Chunk-level Zoom)**
- 파일 노드를 더블클릭하면 내부 청크들이 펼쳐짐
- 청크 간 관계 (같은 파일 내 + 다른 파일)를 세밀하게 탐색
- 스코어링 중요도에 따라 청크 노드 크기 변화

#### 2-3. Conflict Resolution Studio — 충돌을 해결하는 전용 공간

**Diff 뷰 (Side-by-Side)**
- 두 충돌 청크를 나란히 표시 + 차이점 하이라이트
- 각 청크의 출처 파일, 작성 시점, 작성자 정보
- AI 분석 결과: "왜 이것이 충돌인가" 한 문장 설명

**충돌 컨텍스트 맵**
- 충돌 쌍을 중심으로 관련 문서들의 미니 그래프
- "이 결정을 바꾸면 영향받는 문서 N개" 시각적으로 표시

**Decision Gate 워크플로**
- 승인 / 거부 / 수정 지시 — 각 액션이 audit_log에 기록
- 수정 지시 시: 자연어로 방향을 입력 → Agent가 재작업 (mutate_audited 연동)
- 해결 이력: 이전에 비슷한 충돌을 어떻게 해결했는지 참고

#### 2-4. Audit Timeline — 프로젝트의 기억을 시간으로 풀어낸다

**인터랙티브 타임라인**
- 수직 타임라인: 각 이벤트가 카드로 표시
- 이벤트 카드: Actor 아바타 + 행동 + 대상 파일 + rationale
- 필터: Actor별, 이벤트 유형별, 파일별
- 기간 선택: "지난 1주" / "이번 스프린트" / 전체
- 해시 체인 무결성 상태: 타임라인 상단에 "Chain Valid ✓" 또는 "BROKEN at event X ✗"

**변경 영향 추적 (Impact Trace)**
- 특정 이벤트를 클릭 → "이 변경 이후에 발생한 모든 관련 이벤트" 하이라이트
- basedOn 관계를 따라가는 역추적: "이 결정의 근거는?" → 원본 문서까지

#### 2-5. Health Dashboard — 프로젝트의 바이탈 사인

**건강도 계기판**
- 전체 일관성 점수 (conflicts / total relations 기반)
- 문서 커버리지 (frontmatter 누락, 체크리스트 미완료)
- Agent 활용 효율 (context_assemble 결과 중 실제 사용된 비율 — feedback 기반)
- 트렌드 그래프: 일관성, 충돌 수, Agent 활용률의 주간/월간 추이

**조기 경고**
- "스펙 X가 3개월간 업데이트 안 됨 — 현재 코드와 괴리 위험"
- "결정문서 Y와 스펙 Z 사이에 새 충돌 감지 — 확인 필요"
- "피드백 데이터가 100건 이상 → 가중치 자동 튜닝 실행 권장"

#### 기술 선택

| 영역 | 도구 | 이유 |
|------|------|------|
| 프론트엔드 프레임워크 | React + Vite | 컴포넌트 재사용, 생태계 |
| 그래프 시각화 | D3.js + @visx | 커스터마이징 자유도, force-directed |
| Diff 뷰 | diff2html 또는 커스텀 | side-by-side 렌더링 |
| 차트 | Recharts 또는 @visx | React 네이티브 통합 |
| 실시간 | SSE (Server-Sent Events) | WebSocket보다 단순, 단방향 |
| MD 렌더링 | react-markdown + remark | 기존 파서 생태계 재사용 |

### Phase 3 (Month 5~6): Intelligence + Multi-agent

> 시각화 기반 위에 지능과 협업을 얹는다.

- Document-level 임베딩 → 파일 간 클러스터링 (Knowledge Graph에 시맨틱 군집 표시)
- Entity-level 임베딩 → 관계 그래프 노드 벡터화
- 피드백 기반 가중치 자동 튜닝 (100건 이상 수집 시 활성화)
- 프로젝트 건강도 자동 진단 + 조기 경고 시스템
- shared_memory MCP 도구 (Agent 간 지식 공유)
- event_broadcast MCP 도구 (Agent 간 이벤트 전파)
- 동시 수정 충돌 방지 (optimistic locking)
- SSE 기반 실시간 Dashboard 업데이트

### Phase 4 (Month 7~8): 생태계

- VS Code Extension (인라인 충돌 경고, Knowledge Graph 패널, 감사 이력)
- GitHub Action (PR 시 문서 일관성 자동 체크 + 충돌 리포트)
- Obsidian Plugin (기존 사용자 마이그레이션 경로)
- 팀 서버 모드 (인증 + 권한 + SSE)
- 크로스 프로젝트 지식 연결

---

## 10. Key Design Decisions Log

| # | 결정 | 근거 | 대안 | 거부 사유 |
|---|---|---|---|---|
| 1 | 에디터 경쟁 포기 → 인프라로 포지셔닝 | AI가 편집을 대체, 인프라는 AI가 의존 | Obsidian 플러그인 | 독립 가치 창출 어려움 |
| 2 | Context Curator를 핵심 기능으로 | 컨텍스트 윈도우 커져도 큐레이션 필요 | 단순 벡터 검색 | context rot 문제 미해결 |
| 3 | 모든 변경에 rationale 필수 | 감사 추적은 규제 수요 + Agent 자율성 대응 | 선택적 기록 | 추적 불가 시 가치 소멸 |
| 4 | MCP 표준 채택 | 주요 AI 도구 모두 지원 | 독자 API | 생태계 호환성 포기 불가 |
| 5 | 로컬 우선, 서버 불필요 | Git 호환, 프라이버시, 진입 장벽 최소화 | 클라우드 SaaS | MVP에서 불필요한 복잡도 |
| 6 | Semantic Canvas → Mission Control | "탐색"은 AI 대체 가능, "감독"은 인간 고유 역할 | 그래프 뷰 먼저 | 장기 가치 불확실 |
| 7 | TypeScript 선택 | MCP SDK 지원, npm 생태계, Agent 도구 호환 | Rust, Python | Rust=진입장벽, Python=성능 |
| 8 | CLI-first, API 지원 | CLI가 있으면 추가 비용 $0, 없으면 사용자 API 키로 동일 기능. 핵심 쿼리 경로는 LLM 불필요 | Zero API Key (API 미지원) | CLI 없는 환경에서 LLM 기능 사용 불가. "인프라"보다 "어댑터"에 가까워짐 |
| 9 | 임베딩에 transformers.js 내장 | npm install만으로 완전 로컬, 서버 불필요 | Ollama/API | Ollama는 별도 설치 필요 |
| 10 | 태스크별 AI 라우팅 | 빈번한 작업→로컬, 드문 고급 분석→CLI | 단일 프로바이더 | 비용/속도 최적화 불가 |
| 11 | MVP를 MVP-0(4주) + MVP-1(4주)으로 분리 | context_assemble 하나를 완벽하게 하는 것이 전부를 절반씩 하는 것보다 낫다 | 6주 단일 MVP | 범위 과다로 실패 리스크 |
| 12 | Day 1에 핵심 가설 검증 | 구현 전에 "큐레이션 > 전체 덤프" 확인. 실패 시 방향 수정 | 구현 후 검증 | 최대 4주 헛수고 리스크 |
| 13 | 임베딩 MVP에서 Section-level만 | 복잡도 1/3 축소, Doc/Entity는 Phase 3 | 3레벨 동시 구현 | MVP 속도 저하 |
| 14 | AITaskQueue 배치 실행 | CLI 오버헤드 80% 절감, 프롬프트 병합 | 개별 subprocess | 100초→20초, 10x 효율 |
| 15 | Graceful Degradation 3단계 | Level 0(BM25+링크)→1(+벡터)→2(+LLM). LLM 없어도 기본 기능 작동 | LLM 필수 의존 / 단일 레벨 | 진입 장벽 상승. 오프라인 미대응 |
| 16 | 다국어 임베딩 모델 기본값 | `paraphrase-multilingual-MiniLM-L12-v2`. 한/영 혼합이 주 시나리오 | `all-MiniLM-L6-v2` (영어) | 한국어 품질 치명적 저하. 모델 크기 2배(~260MB)는 감수 |
| 17 | Day 1 실험 3단계 (A/B/C) | A(덤프) vs B(top-K) vs C(스코어링). 스코어링 함수 자체의 가치도 검증 | A/B 2단계만 | 스코어링 함수 무가치 시 조기 발견 불가 |
| 18 | CLI healthCheck + fallback | `ddmi init`에서 provider 정상 동작 검증. 버전 핀 대신 실행 시점 검증 | CLI 버전 핀 | 사용자 환경 통제 불가. fallback 체인이 더 현실적 |
| 19 | MVP-0를 3주로 축소 (index + curator + context_assemble + eval) | AI Provider 추상화/AITaskQueue/CLI 연동은 쿼리 경로에 불필요. 가설 검증 전에 플랫폼 공사를 하면 안 됨 | 4주 MVP-0 (Provider 포함) | 핵심 가치 검증과 무관한 작업이 MVP-0에 섞임 |
| 20 | "첫 번째 고객" 명시 | "AI 코딩 에이전트를 쓰고 MD 100+개 리포를 다루는 소규모 팀". 성공 기준을 고객 행동으로 정의 | 페르소나 없이 시스템 구축 | "누구의 문제를 푸는가"가 없으면 로드맵이 기능 나열로 흐름 |
| 21 | Curator 스코어링 공식 명시 | task_alignment 매트릭스, coverage_score, redundancy penalty, 가중치 초기값을 §3.2에 정의 | "나중에 실험적으로 결정" | 품질 문제 발생 시 원인 추적 불가. debug_scores로 투명성 확보 |
| 22 | 충돌 감지 high-precision/low-recall 시작 | 코사인 유사도 필터의 구조적 한계 인정. recall 개선은 Phase 3 Entity-level 임베딩에서 | 높은 recall 목표 | false positive가 Decision Queue를 오염시키는 게 더 위험 |
| 23 | context_feedback으로 피드백 루프 구축 (MVP-0) | 피드백 축적 → 프로젝트별 가중치 자동 학습 → 시간이 만드는 해자. 사용할수록 좋아지는 시스템 | 고정 가중치만 제공 | 프로젝트 종속 데이터 없으면 전환 비용 0 → 해자 없음 |
| 24 | 오픈소스(MIT) + 포맷 해자 전략 | 코드 보호 대신 `.ddmi/` 스키마를 표준으로 만들어 생태계 종속성 확보 | 클로즈드 소스 | 개발자 도구는 오픈소스가 기본 기대값. 닫으면 채택 안 됨 |

---

## 11. AGENTS.md — Agent 지시 사항

이 파일을 프로젝트 루트의 `AGENTS.md`로도 사용할 수 있다.

```markdown
# ddmi 개발 Agent 지시 사항

## 코드 스타일
- TypeScript strict mode
- 함수형 우선, 클래스는 상태 관리 시에만
- 에러는 Result 패턴 (neverthrow) 또는 명시적 try-catch
- 주석은 "왜(why)"만. "무엇(what)"은 코드가 말해야 함

## 테스트
- vitest 사용
- 각 모듈에 단위 테스트 필수
- Core 엔진 함수는 순수 함수로 작성 (IO 분리)

## 커밋 컨벤션
- feat: 새 기능
- fix: 버그 수정
- refactor: 리팩터링
- docs: 문서
- test: 테스트

## 중요 제약
- .md 원본 파일은 절대 자동 수정 금지 (mutate_audited를 통해서만)
- 모든 파일 변경에 rationale + based_on 필수
- Semantic Index는 읽기 전용 뷰. 인덱스 삭제해도 원본 무손실
```
