import { z, type ZodType } from 'zod';
// shared/schemas/index.mjs 是 ESM 文件，Vite 直接 import 即可
import buildSchemas from '@shared/schemas/index.mjs';

const schemas: Record<string, ZodType<unknown>> = buildSchemas(z);

export const sharedSchemas = schemas;

// 用 schema 检查表单数据，失败时返回 [{path, message}]，成功返回 null
export function validate(schemaName: string, data: unknown):
  | { path: string; message: string }[]
  | null {
  const schema = schemas[schemaName];
  if (!schema) {
    console.warn(`[validate] schema "${schemaName}" 不存在`);
    return null;
  }
  const result = schema.safeParse(data);
  if (result.success) return null;
  return result.error.issues.map((i) => ({
    path: i.path.join('.') || '<root>',
    message: i.message,
  }));
}
