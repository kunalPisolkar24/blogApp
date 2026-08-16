import { useApolloClient, useMutation } from "@apollo/client/react";
import {
  LikePostDocument,
  SavePostDocument,
} from "@/shared/graphql/content-documents";
import { getGraphQLErrorMessage } from "@/shared/api";
import { useToast } from "@/shared/ui/hooks/useToast";

export interface PostInteractionsController {
  liked: boolean;
  saved: boolean;
  isToggling: boolean;
  toggleLike: () => Promise<void>;
  toggleSave: () => Promise<void>;
}

// usePostInteractions wires the like/save toggle buttons on post cards
// to the likePost/savePost mutations. The current state comes from the
// post query (likedByMe/savedByMe), and every toggle writes the new
// state straight into the normalized Post entity, so every list that
// shows the post updates in place. The UI flips optimistically and is
// rolled back to the previous value when the mutation fails.
export const usePostInteractions = (
  postId: string,
  likedByMe: boolean,
  savedByMe: boolean,
): PostInteractionsController => {
  const client = useApolloClient();
  const { toast } = useToast();
  const [likePost, { loading: isLiking }] = useMutation(LikePostDocument);
  const [savePost, { loading: isSaving }] = useMutation(SavePostDocument);

  const applyState = (liked: boolean, saved: boolean) => {
    const postRef = client.cache.identify({ __typename: "Post", id: postId });
    if (!postRef) return;
    client.cache.modify({
      id: postRef,
      fields: {
        likedByMe: () => liked,
        savedByMe: () => saved,
      },
    });
  };

  const reportError = (fallback: string) => (err: unknown) => {
    toast({
      title: "Error",
      description: getGraphQLErrorMessage(err, fallback),
      variant: "destructive",
    });
  };

  const toggleLike = async () => {
    const previous = likedByMe;
    applyState(!previous, savedByMe);
    try {
      const { data } = await likePost({
        variables: { postId },
        optimisticResponse: { likePost: !previous },
      });
      applyState(data?.likePost ?? !previous, savedByMe);
    } catch (err) {
      applyState(previous, savedByMe);
      reportError("Could not update like.")(err);
    }
  };

  const toggleSave = async () => {
    const previous = savedByMe;
    applyState(likedByMe, !previous);
    try {
      const { data } = await savePost({
        variables: { postId },
        optimisticResponse: { savePost: !previous },
      });
      applyState(likedByMe, data?.savePost ?? !previous);
    } catch (err) {
      applyState(likedByMe, previous);
      reportError("Could not update save.")(err);
    }
  };

  return {
    liked: likedByMe,
    saved: savedByMe,
    isToggling: isLiking || isSaving,
    toggleLike,
    toggleSave,
  };
};