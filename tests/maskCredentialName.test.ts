import { describe, expect, test } from 'bun:test';
import { maskCredentialName, stripCredentialHash } from '@/features/quota/maskCredentialName';

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

describe('stripCredentialHash', () => {
  test.each([
    ['claude-a22ab475-madadj4@gmail.com.json', 'claude-madadj4@gmail.com.json'],
    [
      'codex-00bb24d5-madadj4+codex@gmail.com-prolite.json',
      'codex-madadj4+codex@gmail.com-prolite.json',
    ],
    ['claude-tom@lab.dev.json', 'claude-tom@lab.dev.json'],
    ['gemini-deadbeef-project.json', 'gemini-deadbeef-project.json'],
  ])('%s → %s', (input, expected) => {
    expect(stripCredentialHash(input)).toBe(expected);
  });
});
