import { z } from "zod";

export const approveDraftSchema = z.object({
  title: z
    .string()
    .min(1, "Title is required")
    .max(200, "Keep the title under 200 characters"),
  body: z.string().min(1, "Body is required"),
  summary: z.string().max(2000, "Keep the summary under 2000 characters"),
  tags: z.string(), // comma-separated; parsed on submit
});

export type ApproveDraftFormValues = z.infer<typeof approveDraftSchema>;

export const parseTagsInput = (value: string): string[] =>
  value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
