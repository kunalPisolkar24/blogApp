import { useEffect, useState } from "react";
import { useApolloClient, useMutation, useQuery } from "@apollo/client/react";
import { useNavigate } from "react-router-dom";
import {
  DeletePostDocument,
  PostDocument,
  RecordPostViewDocument,
  type PostQuery,
  type PostQueryVariables,
} from "@/shared/graphql/content-documents";
import { getGraphQLErrorMessage, refreshPostListQueries } from "@/shared/api";
import { useToast } from "@/shared/ui/hooks/useToast";
import { useSessionStore } from "@/entities/session";
import { markPostViewed } from "./viewed-posts";

// Views are best-effort signal, so they wait a moment before firing and
// never surface errors to the reader.
const VIEW_DEBOUNCE_MS = 1000;

type LoadedPost = NonNullable<PostQuery["post"]>;

export type PostViewerDialog = "closed" | "delete" | "summary";
export type PostViewerView = "reading" | "editing";

export type PostViewerSnapshot =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "not-found" }
  | {
      kind: "ready";
      post: LoadedPost;
      view: PostViewerView;
      dialog: PostViewerDialog;
      isDeleting: boolean;
    };

export interface PostViewerController {
  state: PostViewerSnapshot;
  setView: (view: PostViewerView) => void;
  setDialog: (dialog: PostViewerDialog) => void;
  deletePost: () => Promise<void>;
  refetch: () => void;
}

export const usePostViewerController = (
  postId: string | undefined,
): PostViewerController => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const client = useApolloClient();
  const [view, setView] = useState<PostViewerView>("reading");
  const [dialog, setDialog] = useState<PostViewerDialog>("closed");
  const isAuthenticated =
    useSessionStore((state) => state.status) === "authenticated";

  const { data, loading, error, refetch, startPolling, stopPolling } =
    useQuery<PostQuery, PostQueryVariables>(PostDocument, {
      variables: { id: postId ?? "" },
      skip: !postId,
      notifyOnNetworkStatusChange: true,
    });

  const isReady = Boolean(data?.post);

  const [recordPostView] = useMutation(RecordPostViewDocument);

  useEffect(() => {
    if (data?.post?.summaryStatus === "PENDING") {
      startPolling(3000);
    } else {
      stopPolling();
    }
    return () => stopPolling();
  }, [data?.post?.summaryStatus, startPolling, stopPolling]);

  // Report the view once the post has loaded: debounced, once per
  // session per post, and never for anonymous readers (the mutation
  // requires auth). Failures are swallowed on purpose.
  useEffect(() => {
    if (!postId || !isReady || !isAuthenticated) return;
    const timer = setTimeout(() => {
      if (!markPostViewed(postId)) return;
      void recordPostView({ variables: { postId } }).catch(() => {});
    }, VIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [postId, isReady, isAuthenticated, recordPostView]);

  const [deletePost, { loading: isDeleting }] = useMutation(DeletePostDocument);

  useEffect(() => {
    if (!error) return;
    toast({
      title: "Error",
      description: "Could not load blog post.",
      variant: "destructive",
    });
    navigate("/");
  }, [error, navigate, toast]);

  const handleDelete = async () => {
    if (!postId) return;
    try {
      await deletePost({ variables: { id: postId } });
      await refreshPostListQueries(client, { postId });
      toast({
        title: "Blog Deleted",
        description: "Successfully deleted.",
      });
      navigate("/");
    } catch (err) {
      toast({
        title: "Error",
        description: getGraphQLErrorMessage(err, "Failed to delete post."),
        variant: "destructive",
      });
    } finally {
      setDialog("closed");
    }
  };

  let state: PostViewerSnapshot;
  if (error) {
    state = { kind: "error" };
  } else if (loading && !data) {
    state = { kind: "loading" };
  } else if (!data?.post) {
    state = { kind: "not-found" };
  } else {
    state = {
      kind: "ready",
      post: data.post,
      view,
      dialog,
      isDeleting,
    };
  }

  return {
    state,
    setView,
    setDialog,
    deletePost: handleDelete,
    refetch: () => {
      void refetch();
    },
  };
};
