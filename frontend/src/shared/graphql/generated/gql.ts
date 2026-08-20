/* eslint-disable */
import * as types from './graphql';
import { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';

/**
 * Map of all GraphQL operations in the project.
 *
 * This map has several performance disadvantages:
 * 1. It is not tree-shakeable, so it will include all operations in the project.
 * 2. It is not minifiable, so the string of a GraphQL query will be multiple times inside the bundle.
 * 3. It does not support dead code elimination, so it will add unused operations.
 *
 * Therefore it is highly recommended to use the babel or swc plugin for production.
 * Learn more about it here: https://the-guild.dev/graphql/codegen/plugins/presets/preset-client#reducing-bundle-size
 */
type Documents = {
    "\n  query ForceNetwork {\n    __typename\n    posts {\n      posts {\n        id\n      }\n    }\n  }\n": typeof types.ForceNetworkDocument,
    "\n  fragment PostCardFields on Post {\n    id\n    title\n    body\n    imageUrl\n    createdAt\n    likedByMe\n    savedByMe\n    author {\n      id\n      username\n      name\n      avatarUrl\n    }\n    tags {\n      id\n      name\n    }\n  }\n": typeof types.PostCardFieldsFragmentDoc,
    "\n  fragment PostDetailFields on Post {\n    id\n    title\n    body\n    slug\n    imageUrl\n    summary\n    summaryStatus\n    createdAt\n    updatedAt\n    likedByMe\n    savedByMe\n    author {\n      id\n      username\n      email\n      name\n      bio\n      avatarUrl\n    }\n    tags {\n      id\n      name\n    }\n    related {\n      ...PostCardFields\n    }\n  }\n  \n": typeof types.PostDetailFieldsFragmentDoc,
    "\n  fragment PaginatedPostFields on PaginatedPosts {\n    posts {\n      ...PostCardFields\n    }\n    totalPages\n    currentPage\n    totalPosts\n  }\n  \n": typeof types.PaginatedPostFieldsFragmentDoc,
    "\n  query Posts($page: Int, $limit: Int) {\n    posts(page: $page, limit: $limit) {\n      ...PaginatedPostFields\n    }\n  }\n  \n": typeof types.PostsDocument,
    "\n  query PostsByTag($tag: String!, $page: Int, $limit: Int) {\n    postsByTag(tag: $tag, page: $page, limit: $limit) {\n      ...PaginatedPostFields\n    }\n  }\n  \n": typeof types.PostsByTagDocument,
    "\n  query Post($id: ID!) {\n    post(id: $id) {\n      ...PostDetailFields\n    }\n  }\n  \n": typeof types.PostDocument,
    "\n  query Tags($query: String, $limit: Int) {\n    tags(query: $query, limit: $limit) {\n      id\n      name\n    }\n  }\n": typeof types.TagsDocument,
    "\n  mutation CreatePost($input: CreatePostInput!) {\n    createPost(input: $input) {\n      id\n    }\n  }\n": typeof types.CreatePostDocument,
    "\n  mutation UpdatePost($id: ID!, $input: UpdatePostInput!) {\n    updatePost(id: $id, input: $input) {\n      ...PostDetailFields\n    }\n  }\n  \n": typeof types.UpdatePostDocument,
    "\n  mutation DeletePost($id: ID!) {\n    deletePost(id: $id)\n  }\n": typeof types.DeletePostDocument,
    "\n  mutation RecordPostView($postId: ID!) {\n    recordPostView(postId: $postId)\n  }\n": typeof types.RecordPostViewDocument,
    "\n  mutation LikePost($postId: ID!) {\n    likePost(postId: $postId)\n  }\n": typeof types.LikePostDocument,
    "\n  mutation SavePost($postId: ID!) {\n    savePost(postId: $postId)\n  }\n": typeof types.SavePostDocument,
    "\n  mutation GenerateTags($title: String!, $body: String!) {\n    generateTags(title: $title, body: $body)\n  }\n": typeof types.GenerateTagsDocument,
    "\n  mutation GeneratePostContent($prompt: String!) {\n    generatePostContent(prompt: $prompt) {\n      title\n      body\n      summary\n      tags\n    }\n  }\n": typeof types.GeneratePostContentDocument,
    "\n  query MyPosts($page: Int, $limit: Int) {\n    me {\n      id\n      posts(page: $page, limit: $limit) {\n        ...PaginatedPostFields\n      }\n    }\n  }\n  \n": typeof types.MyPostsDocument,
    "\n  query SearchPosts($query: String!, $page: Int, $limit: Int) {\n    searchPosts(query: $query, page: $page, limit: $limit) {\n      hits {\n        ...PostCardFields\n      }\n      total\n    }\n  }\n  \n": typeof types.SearchPostsDocument,
    "\n  query RecommendedPosts(\n    $page: Int\n    $limit: Int\n    $mode: RecommendMode\n    $seed: Int\n  ) {\n    recommendedPosts(page: $page, limit: $limit, mode: $mode, seed: $seed) {\n      ...PaginatedPostFields\n    }\n  }\n  \n": typeof types.RecommendedPostsDocument,
    "fragment UserCore on User {\n  id\n  username\n  email\n  name\n  bio\n  avatarUrl\n  bannerUrl\n  createdAt\n}": typeof types.UserCoreFragmentDoc,
    "query Me {\n  me {\n    ...UserCore\n  }\n}": typeof types.MeDocument,
    "mutation Signin($email: String!, $password: String!) {\n  signin(email: $email, password: $password) {\n    token\n    user {\n      ...UserCore\n    }\n  }\n}": typeof types.SigninDocument,
    "mutation Signup($email: String!, $username: String!, $password: String!) {\n  signup(email: $email, username: $username, password: $password) {\n    token\n    user {\n      ...UserCore\n    }\n  }\n}": typeof types.SignupDocument,
    "mutation UpdateProfile($name: String, $bio: String, $avatarUrl: String, $bannerUrl: String) {\n  updateProfile(\n    name: $name\n    bio: $bio\n    avatarUrl: $avatarUrl\n    bannerUrl: $bannerUrl\n  ) {\n    ...UserCore\n  }\n}": typeof types.UpdateProfileDocument,
};
const documents: Documents = {
    "\n  query ForceNetwork {\n    __typename\n    posts {\n      posts {\n        id\n      }\n    }\n  }\n": types.ForceNetworkDocument,
    "\n  fragment PostCardFields on Post {\n    id\n    title\n    body\n    imageUrl\n    createdAt\n    likedByMe\n    savedByMe\n    author {\n      id\n      username\n      name\n      avatarUrl\n    }\n    tags {\n      id\n      name\n    }\n  }\n": types.PostCardFieldsFragmentDoc,
    "\n  fragment PostDetailFields on Post {\n    id\n    title\n    body\n    slug\n    imageUrl\n    summary\n    summaryStatus\n    createdAt\n    updatedAt\n    likedByMe\n    savedByMe\n    author {\n      id\n      username\n      email\n      name\n      bio\n      avatarUrl\n    }\n    tags {\n      id\n      name\n    }\n    related {\n      ...PostCardFields\n    }\n  }\n  \n": types.PostDetailFieldsFragmentDoc,
    "\n  fragment PaginatedPostFields on PaginatedPosts {\n    posts {\n      ...PostCardFields\n    }\n    totalPages\n    currentPage\n    totalPosts\n  }\n  \n": types.PaginatedPostFieldsFragmentDoc,
    "\n  query Posts($page: Int, $limit: Int) {\n    posts(page: $page, limit: $limit) {\n      ...PaginatedPostFields\n    }\n  }\n  \n": types.PostsDocument,
    "\n  query PostsByTag($tag: String!, $page: Int, $limit: Int) {\n    postsByTag(tag: $tag, page: $page, limit: $limit) {\n      ...PaginatedPostFields\n    }\n  }\n  \n": types.PostsByTagDocument,
    "\n  query Post($id: ID!) {\n    post(id: $id) {\n      ...PostDetailFields\n    }\n  }\n  \n": types.PostDocument,
    "\n  query Tags($query: String, $limit: Int) {\n    tags(query: $query, limit: $limit) {\n      id\n      name\n    }\n  }\n": types.TagsDocument,
    "\n  mutation CreatePost($input: CreatePostInput!) {\n    createPost(input: $input) {\n      id\n    }\n  }\n": types.CreatePostDocument,
    "\n  mutation UpdatePost($id: ID!, $input: UpdatePostInput!) {\n    updatePost(id: $id, input: $input) {\n      ...PostDetailFields\n    }\n  }\n  \n": types.UpdatePostDocument,
    "\n  mutation DeletePost($id: ID!) {\n    deletePost(id: $id)\n  }\n": types.DeletePostDocument,
    "\n  mutation RecordPostView($postId: ID!) {\n    recordPostView(postId: $postId)\n  }\n": types.RecordPostViewDocument,
    "\n  mutation LikePost($postId: ID!) {\n    likePost(postId: $postId)\n  }\n": types.LikePostDocument,
    "\n  mutation SavePost($postId: ID!) {\n    savePost(postId: $postId)\n  }\n": types.SavePostDocument,
    "\n  mutation GenerateTags($title: String!, $body: String!) {\n    generateTags(title: $title, body: $body)\n  }\n": types.GenerateTagsDocument,
    "\n  mutation GeneratePostContent($prompt: String!) {\n    generatePostContent(prompt: $prompt) {\n      title\n      body\n      summary\n      tags\n    }\n  }\n": types.GeneratePostContentDocument,
    "\n  query MyPosts($page: Int, $limit: Int) {\n    me {\n      id\n      posts(page: $page, limit: $limit) {\n        ...PaginatedPostFields\n      }\n    }\n  }\n  \n": types.MyPostsDocument,
    "\n  query SearchPosts($query: String!, $page: Int, $limit: Int) {\n    searchPosts(query: $query, page: $page, limit: $limit) {\n      hits {\n        ...PostCardFields\n      }\n      total\n    }\n  }\n  \n": types.SearchPostsDocument,
    "\n  query RecommendedPosts(\n    $page: Int\n    $limit: Int\n    $mode: RecommendMode\n    $seed: Int\n  ) {\n    recommendedPosts(page: $page, limit: $limit, mode: $mode, seed: $seed) {\n      ...PaginatedPostFields\n    }\n  }\n  \n": types.RecommendedPostsDocument,
    "fragment UserCore on User {\n  id\n  username\n  email\n  name\n  bio\n  avatarUrl\n  bannerUrl\n  createdAt\n}": types.UserCoreFragmentDoc,
    "query Me {\n  me {\n    ...UserCore\n  }\n}": types.MeDocument,
    "mutation Signin($email: String!, $password: String!) {\n  signin(email: $email, password: $password) {\n    token\n    user {\n      ...UserCore\n    }\n  }\n}": types.SigninDocument,
    "mutation Signup($email: String!, $username: String!, $password: String!) {\n  signup(email: $email, username: $username, password: $password) {\n    token\n    user {\n      ...UserCore\n    }\n  }\n}": types.SignupDocument,
    "mutation UpdateProfile($name: String, $bio: String, $avatarUrl: String, $bannerUrl: String) {\n  updateProfile(\n    name: $name\n    bio: $bio\n    avatarUrl: $avatarUrl\n    bannerUrl: $bannerUrl\n  ) {\n    ...UserCore\n  }\n}": types.UpdateProfileDocument,
};

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 *
 *
 * @example
 * ```ts
 * const query = graphql(`query GetUser($id: ID!) { user(id: $id) { name } }`);
 * ```
 *
 * The query argument is unknown!
 * Please regenerate the types.
 */
export function graphql(source: string): unknown;

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query ForceNetwork {\n    __typename\n    posts {\n      posts {\n        id\n      }\n    }\n  }\n"): (typeof documents)["\n  query ForceNetwork {\n    __typename\n    posts {\n      posts {\n        id\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment PostCardFields on Post {\n    id\n    title\n    body\n    imageUrl\n    createdAt\n    likedByMe\n    savedByMe\n    author {\n      id\n      username\n      name\n      avatarUrl\n    }\n    tags {\n      id\n      name\n    }\n  }\n"): (typeof documents)["\n  fragment PostCardFields on Post {\n    id\n    title\n    body\n    imageUrl\n    createdAt\n    likedByMe\n    savedByMe\n    author {\n      id\n      username\n      name\n      avatarUrl\n    }\n    tags {\n      id\n      name\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment PostDetailFields on Post {\n    id\n    title\n    body\n    slug\n    imageUrl\n    summary\n    summaryStatus\n    createdAt\n    updatedAt\n    likedByMe\n    savedByMe\n    author {\n      id\n      username\n      email\n      name\n      bio\n      avatarUrl\n    }\n    tags {\n      id\n      name\n    }\n    related {\n      ...PostCardFields\n    }\n  }\n  \n"): (typeof documents)["\n  fragment PostDetailFields on Post {\n    id\n    title\n    body\n    slug\n    imageUrl\n    summary\n    summaryStatus\n    createdAt\n    updatedAt\n    likedByMe\n    savedByMe\n    author {\n      id\n      username\n      email\n      name\n      bio\n      avatarUrl\n    }\n    tags {\n      id\n      name\n    }\n    related {\n      ...PostCardFields\n    }\n  }\n  \n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment PaginatedPostFields on PaginatedPosts {\n    posts {\n      ...PostCardFields\n    }\n    totalPages\n    currentPage\n    totalPosts\n  }\n  \n"): (typeof documents)["\n  fragment PaginatedPostFields on PaginatedPosts {\n    posts {\n      ...PostCardFields\n    }\n    totalPages\n    currentPage\n    totalPosts\n  }\n  \n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Posts($page: Int, $limit: Int) {\n    posts(page: $page, limit: $limit) {\n      ...PaginatedPostFields\n    }\n  }\n  \n"): (typeof documents)["\n  query Posts($page: Int, $limit: Int) {\n    posts(page: $page, limit: $limit) {\n      ...PaginatedPostFields\n    }\n  }\n  \n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query PostsByTag($tag: String!, $page: Int, $limit: Int) {\n    postsByTag(tag: $tag, page: $page, limit: $limit) {\n      ...PaginatedPostFields\n    }\n  }\n  \n"): (typeof documents)["\n  query PostsByTag($tag: String!, $page: Int, $limit: Int) {\n    postsByTag(tag: $tag, page: $page, limit: $limit) {\n      ...PaginatedPostFields\n    }\n  }\n  \n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Post($id: ID!) {\n    post(id: $id) {\n      ...PostDetailFields\n    }\n  }\n  \n"): (typeof documents)["\n  query Post($id: ID!) {\n    post(id: $id) {\n      ...PostDetailFields\n    }\n  }\n  \n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Tags($query: String, $limit: Int) {\n    tags(query: $query, limit: $limit) {\n      id\n      name\n    }\n  }\n"): (typeof documents)["\n  query Tags($query: String, $limit: Int) {\n    tags(query: $query, limit: $limit) {\n      id\n      name\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreatePost($input: CreatePostInput!) {\n    createPost(input: $input) {\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation CreatePost($input: CreatePostInput!) {\n    createPost(input: $input) {\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation UpdatePost($id: ID!, $input: UpdatePostInput!) {\n    updatePost(id: $id, input: $input) {\n      ...PostDetailFields\n    }\n  }\n  \n"): (typeof documents)["\n  mutation UpdatePost($id: ID!, $input: UpdatePostInput!) {\n    updatePost(id: $id, input: $input) {\n      ...PostDetailFields\n    }\n  }\n  \n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeletePost($id: ID!) {\n    deletePost(id: $id)\n  }\n"): (typeof documents)["\n  mutation DeletePost($id: ID!) {\n    deletePost(id: $id)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RecordPostView($postId: ID!) {\n    recordPostView(postId: $postId)\n  }\n"): (typeof documents)["\n  mutation RecordPostView($postId: ID!) {\n    recordPostView(postId: $postId)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation LikePost($postId: ID!) {\n    likePost(postId: $postId)\n  }\n"): (typeof documents)["\n  mutation LikePost($postId: ID!) {\n    likePost(postId: $postId)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SavePost($postId: ID!) {\n    savePost(postId: $postId)\n  }\n"): (typeof documents)["\n  mutation SavePost($postId: ID!) {\n    savePost(postId: $postId)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation GenerateTags($title: String!, $body: String!) {\n    generateTags(title: $title, body: $body)\n  }\n"): (typeof documents)["\n  mutation GenerateTags($title: String!, $body: String!) {\n    generateTags(title: $title, body: $body)\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation GeneratePostContent($prompt: String!) {\n    generatePostContent(prompt: $prompt) {\n      title\n      body\n      summary\n      tags\n    }\n  }\n"): (typeof documents)["\n  mutation GeneratePostContent($prompt: String!) {\n    generatePostContent(prompt: $prompt) {\n      title\n      body\n      summary\n      tags\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query MyPosts($page: Int, $limit: Int) {\n    me {\n      id\n      posts(page: $page, limit: $limit) {\n        ...PaginatedPostFields\n      }\n    }\n  }\n  \n"): (typeof documents)["\n  query MyPosts($page: Int, $limit: Int) {\n    me {\n      id\n      posts(page: $page, limit: $limit) {\n        ...PaginatedPostFields\n      }\n    }\n  }\n  \n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query SearchPosts($query: String!, $page: Int, $limit: Int) {\n    searchPosts(query: $query, page: $page, limit: $limit) {\n      hits {\n        ...PostCardFields\n      }\n      total\n    }\n  }\n  \n"): (typeof documents)["\n  query SearchPosts($query: String!, $page: Int, $limit: Int) {\n    searchPosts(query: $query, page: $page, limit: $limit) {\n      hits {\n        ...PostCardFields\n      }\n      total\n    }\n  }\n  \n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query RecommendedPosts(\n    $page: Int\n    $limit: Int\n    $mode: RecommendMode\n    $seed: Int\n  ) {\n    recommendedPosts(page: $page, limit: $limit, mode: $mode, seed: $seed) {\n      ...PaginatedPostFields\n    }\n  }\n  \n"): (typeof documents)["\n  query RecommendedPosts(\n    $page: Int\n    $limit: Int\n    $mode: RecommendMode\n    $seed: Int\n  ) {\n    recommendedPosts(page: $page, limit: $limit, mode: $mode, seed: $seed) {\n      ...PaginatedPostFields\n    }\n  }\n  \n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "fragment UserCore on User {\n  id\n  username\n  email\n  name\n  bio\n  avatarUrl\n  bannerUrl\n  createdAt\n}"): (typeof documents)["fragment UserCore on User {\n  id\n  username\n  email\n  name\n  bio\n  avatarUrl\n  bannerUrl\n  createdAt\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query Me {\n  me {\n    ...UserCore\n  }\n}"): (typeof documents)["query Me {\n  me {\n    ...UserCore\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation Signin($email: String!, $password: String!) {\n  signin(email: $email, password: $password) {\n    token\n    user {\n      ...UserCore\n    }\n  }\n}"): (typeof documents)["mutation Signin($email: String!, $password: String!) {\n  signin(email: $email, password: $password) {\n    token\n    user {\n      ...UserCore\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation Signup($email: String!, $username: String!, $password: String!) {\n  signup(email: $email, username: $username, password: $password) {\n    token\n    user {\n      ...UserCore\n    }\n  }\n}"): (typeof documents)["mutation Signup($email: String!, $username: String!, $password: String!) {\n  signup(email: $email, username: $username, password: $password) {\n    token\n    user {\n      ...UserCore\n    }\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "mutation UpdateProfile($name: String, $bio: String, $avatarUrl: String, $bannerUrl: String) {\n  updateProfile(\n    name: $name\n    bio: $bio\n    avatarUrl: $avatarUrl\n    bannerUrl: $bannerUrl\n  ) {\n    ...UserCore\n  }\n}"): (typeof documents)["mutation UpdateProfile($name: String, $bio: String, $avatarUrl: String, $bannerUrl: String) {\n  updateProfile(\n    name: $name\n    bio: $bio\n    avatarUrl: $avatarUrl\n    bannerUrl: $bannerUrl\n  ) {\n    ...UserCore\n  }\n}"];

export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> = TDocumentNode extends DocumentNode<  infer TType,  any>  ? TType  : never;