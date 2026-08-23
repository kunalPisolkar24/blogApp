import type React from "react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { PostDraft } from "@/shared/graphql/content-documents";
import {
  approveDraftSchema,
  parseTagsInput,
  type ApproveDraftFormValues,
} from "./model/approve-draft.schema";

interface ApproveDraftDialogProps {
  draft: PostDraft | null;
  isSubmitting: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (draft: PostDraft, edits: ApproveDraftFormValues) => void;
}

// Reviewers edit the generated payload before resuming the workflow;
// untouched fields are sent back as-is so approval is a single action.
export const ApproveDraftDialog: React.FC<ApproveDraftDialogProps> = ({
  draft,
  isSubmitting,
  onOpenChange,
  onConfirm,
}) => {
  const form = useForm<ApproveDraftFormValues>({
    resolver: zodResolver(approveDraftSchema),
    defaultValues: { title: "", body: "", summary: "", tags: "" },
  });

  useEffect(() => {
    if (!draft) return;
    form.reset({
      title: draft.title,
      body: draft.body,
      summary: draft.summary ?? "",
      tags: draft.tags.join(", "),
    });
  }, [draft, form]);

  const handleSubmit = form.handleSubmit((values) => {
    if (!draft) return;
    onConfirm(draft, values);
  });

  return (
    <Dialog open={Boolean(draft)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Review &amp; approve draft</DialogTitle>
        </DialogHeader>
        <p className="text-sm leading-6 text-muted-foreground">
          Approving resumes the paused AI workflow and publishes this post
          under its author's name. Edit anything before you confirm.
        </p>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="draft-review-title">Title</Label>
            <Input id="draft-review-title" {...form.register("title")} />
            {form.formState.errors.title && (
              <p className="text-sm text-destructive">
                {form.formState.errors.title.message}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="draft-review-body">Body (HTML)</Label>
            <Textarea
              id="draft-review-body"
              rows={10}
              className="min-h-48 font-mono text-xs leading-6"
              {...form.register("body")}
            />
            {form.formState.errors.body && (
              <p className="text-sm text-destructive">
                {form.formState.errors.body.message}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="draft-review-summary">Summary</Label>
            <Textarea
              id="draft-review-summary"
              rows={3}
              {...form.register("summary")}
            />
            {form.formState.errors.summary && (
              <p className="text-sm text-destructive">
                {form.formState.errors.summary.message}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="draft-review-tags">Tags (comma separated)</Label>
            <Input id="draft-review-tags" {...form.register("tags")} />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Approving..." : "Approve & Publish"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export const buildEditsInput = (
  draftId: string,
  values: ApproveDraftFormValues,
) => ({
  id: draftId,
  input: {
    title: values.title,
    body: values.body,
    summary: values.summary || null,
    tags: parseTagsInput(values.tags),
  },
});
