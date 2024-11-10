import { z } from 'zod';
export declare const signupSchema: z.ZodObject<{
    email: z.ZodString;
    password: z.ZodString;
    username: z.ZodString;
}, "strip", z.ZodTypeAny, {
    email: string;
    password: string;
    username: string;
}, {
    email: string;
    password: string;
    username: string;
}>;
export declare const signinSchema: z.ZodObject<{
    email: z.ZodString;
    password: z.ZodString;
}, "strip", z.ZodTypeAny, {
    email: string;
    password: string;
}, {
    email: string;
    password: string;
}>;
export declare const userIdSchema: z.ZodObject<{
    id: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    id: number;
}, {
    id: number;
}>;
export declare const createPostSchema: z.ZodObject<{
    title: z.ZodString;
    body: z.ZodString;
    tags: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    title: string;
    body: string;
    tags: string[];
}, {
    title: string;
    body: string;
    tags: string[];
}>;
export declare const updatePostSchema: z.ZodObject<{
    title: z.ZodString;
    body: z.ZodString;
    tags: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    title: string;
    body: string;
    tags: string[];
}, {
    title: string;
    body: string;
    tags: string[];
}>;
export declare const postIdSchema: z.ZodObject<{
    id: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    id: number;
}, {
    id: number;
}>;
export type SignupSchemaType = z.infer<typeof signupSchema>;
export type SigninSchemaType = z.infer<typeof signinSchema>;
export type UserIdSchemaType = z.infer<typeof userIdSchema>;
export type CreatePostSchemaType = z.infer<typeof createPostSchema>;
export type UpdatePostSchemaType = z.infer<typeof updatePostSchema>;
export type PostIdSchemaType = z.infer<typeof postIdSchema>;
