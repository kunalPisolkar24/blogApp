"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.postIdSchema = exports.updatePostSchema = exports.createPostSchema = exports.userIdSchema = exports.signinSchema = exports.signupSchema = void 0;
const zod_1 = require("zod");
// User Validations
exports.signupSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    password: zod_1.z.string().min(6),
    username: zod_1.z.string().min(3),
});
exports.signinSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    password: zod_1.z.string().min(6),
});
exports.userIdSchema = zod_1.z.object({
    id: zod_1.z.number(),
});
// Post Validations
exports.createPostSchema = zod_1.z.object({
    title: zod_1.z.string().min(1),
    body: zod_1.z.string().min(1),
    tags: zod_1.z.array(zod_1.z.string().min(1)),
});
exports.updatePostSchema = zod_1.z.object({
    title: zod_1.z.string().min(1),
    body: zod_1.z.string().min(1),
    tags: zod_1.z.array(zod_1.z.string().min(1)),
});
exports.postIdSchema = zod_1.z.object({
    id: zod_1.z.number()
});
