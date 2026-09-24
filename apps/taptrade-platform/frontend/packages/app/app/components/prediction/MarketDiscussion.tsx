"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import {
  createMarketComment,
  followSocialUser,
  getMarketComments,
  reactToMarketComment,
  reportMarketComment,
  type MarketComment,
} from "../../lib/api/market-social-client";
import { logger } from "../../lib/logger";
import { Button, Card, Textarea } from "../ui";

const HEAD_CLASS = "mb-4 flex items-baseline justify-between gap-3";
const TITLE_CLASS =
  "type-display m-0 text-base font-semibold tracking-[-0.01em] text-[var(--t1)]";
const COUNT_CLASS = "text-xs text-[var(--t3)]";
const HEAD_LINK_CLASS =
  "text-xs text-[var(--t2)] underline-offset-4 hover:text-[var(--accent)] hover:underline";
const FORM_CLASS = "mb-5 flex flex-col gap-3";
const FORM_ROW_CLASS = "flex items-center justify-between gap-3";
const STATUS_CLASS = "text-xs text-[var(--t3)]";
const LIST_CLASS = "flex flex-col gap-3";
const COMMENT_CLASS =
  "border-t border-[var(--border-1)] pt-3 first:border-t-0 first:pt-0";
const REPLY_CLASS = `${COMMENT_CLASS} ml-5 border-l border-l-[var(--border-1)] pl-4`;
const META_CLASS =
 "mb-1 flex flex-wrap items-center gap-2 text-[12px] text-[var(--t3)]";
const BODY_CLASS =
 "m-0 whitespace-pre-wrap text-sm leading-[1.55] text-[var(--t1)]";
const ACTIONS_CLASS = "mt-2 flex flex-wrap items-center gap-2";
const EMPTY_CLASS = "py-6 text-center text-sm text-[var(--t3)]";

interface MarketDiscussionProps {
 marketId: string;
 isAuthenticated: boolean;
 authLoading: boolean;
 /**
 * Step 11: whether the viewer currently holds a position on this
 * market — gates the disclose checkbox (the gateway re-checks; a
 * checked box with nothing held posts chipless).
 */
 canDisclosePosition?: boolean;
}

