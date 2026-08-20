import { HttpResponse, graphql, http } from "msw";
import {
  askChat,
  authenticate,
  createChat,
  createPost,
  deleteChat,
  deletePost,
  generatePostContent,
  generateTags,
  getChatResponse,
  getPost,
  getSignedInUser,
  listChatMessages,
  listChats,
  listPosts,
  listPostsByTag,
  listTags,
  recordPostView,
  renameChat,
  searchPosts,
  toUserResponse,
  togglePostLike,
  togglePostSave,
  updatePost,
  updateProfile,
} from "./data";

const gql = graphql.link("http://localhost:4000/graphql");

const isAuthenticated = (request: Request) =>
  request.headers.get("authorization") !== null;

const me = () => {
  const user = getSignedInUser();
  return user ? toUserResponse(user) : null;
};

export const handlers = [
  gql.query("Me", ({ request }) =>
    HttpResponse.json({
      data: { me: isAuthenticated(request) ? me() : null },
    }),
  ),

  gql.mutation("Signin", () =>
    HttpResponse.json({
      data: { signin: authenticate() },
    }),
  ),

  gql.mutation("Signup", () =>
    HttpResponse.json({
      data: { signup: authenticate() },
    }),
  ),

  gql.mutation("UpdateProfile", ({ variables }) =>
    HttpResponse.json({
      data: {
        updateProfile: updateProfile({
          name: variables?.name,
          bio: variables?.bio,
          avatarUrl: variables?.avatarUrl,
          bannerUrl: variables?.bannerUrl,
        }),
      },
    }),
  ),

  gql.query("Posts", ({ variables }) =>
    HttpResponse.json({
      data: { posts: listPosts(variables?.page ?? 1, variables?.limit ?? 6) },
    }),
  ),

  gql.query("PostsByTag", ({ variables }) =>
    HttpResponse.json({
      data: {
        postsByTag: listPostsByTag(
          variables?.tag,
          variables?.page ?? 1,
          variables?.limit ?? 6,
        ),
      },
    }),
  ),

  gql.query("Post", ({ variables }) =>
    HttpResponse.json({
      data: { post: getPost(variables?.id) },
    }),
  ),

  gql.query("Tags", ({ variables }) =>
    HttpResponse.json({
      data: { tags: listTags(variables?.query ?? "", variables?.limit ?? 6) },
    }),
  ),

  gql.query("MyPosts", ({ request, variables }) =>
    HttpResponse.json({
      data: {
        me: isAuthenticated(request)
          ? {
              __typename: "User",
              id: me()?.id,
              posts: listPosts(variables?.page ?? 1, variables?.limit ?? 6),
            }
          : null,
      },
    }),
  ),

  gql.query("SearchPosts", ({ variables }) =>
    HttpResponse.json({
      data: {
        searchPosts: searchPosts(
          variables?.query,
          variables?.page ?? 1,
          variables?.limit ?? 6,
        ),
      },
    }),
  ),

  gql.query("RecommendedPosts", ({ request, variables }) =>
    HttpResponse.json(
      isAuthenticated(request)
        ? {
            data: {
              recommendedPosts: listPosts(
                variables?.page ?? 1,
                variables?.limit ?? 6,
              ),
            },
          }
        : { errors: [{ message: "unauthorized" }] },
    ),
  ),

  gql.mutation("CreatePost", ({ variables }) =>
    HttpResponse.json({
      data: { createPost: createPost(variables?.input) },
    }),
  ),

  gql.mutation("UpdatePost", ({ variables }) =>
    HttpResponse.json({
      data: { updatePost: updatePost(variables?.id, variables?.input) },
    }),
  ),

  gql.mutation("DeletePost", ({ variables }) =>
    HttpResponse.json({
      data: { deletePost: deletePost(variables?.id) },
    }),
  ),

  gql.mutation("RecordPostView", () =>
    HttpResponse.json({
      data: { recordPostView: recordPostView() },
    }),
  ),

  gql.mutation("LikePost", ({ variables }) =>
    HttpResponse.json({
      data: { likePost: togglePostLike(variables?.postId) },
    }),
  ),

  gql.mutation("SavePost", ({ variables }) =>
    HttpResponse.json({
      data: { savePost: togglePostSave(variables?.postId) },
    }),
  ),

  gql.mutation("GenerateTags", ({ variables }) =>
    HttpResponse.json({
      data: { generateTags: generateTags(variables?.title, variables?.body) },
    }),
  ),

  gql.mutation("GeneratePostContent", ({ variables }) =>
    HttpResponse.json({
      data: { generatePostContent: generatePostContent(variables?.prompt) },
    }),
  ),

  gql.query("Chats", ({ variables }) =>
    HttpResponse.json({
      data: { chats: listChats(variables?.page ?? 1, variables?.limit ?? 10) },
    }),
  ),

  gql.query("Chat", ({ variables }) =>
    HttpResponse.json({
      data: { chat: getChatResponse(variables?.id) },
    }),
  ),

  gql.query("ChatMessages", ({ variables }) =>
    HttpResponse.json({
      data: {
        chatMessages: listChatMessages(
          variables?.chatId,
          variables?.page ?? 1,
          variables?.limit ?? 20,
        ),
      },
    }),
  ),

  gql.mutation("CreateChat", ({ variables }) =>
    HttpResponse.json({
      data: { createChat: createChat(variables?.title) },
    }),
  ),

  gql.mutation("RenameChat", ({ variables }) =>
    HttpResponse.json({
      data: { renameChat: renameChat(variables?.id, variables?.title) },
    }),
  ),

  gql.mutation("DeleteChat", ({ variables }) =>
    HttpResponse.json({
      data: { deleteChat: deleteChat(variables?.id) },
    }),
  ),

  gql.mutation("AskChat", ({ variables }) =>
    HttpResponse.json({
      data: { askChat: askChat(variables?.chatId, variables?.query) },
    }),
  ),

  http.post("https://api.cloudinary.com/v1_1/:cloudName/image/upload", () =>
    HttpResponse.json({
      secure_url: `https://picsum.photos/seed/upload-${Date.now()}/1200/630`,
    }),
  ),
];