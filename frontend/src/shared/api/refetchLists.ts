import type { ApolloCache, ApolloClient } from "@apollo/client";

export type PostListQueryName =
  | "Posts"
  | "PostsByTag"
  | "MyPosts"
  | "SearchPosts"
  | "RecommendedPosts";

export const POST_LIST_QUERY_NAMES: PostListQueryName[] = [
  "Posts",
  "PostsByTag",
  "MyPosts",
  "SearchPosts",
  "RecommendedPosts",
];

export interface PostListCacheRefreshOptions {
  postId?: string;
}

const ROOT_QUERY_ID = "ROOT_QUERY";
const ROOT_POST_LIST_FIELDS = [
  "posts",
  "postsByTag",
  "searchPosts",
  "recommendedPosts",
] as const;

const getCacheEntityIds = (cache: ApolloCache, typename: string) => {
  const snapshot = cache.extract(false);
  if (!snapshot || typeof snapshot !== "object") return [];

  return Object.keys(snapshot).filter((id) => id.startsWith(`${typename}:`));
};

export const invalidatePostListCaches = (
  cache: ApolloCache,
  options: PostListCacheRefreshOptions = {},
) => {
  ROOT_POST_LIST_FIELDS.forEach((fieldName) => {
    cache.evict({ id: ROOT_QUERY_ID, fieldName });
  });

  getCacheEntityIds(cache, "User").forEach((id) => {
    cache.evict({ id, fieldName: "posts" });
  });

  if (options.postId) {
    cache.evict({
      id: ROOT_QUERY_ID,
      fieldName: "post",
      args: { id: options.postId },
    });

    const postCacheId = cache.identify({
      __typename: "Post",
      id: options.postId,
    });

    if (postCacheId) {
      cache.evict({ id: postCacheId });
    }
  }

  cache.gc();
};

export const refreshPostListQueries = async (
  client: ApolloClient,
  options: PostListCacheRefreshOptions = {},
) => {
  invalidatePostListCaches(client.cache, options);

  try {
    await client.refetchQueries({ include: POST_LIST_QUERY_NAMES });
  } catch (error) {
    console.warn("Unable to refetch post list queries.", error);
  }
};
