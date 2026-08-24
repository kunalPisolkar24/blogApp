import { gql } from "@apollo/client";
import type { TypedDocumentNode as DocumentNode } from "@graphql-typed-document-node/core";

export type SummaryStatus = "PENDING" | "COMPLETED" | "FAILED";

export interface ContentTag {
  __typename?: "Tag";
  id: string;
  name: string;
}

export interface ContentPostAuthorPreview {
  __typename?: "User";
  id: string;
  username: string;
  name?: string | null;
  avatarUrl?: string | null;
}

export interface ContentPostAuthorDetail extends ContentPostAuthorPreview {
  email: string;
  bio?: string | null;
}

export interface ContentPostCard {
  __typename?: "Post";
  id: string;
  title: string;
  body: string;
  imageUrl?: string | null;
  createdAt: string;
  likedByMe: boolean;
  savedByMe: boolean;
  author: ContentPostAuthorPreview;
  tags: ContentTag[];
}

export interface ContentPostDetail extends ContentPostCard {
  slug: string;
  summary?: string | null;
  summaryStatus?: SummaryStatus | null;
  updatedAt: string;
  author: ContentPostAuthorDetail;
  related: ContentPostCard[];
}

export interface PaginatedContentPosts {
  __typename?: "PaginatedPosts";
  posts: ContentPostCard[];
  totalPages: number;
  currentPage: number;
  totalPosts: number;
}

export interface ContentPostReason {
  __typename?: "PostReason";
  postId: string;
  reason: string;
}

export interface CreatePostInput {
  title: string;
  body: string;
  summary?: string | null;
  tags?: string[] | null;
  imageUrl?: string | null;
}

export interface UpdatePostInput {
  title?: string | null;
  body?: string | null;
  summary?: string | null;
  tags?: string[] | null;
  imageUrl?: string | null;
}

export interface GeneratedPost {
  __typename?: "GeneratedPost";
  title: string;
  body: string;
  summary: string;
  tags: string[];
}

export interface PostsQueryVariables {
  page?: number;
  limit?: number;
}

export interface PostsQuery {
  __typename?: "Query";
  posts: PaginatedContentPosts;
}

export interface PostsByTagQueryVariables {
  tag: string;
  page?: number;
  limit?: number;
}

export interface PostsByTagQuery {
  __typename?: "Query";
  postsByTag: PaginatedContentPosts;
}

export interface PostQueryVariables {
  id: string;
}

export interface PostQuery {
  __typename?: "Query";
  post?: ContentPostDetail | null;
}

export interface TagsQueryVariables {
  query?: string;
  limit?: number;
}

export interface TagsQuery {
  __typename?: "Query";
  tags: ContentTag[];
}

export interface CreatePostMutationVariables {
  input: CreatePostInput;
}

export interface CreatePostMutation {
  __typename?: "Mutation";
  createPost: {
    __typename?: "Post";
    id: string;
  };
}

export interface UpdatePostMutationVariables {
  id: string;
  input: UpdatePostInput;
}

export interface UpdatePostMutation {
  __typename?: "Mutation";
  updatePost: ContentPostDetail;
}

export interface DeletePostMutationVariables {
  id: string;
}

export interface DeletePostMutation {
  __typename?: "Mutation";
  deletePost: boolean;
}

export interface RecordPostViewMutationVariables {
  postId: string;
  mode?: RecommendMode | null;
}

export interface RecordPostViewMutation {
  __typename?: "Mutation";
  recordPostView: boolean;
}

export interface LikePostMutationVariables {
  postId: string;
  mode?: RecommendMode | null;
}

export interface LikePostMutation {
  __typename?: "Mutation";
  likePost: boolean;
}

export interface SavePostMutationVariables {
  postId: string;
  mode?: RecommendMode | null;
}

export interface SavePostMutation {
  __typename?: "Mutation";
  savePost: boolean;
}

export interface GenerateTagsMutationVariables {
  title: string;
  body: string;
}

export interface GenerateTagsMutation {
  __typename?: "Mutation";
  generateTags: string[];
}

export interface GeneratePostContentMutationVariables {
  prompt: string;
}

export interface GeneratePostContentMutation {
  __typename?: "Mutation";
  generatePostContent: GeneratedPost;
}

export interface MyPostsQueryVariables {
  page?: number;
  limit?: number;
}

export interface MyPostsQuery {
  __typename?: "Query";
  me?: {
    __typename?: "User";
    id: string;
    posts: PaginatedContentPosts;
  } | null;
}

export interface SearchPostsQueryVariables {
  query: string;
  page?: number;
  limit?: number;
}

export interface SearchPostsQuery {
  __typename?: "Query";
  searchPosts: {
    __typename?: "SearchResult";
    hits: ContentPostCard[];
    total: number;
  };
}

export type RecommendMode = "DEFAULT" | "SURPRISE" | "FRESH" | "EXPLORER";

export interface RecommendedPostsQueryVariables {
  page?: number;
  limit?: number;
  mode?: RecommendMode;
  seed?: number;
}

