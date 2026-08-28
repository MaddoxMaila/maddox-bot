import { z } from "zod";

const fileChangeSchema = z.object({
  path: z.string().min(1),
  reason: z.string().min(1),
});

export const implementationPlanSchema = z.object({
  summary: z.string().min(1),
  approach: z.string().min(1),
  filesToModify: z.array(fileChangeSchema),
  filesToCreate: z.array(fileChangeSchema),
  risks: z.array(z.string()),
  requiredTests: z.array(z.string()),
  openQuestions: z.array(z.string()).optional(),
});

export type ImplementationPlan = z.infer<typeof implementationPlanSchema>;