export default function MarketDiscussion({
 marketId,
 isAuthenticated,
 authLoading,
 canDisclosePosition = false,
}: MarketDiscussionProps) {
 const { t } = useTranslation("prediction");
 const [comments, setComments] = useState<MarketComment[]>([]);
 const [body, setBody] = useState("");
 const [replyTo, setReplyTo] = useState<string | null>(null);
 const [loading, setLoading] = useState(true);
 const [saving, setSaving] = useState(false);
 const [message, setMessage] = useState<string | null>(null);
 // Opt-in, UNCHECKED by default, and the author decides per comment —
 // the flag resets after every post rather than persisting.
 const [disclosePosition, setDisclosePosition] = useState(false);

 const load = useCallback(async () => {
 try {
 setLoading(true);
 setComments(await getMarketComments(marketId, 50));
 setMessage(null);
 } catch (err) {
 logger.warn("MarketDiscussion", "comments fetch failed", err);
 setMessage(t("DISCUSSION_LOAD_FAILED", "Discussion could not load."));
 } finally {
 setLoading(false);
 }
 }, [marketId, t]);

 useEffect(() => {
 // The social comments endpoint is session-authenticated — an anonymous
 // fetch is a guaranteed 401 (console noise on every logged-out market
 // view). Match the live-prices precedent: signed-out visitors see the
 // sign-in hint instead of a doomed request.
 if (authLoading) return;
 if (!isAuthenticated) {
 setComments([]);
 setLoading(false);
 setMessage(null);
 return;
 }
 void load();
 }, [load, authLoading, isAuthenticated]);

 async function submitComment() {
 if (!isAuthenticated || authLoading || saving) return;
 const trimmed = body.trim();
 if (trimmed.length < 2) return;
 setSaving(true);
 try {
 const created = await createMarketComment(
 marketId,
 trimmed,
 replyTo ?? undefined,
 disclosePosition && canDisclosePosition,
 );
 setComments((prev) => [created, ...prev]);
 setBody("");
 setReplyTo(null);
 setDisclosePosition(false);
 setMessage(t("DISCUSSION_POSTED", "Posted."));
 } catch (err) {
 logger.warn("MarketDiscussion", "comment create failed", err);
 setMessage(t("DISCUSSION_POST_FAILED", "Comment could not be posted."));
 } finally {
 setSaving(false);
 }
 }

 async function updateComment(
 commentId: string,
 updater: (id: string) => Promise<MarketComment>,
 ) {
 if (!isAuthenticated || authLoading) return;
 try {
 const updated = await updater(commentId);
 setComments((prev) =>
 prev.map((comment) => (comment.id === updated.id ? updated : comment)),
 );
 } catch (err) {
 logger.warn("MarketDiscussion", "comment update failed", err);
 setMessage(
 t("DISCUSSION_UPDATE_FAILED", "Action could not be recorded."),
 );
 }
 }

 async function followUser(userId: string) {
 if (!isAuthenticated || authLoading) return;
 try {
 const profile = await followSocialUser(userId);
 setMessage(
 t("DISCUSSION_FOLLOWED", "Following {{user}}.", {
 user: profile.displayName || profile.userId,
 }),
 );
 } catch (err) {
 logger.warn("MarketDiscussion", "follow failed", err);
 setMessage(
 t("DISCUSSION_FOLLOW_FAILED", "Follow could not be recorded."),
 );
 }
 }

 const composerHint = !isAuthenticated
 ? t("DISCUSSION_SIGN_IN", "Sign in to join the market discussion.")
 : replyTo
 ? t("DISCUSSION_REPLYING", "Replying to a comment.")
 : t(
 "DISCUSSION_HINT",
 "Share resolution sources, reasoning, or market context.",
 );

 return (
 <Card as="section" aria-labelledby="market-discussion-title">
 <header className={HEAD_CLASS}>
 <h2 id="market-discussion-title" className={TITLE_CLASS}>
 {t("DISCUSSION_TITLE", "Discussion")}
 </h2>
 <div className="flex items-center gap-3">
 <Link href="/activity" className={HEAD_LINK_CLASS}>
 {t("DISCUSSION_ACTIVITY", "Activity feed")}
 </Link>
 <span className={COUNT_CLASS}>
 {t("DISCUSSION_COUNT", "{{count}} comments", {
 count: comments.length,
 })}
 </span>
 </div>
 </header>

 <div className={FORM_CLASS}>
 <Textarea
 value={body}
 maxLength={500}
 disabled={!isAuthenticated || authLoading || saving}
 placeholder={composerHint}
 onChange={(event) => setBody(event.target.value)}
 />
 {isAuthenticated && (
 <label
 className={`flex min-h-11 w-fit cursor-pointer items-center gap-2.5 text-[13px] ${
              canDisclosePosition ? "text-[var(--t2)]" : "text-[var(--t3)]"
            }`}
          >
            <input
              type="checkbox"
              className="h-[18px] w-[18px] cursor-pointer accent-[var(--accent)] disabled:cursor-not-allowed"
              checked={disclosePosition && canDisclosePosition}
              disabled={!canDisclosePosition || saving}
              onChange={(event) => setDisclosePosition(event.target.checked)}
            />
            {canDisclosePosition
              ? t("DISCLOSE_POSITION_LABEL", "Disclose my position on this market")
              : t(
                  "DISCLOSE_POSITION_NONE",
                  "Disclosure available when you hold a position",
                )}
          </label>
        )}
        <div className={FORM_ROW_CLASS}>
          <span className={STATUS_CLASS}>{message ?? composerHint}</span>
          <Button
            variant="primary"
            disabled={
              !isAuthenticated ||
              authLoading ||
              saving ||
              body.trim().length < 2
            }
            onClick={submitComment}
          >
            {saving
              ? t("DISCUSSION_POSTING", "Posting")
              : replyTo
                ? t("DISCUSSION_REPLY", "Reply")
                : t("DISCUSSION_POST", "Post")}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className={EMPTY_CLASS}>
          {t("DISCUSSION_LOADING", "Loading discussion.")}
        </div>
      ) : comments.length === 0 ? (
        <div className={EMPTY_CLASS}>
          {t("DISCUSSION_EMPTY", "No comments yet.")}
        </div>
      ) : (
        <div className={LIST_CLASS}>
          {comments.map((comment) => (
            <article
              key={comment.id}
              className={comment.parentId ? REPLY_CLASS : COMMENT_CLASS}
            >
              <div className={META_CLASS}>
                <Link
                  href={`/users/${encodeURIComponent(comment.userId)}`}
                  className={HEAD_LINK_CLASS}
                >
                  {comment.userId}
                </Link>
                <span>{formatDate(comment.createdAt)}</span>
                {comment.parentId && (
                  <span>{t("DISCUSSION_REPLY_TAG", "Reply")}</span>
                )}
              </div>
              {comment.positionDisclosure &&
                comment.positionDisclosure.length > 0 && (
                  <div className="mb-1.5 flex flex-wrap gap-1.5">
                    {/* The chip shows the side and size AS THEY STOOD when
                     * the comment posted — past-tense wording carries the
                     * snapshot semantics, and an exited position stays
                     * disclosed. Pale side fills, dark direction text. */}
                    {comment.positionDisclosure.map((entry) => (
                      <span
                        key={entry.side}
                        className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium normal-case tracking-normal ${
                          entry.side === "yes"
                            ? "border-[var(--yes-border)] bg-[var(--yes-soft)] text-[var(--yes-text)]"
                            : "border-[var(--no-border)] bg-[var(--no-soft)] text-[var(--no-text)]"
                        }`}
                      >
                        {t("POSITION_DISCLOSURE_CHIP", {
                          amount: entry.costPoints.toLocaleString(),
                          side: entry.side === "no" ? t("NO") : t("YES"),
                        })}
                      </span>
                    ))}
                  </div>
                )}
              <p className={BODY_CLASS}>{comment.body}</p>
              <div className={ACTIONS_CLASS}>
                <Button
                  size="sm"
                  disabled={!isAuthenticated || authLoading}
                  onClick={() =>
                    updateComment(comment.id, reactToMarketComment)
                  }
                >
                  {t("DISCUSSION_REACT", "Upvote")} · {comment.reactionCount}
                </Button>
                <Button
                  size="sm"
                  disabled={!isAuthenticated || authLoading}
                  onClick={() => followUser(comment.userId)}
                >
                  {t("DISCUSSION_FOLLOW", "Follow")}
                </Button>
                <Button
                  size="sm"
                  disabled={!isAuthenticated || authLoading}
                  onClick={() => setReplyTo(comment.id)}
                >
                  {t("DISCUSSION_REPLY", "Reply")}
                </Button>
                <Button
                  size="sm"
                  disabled={!isAuthenticated || authLoading}
                  onClick={() =>
                    updateComment(comment.id, (id) =>
                      reportMarketComment(id, "user_report"),
                    )
                  }
                >
                  {t("DISCUSSION_REPORT", "Report")} · {comment.reportCount}
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
    </Card>
  );
}

function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