export interface RecommendedPostsQuery {
  __typename?: "Query";
  recommendedPosts: PaginatedContentPosts & { reasons: ContentPostReason[] };
}

const POST_CARD_FIELDS = gql`
  fragment PostCardFields on Post {
    id
    title
    body
    imageUrl
    createdAt
    likedByMe
    savedByMe
    author {
      id
      username
      name
      avatarUrl
    }
    tags {
      id
      name
    }
  }
`;

const POST_DETAIL_FIELDS = gql`
  fragment PostDetailFields on Post {
    id
    title
    body
    slug
    imageUrl
    summary
    summaryStatus
    createdAt
    updatedAt
    likedByMe
    savedByMe
    author {
      id
      username
      email
      name
      bio
      avatarUrl
    }
    tags {
      id
      name
    }
    related {
      ...PostCardFields
    }
  }
  ${POST_CARD_FIELDS}
`;

const PAGINATED_POST_FIELDS = gql`
  fragment PaginatedPostFields on PaginatedPosts {
    posts {
      ...PostCardFields
    }
    totalPages
    currentPage
    totalPosts
  }
  ${POST_CARD_FIELDS}
`;

export const PostsDocument = gql`
  query Posts($page: Int, $limit: Int) {
    posts(page: $page, limit: $limit) {
      ...PaginatedPostFields
    }
  }
  ${PAGINATED_POST_FIELDS}
` as DocumentNode<PostsQuery, PostsQueryVariables>;

export const PostsByTagDocument = gql`
  query PostsByTag($tag: String!, $page: Int, $limit: Int) {
    postsByTag(tag: $tag, page: $page, limit: $limit) {
      ...PaginatedPostFields
    }
  }
  ${PAGINATED_POST_FIELDS}
` as DocumentNode<PostsByTagQuery, PostsByTagQueryVariables>;

export const PostDocument = gql`
  query Post($id: ID!) {
    post(id: $id) {
      ...PostDetailFields
    }
  }
  ${POST_DETAIL_FIELDS}
` as DocumentNode<PostQuery, PostQueryVariables>;

export const TagsDocument = gql`
  query Tags($query: String, $limit: Int) {
    tags(query: $query, limit: $limit) {
      id
      name
    }
  }
` as DocumentNode<TagsQuery, TagsQueryVariables>;

export const CreatePostDocument = gql`
  mutation CreatePost($input: CreatePostInput!) {
    createPost(input: $input) {
      id
    }
  }
` as DocumentNode<CreatePostMutation, CreatePostMutationVariables>;

export const UpdatePostDocument = gql`
  mutation UpdatePost($id: ID!, $input: UpdatePostInput!) {
    updatePost(id: $id, input: $input) {
      ...PostDetailFields
    }
  }
  ${POST_DETAIL_FIELDS}
` as DocumentNode<UpdatePostMutation, UpdatePostMutationVariables>;

export const DeletePostDocument = gql`
  mutation DeletePost($id: ID!) {
    deletePost(id: $id)
  }
` as DocumentNode<DeletePostMutation, DeletePostMutationVariables>;

export const RecordPostViewDocument = gql`
  mutation RecordPostView($postId: ID!, $mode: RecommendMode) {
    recordPostView(postId: $postId, mode: $mode)
  }
` as DocumentNode<RecordPostViewMutation, RecordPostViewMutationVariables>;

export const LikePostDocument = gql`
  mutation LikePost($postId: ID!, $mode: RecommendMode) {
    likePost(postId: $postId, mode: $mode)
  }
` as DocumentNode<LikePostMutation, LikePostMutationVariables>;

export const SavePostDocument = gql`
  mutation SavePost($postId: ID!, $mode: RecommendMode) {
    savePost(postId: $postId, mode: $mode)
  }
` as DocumentNode<SavePostMutation, SavePostMutationVariables>;

export const GenerateTagsDocument = gql`
  mutation GenerateTags($title: String!, $body: String!) {
    generateTags(title: $title, body: $body)
  }
` as DocumentNode<GenerateTagsMutation, GenerateTagsMutationVariables>;

export const GeneratePostContentDocument = gql`
  mutation GeneratePostContent($prompt: String!) {
    generatePostContent(prompt: $prompt) {
      title
      body
      summary
      tags
    }
  }
` as DocumentNode<
  GeneratePostContentMutation,
  GeneratePostContentMutationVariables
>;

export const MyPostsDocument = gql`
  query MyPosts($page: Int, $limit: Int) {
    me {
      id
      posts(page: $page, limit: $limit) {
        ...PaginatedPostFields
      }
    }
  }
  ${PAGINATED_POST_FIELDS}
` as DocumentNode<MyPostsQuery, MyPostsQueryVariables>;

export const SearchPostsDocument = gql`
  query SearchPosts($query: String!, $page: Int, $limit: Int) {
    searchPosts(query: $query, page: $page, limit: $limit) {
      hits {
        ...PostCardFields
      }
      total
    }
  }
  ${POST_CARD_FIELDS}
` as DocumentNode<SearchPostsQuery, SearchPostsQueryVariables>;

