import { afterEach, expect, it, vi } from 'vitest';
import { clearHistory, readHistory, saveHistory } from '../src/lib/history';

afterEach(() => vi.unstubAllGlobals());

it('handles unavailable browser storage during read, save and clear', () => {
  const denied = () => {
    throw new DOMException('Access denied', 'SecurityError');
  };
  vi.stubGlobal('localStorage', { getItem: denied, setItem: denied, removeItem: denied });
  expect(readHistory()).toEqual([]);
  expect(saveHistory([])).toBe(false);
  expect(clearHistory()).toBe(false);
});

it('reports successful history deletion', () => {
  const removeItem = vi.fn();
  vi.stubGlobal('localStorage', { removeItem });
  expect(clearHistory()).toBe(true);
  expect(removeItem).toHaveBeenCalledExactlyOnceWith('pdf-insight.history.v1');
});
