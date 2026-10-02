import { describe, expect, test } from 'bun:test';
import { maskCredentialName } from '@/features/quota/maskCredentialName';

describe('maskCredentialName', () => {
  test.each([
    ['claude-tom@lab.dev.json', 'claude-t•••@l•••.dev.json'],
    ['codex-ae5d455f-tom@lab.dev-pro.json', 'codex-ae5d455f-t•••@l•••.dev-pro.json'],
    ['claude-tom@mail.example.gg.json', 'claude-t•••@m•••.e•••.gg.json'],
    ['tom@lab.dev', 't•••@l•••.dev'],
    ['codex-x@localhost.json', 'codex-x•••@l•••.json'],
  ])('masks %s → %s', (input, expected) => {
    expect(maskCredentialName(input)).toBe(expected);
  });

  test('leaves names without an e-mail untouched', () => {
    expect(maskCredentialName('antigravity-project-1.json')).toBe('antigravity-project-1.json');
    expect(maskCredentialName('')).toBe('');
  });

  test('masks each segment of a Devin "file · identity" display name', () => {
    expect(maskCredentialName('devin.json · tom@lab.dev')).toBe('devin.json · t•••@l•••.dev');
  });

  test('is idempotent', () => {
    const once = maskCredentialName('claude-tom@lab.dev.json');
    expect(maskCredentialName(once)).toBe(once);
  });
});
