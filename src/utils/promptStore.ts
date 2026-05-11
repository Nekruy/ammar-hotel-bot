// src/utils/promptStore.ts — runtime-overridable system prompt
import { SYSTEM_PROMPT } from '../config/systemPrompt';

let _override: string | null = null;

export function getSystemPrompt(): string { return _override ?? SYSTEM_PROMPT; }
export function setSystemPrompt(p: string): void { _override = p; }
export function resetSystemPrompt(): void { _override = null; }
