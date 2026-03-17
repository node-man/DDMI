# Phase 2.7 구현 계획서 — MCP 심화 + Agent 통합

> v0.3.0 출시 후, MCP 프로토콜 활용도를 높이고 AI 에이전트 경험을 강화한다.
> GitNexus의 MCP 패턴과 CLIProxyAPI의 provider 관리 패턴을 ddmi에 접목한다.

- **선행 조건**: Phase 2.6 완료 (v0.3.0 publish)
- **목표**: 에이전트가 ddmi를 더 효과적으로 활용할 수 있게 만드는 것
- **버전**: v0.4.0
- **참고**: `docs/COMPETITIVE-ANALYSIS.md` (패턴 출처 기록)

---

## 1. 왜 필요한가

Phase 2.6에서 Level 2→1 연결과 npm publish를 완료하면, 다음 병목은 **에이전트가 ddmi를 얼마나 잘 활용하는가**이다.

현재 ddmi MCP:
- **4 tools** (context_assemble, context_feedback, knowledge_query, mutate_audited)
- **0 resources**, **0 prompts**

GitNexus MCP (참고):
- **7 tools** + **5 resources** + **2 prompts** + **workflow hints**

MCP Resources와 Prompts는 에이전트가 ddmi를 "발견"하고 "학습"하는 데 도움을 준다. 지금은 에이전트가 context_assemble만 알고 나머지 기능은 모른다.

---

## 2. 목표 지표

| 지표 | 현재 | 목표 | 측정 방법 |
|------|------|------|-----------|
| MCP tools | 4 | 4 (유지) | - |
| MCP resources | 0 | **4** | MCP inspector |
| MCP prompts | 0 | **2** | MCP inspector |
| aimux retry 성공률 | 미구현 | **429 자동 복구 90%+** | AI 로그 분석 |
| Skills 자동 생성 | 미구현 | `ddmi skills` 명령 동작 | CLI 테스트 |

---

## 3. 작업 분해

### Week 1: MCP Resources + Prompts

**Day 1-2: MCP Resources (4종)**

```
새 파일: src/mcp/resources/
변경 파일: src/mcp/server.ts
```

| URI | 반환 | 용도 |
|-----|------|------|
| `ddmi://project/stats` | 파일 수, 청크 수, 관계 수, 충돌 수, 마지막 인덱싱 | 에이전트가 프로젝트 상태를 파악 |
| `ddmi://project/graph` | 파일 간 관계 요약 (상위 10개) | 에이전트가 문서 구조를 이해 |
| `ddmi://project/conflicts` | 미해결 충돌 목록 | 에이전트가 작업 전 충돌 확인 |
| `ddmi://project/schema` | 문서 유형, 관계 유형, 스코어링 가중치 | 에이전트가 ddmi 구조를 이해 |

MCP Resources는 읽기 전용이므로 리스크 낮음.

**Day 3: MCP Prompts (2종)**

```
새 파일: src/mcp/prompts/
변경 파일: src/mcp/server.ts
```

| 이름 | 용도 | 동작 |
|------|------|------|
| `drift_check` | "이 변경이 기존 결정과 충돌하나?" | context_assemble + 충돌 목록을 결합한 가이드 프롬프트 |
| `context_review` | "이 작업에 필요한 컨텍스트가 충분한가?" | context_assemble 결과의 coverage 평가 가이드 |

**Day 4-5: 테스트 + 에디터 통합 확인**

- MCP inspector로 리소스/프롬프트 접근 확인
- Claude Code에서 실제 사용 테스트
- 문서화: README에 MCP 기능 목록 업데이트

**검증 기준**:
- [ ] MCP inspector에서 4 리소스 조회 성공
- [ ] MCP inspector에서 2 프롬프트 실행 성공
- [ ] Claude Code에서 리소스 읽기 동작 확인

### Week 2: Skills 자동 생성 + aimux v0.2.0

**Day 1-2: Skills 자동 생성**

```
새 파일: src/cli/skills.ts
변경 파일: src/cli/main.ts
```

- `ddmi skills` 명령: 인덱스 결과에서 `.claude/skills/generated/project-knowledge.md` 자동 생성
- 포함 내용: 프로젝트 요약, 핵심 문서 목록, 관계 맵, 충돌 경고
- GitNexus의 `--skills` 플래그 패턴 참고

**Day 3-5: aimux v0.2.0 — Credential Scheduler + Retry**

```
변경 파일: packages/aimux/src/
```

CLIProxyAPI에서 가져온 패턴:

- **Credential Scheduler**: provider → model → credential 3계층 스케줄링
- **Retry + Cooldown**: 429 → cooldown + 다음 credential 전환
- **retry-after 파싱**: provider별 (Gemini: RetryInfo, Claude: HTTP status)

이 작업은 aimux 독립 패키지 내에서 진행. ddmi 코드 변경 최소.

**검증 기준**:
- [ ] `ddmi skills` → .claude/skills/ 파일 생성
- [ ] aimux retry: 429 응답 시 자동 cooldown + 재시도
- [ ] aimux credential scheduler 단위 테스트

### Week 3: 통합 + 문서화 + v0.4.0

**Day 1-2: 통합 테스트**

- MCP resources + prompts + skills가 end-to-end로 동작 확인
- aimux v0.2.0을 ddmi에 통합 (의존성 업데이트)
- 4 provider 전체 테스트

**Day 3-4: 문서화 + publish**

- README 업데이트 (MCP 리소스/프롬프트 목록)
- CHANGELOG.md 업데이트
- aimux@0.2.0 publish → ddmi@0.4.0 publish

**Day 5: Phase 2.7 회고**

- MCP 활용도 개선 효과 평가
- Phase 3 계획 업데이트

**검증 기준**:
- [ ] aimux@0.2.0 npm publish 성공
- [ ] ddmi@0.4.0 npm publish 성공
- [ ] MCP 기능 전체 동작 확인 (4 tools + 4 resources + 2 prompts)

---

## 4. Phase 3과의 관계

| | Phase 2.7 (이번) | Phase 3 (다음) |
|---|---|---|
| MCP | resources + prompts 추가 | shared_memory, event_broadcast |
| aimux | v0.2.0 (retry/scheduler) | v0.3.0 (model mapping, streaming), v1.0.0 (OpenAI 호환 서버) |
| 학습 | skills 정적 생성 | 피드백 가중치 자동 학습 |
| 규모 | 단일 프로젝트 | multi-repo 지원 |

---

## 5. 마일스톤 요약

| 주차 | 산출물 | 성공 기준 |
|------|--------|-----------|
| Week 1 | MCP Resources 4종 + Prompts 2종 | Claude Code에서 동작 확인 |
| Week 2 | Skills 생성 + aimux v0.2.0 | .claude/skills/ 생성, retry 동작 |
| Week 3 | 통합 + v0.4.0 publish | 전체 MCP 기능 동작, npm publish |
