# Branching Workflow

## 규칙

- `master` — 안정 브랜치. 직접 커밋 금지 (Week 5부터 적용).
- `mvp1/week-N-이름` — 주간 feature 브랜치. PR → master merge.
- 커밋은 feature 브랜치에서만. PR merge 후 브랜치 삭제.

## 워크플로

```bash
# 1. 주간 시작
git checkout -b mvp1/week5-relation-engine master

# 2. 작업 + 커밋
git add ... && git commit -m "feat: ..."

# 3. PR 생성
git push -u origin mvp1/week5-relation-engine
gh pr create --base master --title "feat: Week 5 — Relation Engine"

# 4. QA 통과 후 merge
gh pr merge --squash --delete-branch
```

## 네이밍

| 유형 | 패턴 | 예시 |
|------|------|------|
| 주간 작업 | `mvp1/week-N-이름` | `mvp1/week5-relation-engine` |
| 핫픽스 | `fix/설명` | `fix/gemini-quota-exhaustion` |
| 실험 | `exp/설명` | `exp/bm25-vs-vector` |
