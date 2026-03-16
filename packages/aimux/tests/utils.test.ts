/**
 * AI utils tests — extractJSON 검증
 */

import { describe, it, expect } from "vitest";
import { extractJSON } from "../src/utils.js";

describe("extractJSON", () => {
  it("순수 JSON을 파싱한다", () => {
    const result = extractJSON<{ name: string }>('{"name": "test"}');
    expect(result).toEqual({ name: "test" });
  });

  it("JSON 배열을 파싱한다", () => {
    const result = extractJSON<number[]>("[1, 2, 3]");
    expect(result).toEqual([1, 2, 3]);
  });

  it("ANSI 코드가 섞인 출력에서 JSON을 추출한다", () => {
    const raw = '\x1b[32m✓ Loading...\x1b[0m\n{"result": true}\n\x1b[34mDone.\x1b[0m';
    const result = extractJSON<{ result: boolean }>(raw);
    expect(result).toEqual({ result: true });
  });

  it("앞뒤 텍스트가 있는 출력에서 JSON을 추출한다", () => {
    const raw = 'Some warning text\n\n{"data": [1,2,3]}\n\nMore text';
    const result = extractJSON<{ data: number[] }>(raw);
    expect(result).toEqual({ data: [1, 2, 3] });
  });

  it("중첩된 JSON을 올바르게 추출한다", () => {
    const raw = 'prefix {"a": {"b": [1, {"c": true}]}} suffix';
    const result = extractJSON<{ a: { b: unknown[] } }>(raw);
    expect(result.a.b).toHaveLength(2);
  });

  it("JSON이 없으면 에러를 던진다", () => {
    expect(() => extractJSON("no json here")).toThrow("No valid JSON found");
  });

  it("깨진 JSON은 건너뛰고 유효한 것을 찾는다", () => {
    const raw = 'Warning: {broken\n[1, 2, 3]';
    const result = extractJSON<number[]>(raw);
    expect(result).toEqual([1, 2, 3]);
  });

  it("문자열 안의 중괄호를 무시한다", () => {
    const raw = '{"msg": "hello { world }"}';
    const result = extractJSON<{ msg: string }>(raw);
    expect(result.msg).toBe("hello { world }");
  });
});