export const RecommendedPostsDocument = gql`
  query RecommendedPosts(
    $page: Int
    $limit: Int
    $mode: RecommendMode
    $seed: Int
  ) {
    recommendedPosts(page: $page, limit: $limit, mode: $mode, seed: $seed) {
      ...PaginatedPostFields
      reasons {
        postId
        reason
      }
    }
  }
  ${PAGINATED_POST_FIELDS}
` as DocumentNode<RecommendedPostsQuery, RecommendedPostsQueryVariables>;

export type DraftStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface PostDraft {
  __typename?: "PostDraft";
  id: string;
  approvalId: string;
  prompt: string;
  title: string;
  body: string;
  summary: string;
  tags: string[];
  status: DraftStatus;
  authorId: string;
  postId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedPostDrafts {
  __typename?: "PaginatedPostDrafts";
  drafts: PostDraft[];
  totalPages: number;
  currentPage: number;
  totalDrafts: number;
}

export interface DraftEditsInput {
  title?: string | null;
  body?: string | null;
  summary?: string | null;
  tags?: string[] | null;
}

export interface PostDraftsQueryVariables {
  page?: number;
  limit?: number;
}

export interface PostDraftsQuery {
  __typename?: "Query";
  postDrafts: PaginatedPostDrafts;
}

export interface MyPostDraftsQueryVariables {
  page?: number;
  limit?: number;
}

export interface MyPostDraftsQuery {
  __typename?: "Query";
  myPostDrafts: PaginatedPostDrafts;
}

export interface CreatePostDraftMutationVariables {
  prompt: string;
}

export interface CreatePostDraftMutation {
  __typename?: "Mutation";
  createPostDraft: PostDraft;
}

export interface ApprovePostDraftMutationVariables {
  id: string;
  input?: DraftEditsInput | null;
}

export interface ApprovePostDraftMutation {
  __typename?: "Mutation";
  approvePostDraft: PostDraft;
}

export interface RejectPostDraftMutationVariables {
  id: string;
  reason?: string | null;
}

export interface RejectPostDraftMutation {
  __typename?: "Mutation";
  rejectPostDraft: PostDraft;
}

export interface DeletePostDraftMutationVariables {
  id: string;
}

export interface DeletePostDraftMutation {
  __typename?: "Mutation";
  deletePostDraft: boolean;
}

const POST_DRAFT_FIELDS = gql`
  fragment PostDraftFields on PostDraft {
    id
    approvalId
    prompt
    title
    body
    summary
    tags
    status
    authorId
    postId
    createdAt
    updatedAt
  }
`;

const PAGINATED_POST_DRAFT_FIELDS = gql`
  fragment PaginatedPostDraftFields on PaginatedPostDrafts {
    drafts {
      ...PostDraftFields
    }
    totalPages
    currentPage
    totalDrafts
  }
  ${POST_DRAFT_FIELDS}
`;

export const PostDraftsDocument = gql`
  query PostDrafts($page: Int, $limit: Int) {
    postDrafts(page: $page, limit: $limit) {
      ...PaginatedPostDraftFields
    }
  }
  ${PAGINATED_POST_DRAFT_FIELDS}
` as DocumentNode<PostDraftsQuery, PostDraftsQueryVariables>;

export const MyPostDraftsDocument = gql`
  query MyPostDrafts($page: Int, $limit: Int) {
    myPostDrafts(page: $page, limit: $limit) {
      ...PaginatedPostDraftFields
    }
  }
  ${PAGINATED_POST_DRAFT_FIELDS}
` as DocumentNode<MyPostDraftsQuery, MyPostDraftsQueryVariables>;

export const CreatePostDraftDocument = gql`
  mutation CreatePostDraft($prompt: String!) {
    createPostDraft(prompt: $prompt) {
      ...PostDraftFields
    }
  }
  ${POST_DRAFT_FIELDS}
` as DocumentNode<CreatePostDraftMutation, CreatePostDraftMutationVariables>;

export const ApprovePostDraftDocument = gql`
  mutation ApprovePostDraft($id: ID!, $input: DraftEditsInput) {
    approvePostDraft(id: $id, input: $input) {
      ...PostDraftFields
    }
  }
  ${POST_DRAFT_FIELDS}
` as DocumentNode<
  ApprovePostDraftMutation,
  ApprovePostDraftMutationVariables
>;

export const RejectPostDraftDocument = gql`
  mutation RejectPostDraft($id: ID!, $reason: String) {
    rejectPostDraft(id: $id, reason: $reason) {
      ...PostDraftFields
    }
  }
  ${POST_DRAFT_FIELDS}
` as DocumentNode<
  RejectPostDraftMutation,
  RejectPostDraftMutationVariables
>;

export const DeletePostDraftDocument = gql`
  mutation DeletePostDraft($id: ID!) {
    deletePostDraft(id: $id)
  }
` as DocumentNode<DeletePostDraftMutation, DeletePostDraftMutationVariables>;
