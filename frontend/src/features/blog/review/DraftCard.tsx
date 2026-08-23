import type React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Check, RotateCcw, Undo2 } from "lucide-react";
import type { DraftStatus, PostDraft } from "@/shared/graphql/content-documents";

const statusBadge: Record<DraftStatus, { label: string; variant: "secondary" | "default" | "destructive" }> = {
  PENDING: { label: "Pending review", variant: "secondary" },
  APPROVED: { label: "Approved", variant: "default" },
  REJECTED: { label: "Rejected", variant: "destructive" },
};

interface DraftCardProps {
  draft: PostDraft;
  isOwnDraft: boolean;
  onApprove: (draft: PostDraft) => void;
  onReject: (draft: PostDraft) => void;
  onWithdraw: (draft: PostDraft) => void;
}

export const DraftCard: React.FC<DraftCardProps> = ({
  draft,
  isOwnDraft,
  onApprove,
  onReject,
  onWithdraw,
}) => {
  const badge = statusBadge[draft.status] ?? statusBadge.PENDING;

  return (
    <Card className="gap-0 bg-surface-lowest py-0">
      <CardHeader className="p-4 pb-0 sm:p-5 sm:pb-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="truncate text-lg font-semibold tracking-[-0.03em]">
              {draft.title}
            </CardTitle>
            <p className="mt-1 font-mono text-[0.625rem] uppercase tracking-[0.16em] text-muted-foreground">
              Prompted by author {draft.authorId.slice(0, 8)} ·{" "}
              {new Date(draft.createdAt).toLocaleDateString()}
            </p>
          </div>
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-3 sm:p-5 sm:pt-3">
        <p className="font-mono text-[0.625rem] uppercase tracking-[0.14em] text-muted-foreground">
          Summary
        </p>
        <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">
          {draft.summary || "(no summary generated)"}
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {draft.tags.map((tag) => (
            <span
              key={tag}
              className="bg-surface px-2 py-0.5 text-xs text-muted-foreground ring-1 ring-outline-variant/20"
            >
              {tag}
            </span>
          ))}
        </div>
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2 border-t border-outline-variant/20 p-4 sm:px-5">
        {!isOwnDraft && draft.status !== "APPROVED" && (
          <>
            <Button
              type="button"
              size="sm"
              onClick={() => onApprove(draft)}
              disabled={draft.status === "APPROVED"}
            >
              <Check className="h-4 w-4" />
              Review &amp; Approve
            </Button>
            {draft.status === "PENDING" && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onReject(draft)}
              >
                <RotateCcw className="h-4 w-4" />
                Reject
              </Button>
            )}
          </>
        )}
        {isOwnDraft && draft.status === "PENDING" && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onWithdraw(draft)}
          >
            <Undo2 className="h-4 w-4" />
            Withdraw
          </Button>
        )}
      </CardFooter>
    </Card>
  );
};
