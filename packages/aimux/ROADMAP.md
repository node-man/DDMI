# aimux Roadmap

> AI CLI Multiplexer — route prompts to Claude, Codex, Gemini, Ollama with fallback chain.

## v0.1.0 (현재) — Core

- [x] AIProvider / EmbeddingProvider 인터페이스
- [x] CLI Subprocess providers (claude, codex, gemini, llm)
- [x] Ollama HTTP provider
- [x] Transformers.js EmbeddingProvider
- [x] Router (auto-detect + fallback chain)
- [x] Rate Limiter (per-minute, per-session)
- [x] JSONL Logger (prompt/response 전문)
- [x] extractJSON (ANSI 필터링)

## v0.2.0 — Credential Scheduler + Retry

> CLIProxyAPI (17K stars) 분석에서 가져온 패턴. 상위 계층 로직을 TypeScript로 구현.

### Credential Scheduler (CLIProxyAPI: `scheduler.go`)

3계층 스케줄링: provider → model → credential

```typescript
interface CredentialState {
  id: string;
  provider: string;
  status: 'ready' | 'cooldown' | 'blocked' | 'disabled';
  cooldownUntil?: Date;
  consecutiveFailures: number;
  priority: number;  // 유료 > 무료
}

class CredentialScheduler {
  pick(provider, model, tried): Credential | null;
  reportResult(credId, model, result): void;  // 429 → cooldown
}
```

- 모델별 shard: 같은 credential이 모델 A에서는 cooldown, 모델 B에서는 사용 가능
- Priority 레벨: 유료 > 무료 credential 우선
- Cooldown 자동 해제: `promoteExpired()`로 시간 기반 복구

### Retry + Cooldown (CLIProxyAPI: `selector.go`)

```typescript
interface RetryConfig {
  maxRetries: number;           // 기본 3
  maxRetryCredentials: number;  // 0 = 모든 credential 시도
  maxRetryIntervalSec: number;  // cooldown 대기 최대 초
  retryableStatuses: number[];  // [403, 408, 429, 500, 502, 503, 504]
}
```

- Provider별 retry-after 파싱 (Gemini: RetryInfo, Codex: resets_at, Claude: HTTP status)
- 429 → 해당 credential cooldown + 다음 credential로 전환
- Bootstrap retry: 첫 바이트 전에만 retry 허용

### Model Registry (CLIProxyAPI: `model_registry.go`)

```typescript
interface ModelRegistry {
  register(credentialId, models[]): void;
  getAvailableModels(): string[];
  isAvailable(model): boolean;
  getCredentialsForModel(model): Credential[];
  reportQuotaExceeded(credId, model): void;
  reportSuspension(credId, reason): void;
}
```

- Reference counting: credential이 등록한 모델 수 추적
- Quota exceeded tracking: credential별/모델별
- 가용성 계산: `effectiveClients = total - expired - suspended`

## v0.3.0 — Model Mapping + Streaming

### Model Mapping (CLIProxyAPI: config 기반)

```typescript
interface ModelMapping {
  upstream: string;   // 실제 모델명
  alias: string;      // 클라이언트가 보는 이름
  provider: string;   // 어느 provider로 라우팅
}

class ModelRouter {
  resolve(requestedModel): { provider, model };
  // alias 매칭 → pool round-robin → excluded 체크
}
```

- Alias: `gpt-5` → `codex/gpt-5`
- Pool: 같은 alias에 여러 upstream 매핑 → 내부 round-robin
- Excluded: 와일드카드 필터 (`*-preview`, `*flash*`)
- Prefix routing: `test/model-name` → 특정 credential 그룹만

### SSE Streaming (CLIProxyAPI: `stream_forwarder.go`)

```typescript
async function* forwardStream(
  upstream: AsyncIterable<Buffer>,
  keepAliveMs?: number,
): AsyncGenerator<string>;
```

- Keep-alive heartbeat (SSE 코멘트)
- Bootstrap retry: 첫 바이트 전에만 retry 허용
- Transform stream으로 provider별 포맷 변환

## v1.0.0 — OpenAI 호환 API 서버 모드

> CLIProxyAPI의 핵심 가치를 aimux에서도 제공.

- `aimux serve` — OpenAI 호환 `/v1/chat/completions` 엔드포인트
- 멀티 계정 로드밸런싱
- Streaming + non-streaming
- Function calling / tools 지원
- npm 패키지로 독립 배포

## 가져오지 않는 것

- OAuth 토큰 추출 (aimux는 CLI spawn 방식)
- User-Agent 위장 (aimux는 정상 CLI 사용)
- Cloaking 시스템 (Claude Code 위장 — 윤리적 문제)

## 참조

- [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) — 17K stars, Go, MIT
- [claude-code-mux](https://github.com/9j/claude-code-mux) — 480 stars, Rust, Archived
- [LiteLLM](https://docs.litellm.ai) — 18K stars, Python
