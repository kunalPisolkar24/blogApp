import { PrismaClient } from '@prisma/client';
import { DATABASE_URL } from '../config';

const prisma = new PrismaClient({
  datasources: { db: { url: DATABASE_URL } }
});

export async function updatePostSuccess(postId: number, summary: string): Promise<void> {
    try {
        await prisma.post.update({
            where: { id: postId },
            data: { summary, summaryStatus: 'COMPLETED' },
        });
        console.log(`DB updated: PostId ${postId} marked as COMPLETED.`);
    } catch (dbError: any) {
        console.error(`Failed to update DB for completed postId ${postId}: ${dbError.message}`);
    }
}

export async function updatePostStatusToPending(postId: number): Promise<void> {
    try {
        await prisma.post.update({
            where: { id: postId },
            data: { summaryStatus: 'PENDING' },
        });
        console.log(`DB updated: PostId ${postId} status remains PENDING after failed attempt.`);
    } catch (dbError: any) {
        console.error(`Failed to update DB status to PENDING for postId ${postId}: ${dbError.message}`);
    }
}