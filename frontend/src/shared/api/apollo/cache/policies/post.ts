import type { FieldPolicy, TypePolicy } from "@apollo/client";

interface PaginatedPosts {
  __typename?: "PaginatedPosts";
  posts: Array<{ __ref?: string; id?: string | number } & Record<string, unknown>>;
  totalPages: number;
  currentPage: number;
  totalPosts: number;
}

export const paginatedPostListKeyArgs = (args: Record<string, unknown> | null) => {
  if (!args) return "";
  const page = args.page ?? 1;
  const limit = args.limit ?? "";
  const tag = args.tag ?? "";
  const mode = args.mode ?? "";
  const seed = args.seed ?? "";
  return `tag:${String(tag)}|mode:${String(mode)}|seed:${String(seed)}|page:${String(page)}|limit:${String(limit)}`;
};

export const mergePaginatedPostLists = (
  existing: unknown,
  incoming: unknown,
  { args }: { args: Record<string, unknown> | null },
) => {
  if (!incoming) return existing;
  if (!existing) return incoming;

  const existingList = (existing as PaginatedPosts).posts;
  const incomingList = (incoming as PaginatedPosts).posts;
  if (!Array.isArray(existingList) || !Array.isArray(incomingList)) {
    return incoming;
  }

  const incomingPage = Number(args?.page ?? 1);
  if (incomingPage <= 1) {
    return incoming;
  }

  const seen = new Set<string>(
    existingList.map((p) =>
      typeof p.id !== "undefined" ? String(p.id) : (p.__ref ?? JSON.stringify(p)),
    ),
  );
  const dedupedIncoming = incomingList.filter((p) => {
    const key =
      typeof p.id !== "undefined" ? String(p.id) : (p.__ref ?? JSON.stringify(p));
    return !seen.has(key);
  });

  return {
    ...(incoming as PaginatedPosts),
    posts: [...existingList, ...dedupedIncoming],
  };
};

const paginatedPostListPolicy = (): FieldPolicy => ({
  keyArgs: paginatedPostListKeyArgs,
  merge: mergePaginatedPostLists,
});

const postFieldPolicy = (): FieldPolicy => ({
  keyArgs: ["id"],
  merge: false,
});

export const postTypePolicy: TypePolicy = {
  keyFields: ["id"],
};

export const postQueryFieldPolicies: Record<string, FieldPolicy> = {
  post: postFieldPolicy(),
  posts: paginatedPostListPolicy(),
  postsByTag: paginatedPostListPolicy(),
  recommendedPosts: paginatedPostListPolicy(),
  searchPosts: {
    keyArgs: ["query", ["page"], ["limit"]],
    merge: false,
  },
};
