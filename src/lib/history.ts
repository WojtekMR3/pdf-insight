import { z } from 'zod';
import { resultSchema, analysisMetaSchema, type AnalysisRecord } from '../../shared/schema';

const KEY = 'pdf-insight.history.v1';
const schema = z.array(
  z.object({
    id: z.string(),
    result: resultSchema,
    meta: analysisMetaSchema,
    createdAt: z.string(),
  }),
);
export function readHistory(): AnalysisRecord[] {
  try {
    return schema.parse(JSON.parse(localStorage.getItem(KEY) || '[]')).slice(0, 5);
  } catch {
    return [];
  }
}
export function saveHistory(records: AnalysisRecord[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(records.slice(0, 5)));
    return true;
  } catch {
    return false;
  }
}
export function clearHistory(): boolean {
  try {
    localStorage.removeItem(KEY);
    return true;
  } catch {
    return false;
  }
}

export function exportJson(record: AnalysisRecord) {
  return JSON.stringify({ ...record.result, analysis: record.meta }, null, 2);
}

export function downloadResult(record: AnalysisRecord) {
  const blob = new Blob([exportJson(record)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = record.result.document.fileName.replace(/\.pdf$/i, '') + '.json';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
