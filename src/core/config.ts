/**
 * Config loader — .ddmi/config.toml → DdmiConfig
 *
 * config.toml이 없으면 DEFAULT_CONFIG 반환.
 * 부분적으로 정의된 값만 오버라이드.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseTOML } from "@iarna/toml";
import { DEFAULT_CONFIG, type DdmiConfig, type ScoringWeights } from "../types.js";

export function loadConfig(projectRoot: string): DdmiConfig {
  const configPath = join(projectRoot, ".ddmi", "config.toml");

  if (!existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }

  const raw = readFileSync(configPath, "utf-8");
  const parsed = parseTOML(raw) as Record<string, unknown>;

  return mergeConfig(DEFAULT_CONFIG, parsed);
}

function mergeConfig(
  defaults: DdmiConfig,
  parsed: Record<string, unknown>,
): DdmiConfig {
  const config = structuredClone(defaults);

  // [server]
  const server = parsed.server as Record<string, unknown> | undefined;
  if (server) {
    if (server.transport === "stdio" || server.transport === "sse")
      config.server.transport = server.transport;
    if (typeof server.name === "string") config.server.name = server.name;
    if (typeof server.version === "string")
      config.server.version = server.version;
  }

  // [embedding]
  const embedding = parsed.embedding as Record<string, unknown> | undefined;
  if (embedding) {
    if (typeof embedding.model === "string")
      config.embedding.model = embedding.model;
  }

  // [curator]
  const curator = parsed.curator as Record<string, unknown> | undefined;
  if (curator) {
    if (typeof curator.default_max_tokens === "number")
      config.curator.defaultMaxTokens = curator.default_max_tokens;

    const weights = curator.weights as Record<string, unknown> | undefined;
    if (weights) {
      config.curator.weights = mergeWeights(defaults.curator.weights, weights);
    }
  }

  // [watcher]
  const watcher = parsed.watcher as Record<string, unknown> | undefined;
  if (watcher) {
    if (typeof watcher.enabled === "boolean")
      config.watcher.enabled = watcher.enabled;
    if (typeof watcher.debounce_ms === "number")
      config.watcher.debounceMs = watcher.debounce_ms;
    if (Array.isArray(watcher.ignore_patterns))
      config.watcher.ignorePatterns = watcher.ignore_patterns as string[];
  }

  return config;
}

function mergeWeights(
  defaults: ScoringWeights,
  parsed: Record<string, unknown>,
): ScoringWeights {
  return {
    semanticSim:
      typeof parsed.semantic_sim === "number"
        ? parsed.semantic_sim
        : defaults.semanticSim,
    keywordBoost:
      typeof parsed.keyword_boost === "number"
        ? parsed.keyword_boost
        : defaults.keywordBoost,
    taskAwareAuthority:
      typeof parsed.task_aware_authority === "number"
        ? parsed.task_aware_authority
        : defaults.taskAwareAuthority,
    recency:
      typeof parsed.recency === "number" ? parsed.recency : defaults.recency,
    redundancyPenalty:
      typeof parsed.redundancy_penalty === "number"
        ? parsed.redundancy_penalty
        : defaults.redundancyPenalty,
  };
}
