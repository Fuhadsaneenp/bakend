import { z } from 'zod';
/** Optional tenant configuration; no example ratios or default KPI weights are applied. */
export const workloadRulesSchema = z.object({
  approved: z.literal(true),
  unit: z.string().trim().min(1).max(80),
  taskWeights: z.record(z.string(), z.number().finite().positive().max(100000)),
  dataEntryWeights: z.object({ Jobs: z.number().finite().positive().optional(), Employer: z.number().finite().positive().optional(), SMM: z.number().finite().positive().optional() }).optional()
}).strict();
export type WorkloadRules = z.infer<typeof workloadRulesSchema>;
export function taskWeight(rules: WorkloadRules, category: string, complexity: string): number | undefined {
  // Exact category and complexity are required. No generic "all tasks are equal" fallback.
  return rules.taskWeights[`${category.toUpperCase()}:${complexity.toUpperCase()}`];
}
