import type React from "react";
import { BlogCard } from "./BlogCard";
import { mapPostToBlogCardItem } from "@/entities/post/lib";
import type { PostCardFieldsFragment } from "@/shared/graphql/generated/graphql";

const RELATED_HEADING = "MORE LIKE THIS";

interface BlogRelatedSectionProps {
  posts: PostCardFieldsFragment[];
}

export const BlogRelatedSection: React.FC<BlogRelatedSectionProps> = ({
  posts,
}) => {
  if (posts.length === 0) {
    return null;
  }

  return (
    <section className="mt-10">
      <p className="mb-4 font-mono text-[0.6875rem] font-medium uppercase tracking-[0.22em] text-primary">
        {RELATED_HEADING}
      </p>
      <div className="space-y-4">
        {posts.map((post) => (
          <BlogCard key={post.id} {...mapPostToBlogCardItem(post)} />
        ))}
      </div>
    </section>
  );
};
