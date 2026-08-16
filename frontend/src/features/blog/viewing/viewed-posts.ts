// viewed-posts tracks which posts have already reported a view in the
// current session. The backend dedupes re-views within 24h on its side
// too (Redis), so this set only prevents duplicate network calls while
// the tab is open: navigating away and back to the same post must not
// fire recordPostView twice.

const viewedPostIds = new Set<string>();

export function markPostViewed(postId: string): boolean {
  if (viewedPostIds.has(postId)) {
    return false;
  }
  viewedPostIds.add(postId);
  return true;
}

export function resetViewedPostsForTests() {
  viewedPostIds.clear();
}