import { useState } from "react";
import { useApolloClient, useMutation, useQuery } from "@apollo/client/react";
import {
  ApprovePostDraftDocument,
  DeletePostDraftDocument,
  MyPostDraftsDocument,
  PostDraftsDocument,
  RejectPostDraftDocument,
  type DraftEditsInput,
  type MyPostDraftsQuery,
  type MyPostDraftsQueryVariables,
  type PostDraft,
  type PostDraftsQuery,
  type PostDraftsQueryVariables,
} from "@/shared/graphql/content-documents";
import { getGraphQLErrorMessage } from "@/shared/api";
import { useToast } from "@/shared/ui/hooks/useToast";
import { useSessionStore } from "@/entities/session";

export type ReviewDialog =
  | { kind: "closed" }
  | { kind: "approve"; draft: PostDraft }
  | { kind: "reject"; draft: PostDraft }
  | { kind: "withdraw"; draft: PostDraft };

export interface PaginatedDraftSection {
  drafts: PostDraft[];
  totalPages: number;
  currentPage: number;
  totalDrafts: number;
}

export interface ReviewQueueController {
  isAuthenticated: boolean;
  community: {
    section: "loading" | "error" | "ready";
    data: PaginatedDraftSection;
    page: number;
    setPage: (page: number) => void;
    refetch: () => void;
  };
  mine: {
    section: "loading" | "error" | "ready";
    data: PaginatedDraftSection;
    page: number;
    setPage: (page: number) => void;
    refetch: () => void;
  };
  dialog: ReviewDialog;
  setDialog: (dialog: ReviewDialog) => void;
  approve: (draftId: string, edits: DraftEditsInput) => Promise<void>;
  reject: (draftId: string, reason: string) => Promise<void>;
  withdraw: (draftId: string) => Promise<void>;
}

const PAGE_LIMIT = 6;

const emptySection: PaginatedDraftSection = {
  drafts: [],
  totalPages: 0,
  currentPage: 1,
  totalDrafts: 0,
};

// useReviewQueueController drives the two-section review page. Status
// flips land optimistically on the normalized PostDraft entity so the
// row reacts instantly, then both lists refetch so reviewed drafts
// leave their queues and any lost race (someone else reviewed first)
// resolves to server truth.
export const useReviewQueueController = (): ReviewQueueController => {
  const client = useApolloClient();
  const { toast } = useToast();
  const isAuthenticated =
    useSessionStore((state) => state.status) === "authenticated";

  const [communityPage, setCommunityPage] = useState(1);
  const [minePage, setMinePage] = useState(1);

  const communityQuery = useQuery<PostDraftsQuery, PostDraftsQueryVariables>(
    PostDraftsDocument,
    { variables: { page: communityPage, limit: PAGE_LIMIT }, skip: !isAuthenticated },
  );
  const mineQuery = useQuery<MyPostDraftsQuery, MyPostDraftsQueryVariables>(
    MyPostDraftsDocument,
    { variables: { page: minePage, limit: PAGE_LIMIT }, skip: !isAuthenticated },
  );

  const [approveMutation] = useMutation(ApprovePostDraftDocument);
  const [rejectMutation] = useMutation(RejectPostDraftDocument);
  const [withdrawMutation] = useMutation(DeletePostDraftDocument);

  const [dialog, setDialog] = useState<ReviewDialog>({ kind: "closed" });

  const applyStatus = (draftId: string, status: PostDraft["status"]) => {
    const ref = client.cache.identify({ __typename: "PostDraft", id: draftId });
    if (!ref) return undefined;
    let previous: PostDraft["status"] | undefined;
    client.cache.modify({
      id: ref,
      fields: {
        status: (existing) => {
          previous = existing as PostDraft["status"];
          return status;
        },
      },
    });
    return previous;
  };

  const reportError = (fallback: string) => (err: unknown) => {
    toast({
      title: "Error",
      description: getGraphQLErrorMessage(err, fallback),
      variant: "destructive",
    });
  };

  const refreshLists = () =>
    client.refetchQueries({ include: ["PostDrafts", "MyPostDrafts"] });

  const act = async (
    draftId: string,
    optimisticStatus: PostDraft["status"],
    run: () => Promise<unknown>,
    successTitle: string,
    failureFallback: string,
  ) => {
    const previousStatus = applyStatus(draftId, optimisticStatus);
    try {
      await run();
      toast({ title: successTitle });
      await refreshLists();
    } catch (err) {
      if (previousStatus !== undefined) {
        applyStatus(draftId, previousStatus);
      }
      reportError(failureFallback)(err);
    }
  };

  const approve = async (draftId: string, edits: DraftEditsInput) =>
    act(
      draftId,
      "APPROVED",
      () => approveMutation({ variables: { id: draftId, input: edits } }),
      "Draft Approved",
      "Could not approve the draft.",
    );

  const reject = async (draftId: string, reason: string) =>
    act(
      draftId,
      "REJECTED",
      () =>
        rejectMutation({
          variables: { id: draftId, reason: reason || null },
        }),
      "Draft Rejected",
      "Could not reject the draft.",
    );

  const withdraw = async (draftId: string) =>
    act(
      draftId,
      "PENDING",
      () => withdrawMutation({ variables: { id: draftId } }),
      "Draft Withdrawn",
      "Could not withdraw the draft.",
    );

  const mapSection = (
    loading: boolean,
    error?: Error,
    data?: PaginatedDraftSection,
  ) => ({
    section: loading ? ("loading" as const) : error ? ("error" as const) : ("ready" as const),
    data: data ?? emptySection,
  });

  const community = {
    ...mapSection(
      communityQuery.loading,
      communityQuery.error,
      communityQuery.data?.postDrafts,
    ),
    page: communityPage,
    setPage: setCommunityPage,
    refetch: () => void communityQuery.refetch(),
  };
  const mine = {
    ...mapSection(mineQuery.loading, mineQuery.error, mineQuery.data?.myPostDrafts),
    page: minePage,
    setPage: setMinePage,
    refetch: () => void mineQuery.refetch(),
  };

  return {
    isAuthenticated,
    community,
    mine,
    dialog,
    setDialog,
    approve,
    reject,
    withdraw,
  };
};
