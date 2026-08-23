import { useState } from "react";
import { useMutation } from "@apollo/client/react";
import {
  CreatePostDraftDocument,
  type PostDraft,
} from "@/shared/graphql/content-documents";
import { getGraphQLErrorMessage } from "@/shared/api";
import { useToast } from "@/shared/ui/hooks/useToast";

export interface UseCreatePostDraftResult {
  isSubmitting: boolean;
  submitForReview: (prompt: string) => Promise<PostDraft | null>;
}

// useCreatePostDraft sends an authoring prompt through createPostDraft so
// the generated post enters the peer-review queue instead of the editor.
export const useCreatePostDraft = (): UseCreatePostDraftResult => {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mutate] = useMutation(CreatePostDraftDocument);

  const submitForReview = async (prompt: string): Promise<PostDraft | null> => {
    const trimmed = prompt.trim();
    if (!trimmed) {
      toast({
        title: "Prompt Required",
        description: "Describe the post you want drafted before submitting.",
        variant: "destructive",
      });
      return null;
    }

    setIsSubmitting(true);
    try {
      const { data } = await mutate({ variables: { prompt: trimmed } });
      const draft = data?.createPostDraft;
      if (!draft) {
        throw new Error("empty response");
      }
      toast({
        title: "Draft Submitted",
        description:
          "Your AI draft is waiting in the review queue until someone else approves it.",
      });
      return draft;
    } catch (error) {
      toast({
        title: "Submission Failed",
        description: getGraphQLErrorMessage(
          error,
          "Unable to submit the draft for review right now.",
        ),
        variant: "destructive",
      });
      return null;
    } finally {
      setIsSubmitting(false);
    }
  };

  return { isSubmitting, submitForReview };
};
