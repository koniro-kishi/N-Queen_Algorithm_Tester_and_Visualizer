import { describe, expect, it } from 'vitest';
import { validateBoard } from '../Tester/Board/validator';

const good = ['xQxx', 'xxxQ', 'Qxxx', 'xxQx'];

describe('validateBoard', () => {
  it('accepts a valid 4-queens solution', () => expect(validateBoard(good, 4)).toEqual({ ok: true }));
  it('rejects wrong size', () => expect(validateBoard(['Q'], 4)).toMatchObject({ ok: false, rule: 'size' }));
  it('rejects wrong queen count', () => expect(validateBoard(['xQxx', 'xxxQ', 'Qxxx', 'xxxx'], 4)).toMatchObject({ rule: 'queen-count' }));
  it('rejects shared row', () => expect(validateBoard(['QQxx', 'xxxx', 'xxQx', 'xxxQ'], 4)).toMatchObject({ rule: 'row' }));
  it('rejects shared column', () => expect(validateBoard(['Qxxx', 'Qxxx', 'xxQx', 'xxxQ'], 4)).toMatchObject({ rule: 'column' }));
  it('rejects shared diagonal', () => expect(validateBoard(['Qxxx', 'xQxx', 'xxxQ', 'xxQx'], 4)).toMatchObject({ rule: 'diagonal' }));
  it('rejects moved preplaced queen', () => expect(validateBoard(good, 4, [[0, 0]])).toMatchObject({ rule: 'preplaced' }));
  it('accepts when preplaced queens are kept', () => expect(validateBoard(good, 4, [[0, 1], [2, 0]])).toEqual({ ok: true }));
});
