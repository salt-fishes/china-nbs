import { CATALOG_CODE_LABELS } from './catalog-codes.js';
import { invalidArgument } from './errors.js';
import type { NbsProvider } from './provider.js';
import type { CatalogNode, QueryOptions, TreeRecord } from './types.js';

const VALID_CODES = new Set(Object.keys(CATALOG_CODE_LABELS));
const MAX_NODES = 500;

export interface CatalogResult {
  nodes: CatalogNode[];
  notes: string[];
}

function toNode(record: TreeRecord): CatalogNode {
  return {
    id: record.id,
    name: record.name,
    level: record.level,
    isLeaf: record.isLeaf,
    parentId: record.parentId,
    startYear: record.startYear,
    endYear: record.endYear,
  };
}

/** Expand a catalog tree to the requested depth. */
export async function fetchCatalog(
  provider: NbsProvider,
  options: QueryOptions,
  code = '3',
  pid = '',
  depth = 1,
): Promise<CatalogResult> {
  if (!VALID_CODES.has(code)) {
    const available = Object.entries(CATALOG_CODE_LABELS)
      .map(([value, label]) => `${value} ${label}`)
      .join('、');
    throw invalidArgument(`不支持的分类 code：${code}`, `可用值：${available}。`);
  }
  const safeDepth = Math.max(1, Math.min(3, Math.floor(depth)));
  const nodes: CatalogNode[] = [];
  const notes: string[] = [];
  const queue: Array<{ pid: string; level: number }> = [{ pid, level: 1 }];

  while (queue.length > 0 && nodes.length < MAX_NODES) {
    const current = queue.shift();
    if (!current) break;
    const children = await provider.getTree({
      pid: current.pid,
      code,
      signal: options.signal,
      noCache: options.noCache,
    });
    for (const child of children) {
      nodes.push(toNode(child));
      if (!child.isLeaf && current.level < safeDepth) {
        queue.push({ pid: child.id, level: current.level + 1 });
      }
      if (nodes.length >= MAX_NODES) break;
    }
  }

  if (nodes.length >= MAX_NODES) {
    notes.push(`分类树节点较多，仅返回前 ${MAX_NODES} 个；请用 pid 继续展开。`);
  }

  return { nodes, notes };
}
