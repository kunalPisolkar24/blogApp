import type React from "react";
import { ShieldCheck } from "lucide-react";
import { useCurrentUser } from "@/entities/session";
import { PagePagination, StickyNavbar } from "@/widgets";
import { LoadingSpinner } from "@/shared/ui/feedback/LoadingSpinner";
import { Button } from "@/components/ui/button";
import type { DraftEditsInput, PostDraft } from "@/shared/graphql/content-documents";
import {
  DraftCard,
  ApproveDraftDialog,
  ConfirmDialog,
  buildEditsInput,
  useReviewQueueController,
  type ReviewQueueController,
} from "./index";

interface DraftSectionProps {
  title: string;
  description: string;
  section: ReviewQueueController["community"];
  currentUserId?: string;
  onApprove: (draft: PostDraft) => void;
  onReject: (draft: PostDraft) => void;
  onWithdraw: (draft: PostDraft) => void;
}

const DraftSection: React.FC<DraftSectionProps> = ({
  title,
  description,
  section,
  currentUserId,
  onApprove,
  onReject,
  onWithdraw,
}) => (
  <section className="space-y-4">
    <div>
      <h2 className="text-2xl font-semibold tracking-[-0.04em] text-foreground">
        {title}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>

    {section.section === "loading" && <LoadingSpinner />}
    {section.section === "error" && (
      <div className="bg-surface-low p-6 ring-1 ring-outline-variant/20">
        <p className="text-sm text-muted-foreground">
          Could not load drafts.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={section.refetch}
        >
          Try again
        </Button>
      </div>
    )}
    {section.section === "ready" && section.data.drafts.length === 0 && (
      <div className="bg-surface-low p-6 ring-1 ring-outline-variant/20">
        <p className="text-sm text-muted-foreground">Nothing here right now.</p>
      </div>
    )}
    {section.section === "ready" && section.data.drafts.length > 0 && (
      <>
        <div className="grid gap-4">
          {section.data.drafts.map((draft) => (
            <DraftCard
              key={draft.id}
              draft={draft}
              isOwnDraft={Boolean(currentUserId && draft.authorId === currentUserId)}
              onApprove={onApprove}
              onReject={onReject}
              onWithdraw={onWithdraw}
            />
          ))}
        </div>
        {section.data.totalPages > 1 && (
          <PagePagination
            currentPage={section.data.currentPage}
            totalPages={section.data.totalPages}
            onPageChange={section.setPage}
            align="center"
          />
        )}
      </>
    )}
  </section>
);

const ReviewQueuePage: React.FC = () => {
  const controller = useReviewQueueController();
  const { user } = useCurrentUser();

  if (!controller.isAuthenticated) {
    return (
      <div className="min-h-screen bg-surface text-foreground">
        <StickyNavbar />
        <main className="container mx-auto px-4 pb-20 pt-app-navbar-offset sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl bg-surface-low p-10 text-center ring-1 ring-outline-variant/20">
            <ShieldCheck className="mx-auto h-10 w-10 text-muted-foreground" />
            <h1 className="mt-4 text-xl font-semibold">Sign in to review drafts</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              The review queue is only available to signed-in users.
            </p>
          </div>
        </main>
      </div>
    );
  }

  const handleApproveConfirm = (draft: PostDraft, values: Parameters<ReturnType<typeof buildEditsInput>>[1]) => {
    const edits: DraftEditsInput = buildEditsInput(values).input;
    controller.setDialog({ kind: "closed" });
    void controller.approve(draft.id, edits);
  };

  return (
    <div className="min-h-screen bg-surface text-foreground">
      <StickyNavbar />
      <main className="container mx-auto px-4 pb-20 pt-app-navbar-offset sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <header className="relative overflow-hidden bg-surface-low p-5 ring-1 ring-outline-variant/20 sm:p-8">
            <div className="mb-5 inline-flex items-center gap-2 bg-primary-container px-3 py-2 text-primary-foreground">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              <span className="font-mono text-[0.6875rem] font-medium uppercase tracking-[0.18em]">
                Peer Review
              </span>
            </div>
            <h1 className="text-3xl font-semibold tracking-[-0.05em] text-foreground md:text-5xl">
              AI drafts, human decisions.
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
              Generated posts stay paused until someone else approves them.
              You can never review your own draft — that is the point.
            </p>
          </header>

          <div className="mt-8 space-y-12">
            <DraftSection
              title="Needs review"
              description="Pending AI drafts from other authors. Approve with edits or reject."
              section={controller.community}
              currentUserId={user?.id}
              onApprove={(draft) => controller.setDialog({ kind: "approve", draft })}
              onReject={(draft) => controller.setDialog({ kind: "reject", draft })}
              onWithdraw={() => {}}
            />
            <DraftSection
              title="Your drafts"
              description="Everything you submitted, in every state. Pending drafts can be withdrawn."
              section={controller.mine}
              currentUserId={user?.id}
              onApprove={() => {}}
              onReject={() => {}}
              onWithdraw={(draft) => controller.setDialog({ kind: "withdraw", draft })}
            />
          </div>
        </div>
      </main>

      <ApproveDraftDialog
        draft={
          controller.dialog.kind === "approve" ? controller.dialog.draft : null
        }
        isSubmitting={false}
        onOpenChange={(open) => {
          if (!open) controller.setDialog({ kind: "closed" });
        }}
        onConfirm={handleApproveConfirm}
      />

      <ConfirmDialog
        open={controller.dialog.kind === "reject"}
        title="Reject this draft?"
        description="The draft stays visible to its author as rejected, but nothing gets published. A rejected draft can still be approved later."
        confirmLabel="Reject draft"
        destructive
        onOpenChange={(open) => {
          if (!open) controller.setDialog({ kind: "closed" });
        }}
        onConfirm={() => {
          const draft =
            controller.dialog.kind === "reject" ? controller.dialog.draft : null;
          controller.setDialog({ kind: "closed" });
          if (draft) void controller.reject(draft.id, "");
        }}
      />

      <ConfirmDialog
        open={controller.dialog.kind === "withdraw"}
        title="Withdraw this draft?"
        description="Your pending draft will be removed from every review queue. This cannot be undone."
        confirmLabel="Withdraw draft"
        destructive
        onOpenChange={(open) => {
          if (!open) controller.setDialog({ kind: "closed" });
        }}
        onConfirm={() => {
          const draft =
            controller.dialog.kind === "withdraw" ? controller.dialog.draft : null;
          controller.setDialog({ kind: "closed" });
          if (draft) void controller.withdraw(draft.id);
        }}
      />
    </div>
  );
};

export default ReviewQueuePage;
