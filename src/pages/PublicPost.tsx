import { useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { displayName, timeAgo, type Post } from '../lib/hooks';
import { PublicShell } from '../components/PublicShell';
import { Avatar, Badge, ButtonLink, Card, EmptyState, Skeleton, formatStat } from './ui';
import { BadgeCheck, Heart, Lock, MessageCircle } from './icons';
import { MediaLightbox, PostContent, PostMediaGrid } from './PostCard';
import { WorkoutSummaryCard } from './WorkoutSummaryCard';
import { hasWorkoutSummary } from '../lib/workoutSummary';

const OBJECT_ID = /^[a-f0-9]{24}$/i;

/**
 * /p/:postId for someone without a session. Reads the signed-out shape
 * (GET /public/posts/:id: public post, public author, counts instead of the
 * social graph) and asks the visitor to join or sign in. Both CTAs carry this
 * location so a fresh login lands back on the post.
 */
export default function PublicPost() {
  const { postId = '' } = useParams();
  const location = useLocation();
  const [lightbox, setLightbox] = useState<number | null>(null);
  const valid = OBJECT_ID.test(postId);

  const q = useQuery({
    queryKey: ['public-post', postId],
    enabled: valid,
    retry: false,
    queryFn: async () => {
      const { data } = await api.get(`/public/posts/${postId}`);
      return (data.post || data) as Post;
    },
  });

  const from = { from: location };
  const post = q.data;
  const name = displayName(post?.author);

  if (!valid || q.isError) {
    return (
      <PublicShell title="This post isn’t available" subtitle="It may be private, deleted, or shared from an account only followers can see.">
        <EmptyState
          icon={<Lock size={26} />}
          variant="no-results"
          title="Sign in to keep going"
          message="Members see posts from the people they follow, including private ones."
          action={{ label: 'Log in', to: '/login', state: from }}
          secondaryAction={{ label: 'Join Vybe', to: '/register', state: from }}
        />
      </PublicShell>
    );
  }

  if (q.isLoading || !post) {
    return (
      <PublicShell title="Shared on Vybe">
        <Card aria-busy="true" aria-label="Loading post">
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
          <Skeleton className="mt-4 aspect-[4/5] w-full rounded-md" />
          <Skeleton className="mt-4 h-4 w-3/4" />
        </Card>
      </PublicShell>
    );
  }

  const likes = post.likeCount ?? post.likes?.length ?? 0;
  const comments = post.commentCount ?? post.comments?.length ?? 0;

  return (
    <PublicShell title={`${name} on Vybe`} subtitle={`Join Vybe to follow ${name}, like this post and leave a comment.`}>
      <Card role="article" aria-label={`Post by ${name}`} className="overflow-hidden">
        <div className="flex items-start gap-3">
          <Avatar src={post.author?.avatar} name={name} size="md" />
          <div className="flex min-h-11 min-w-0 flex-1 flex-col justify-center">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-md font-semibold text-text-1">{name}</span>
              {post.author?.isVerified ? <BadgeCheck size={18} className="shrink-0 text-brand" aria-label="Verified" role="img" /> : null}
            </span>
            <span className="block truncate text-xs text-text-2">{post.author?.username ? `@${post.author.username}` : ' '}</span>
          </div>
          <time dateTime={post.createdAt} className="tabular pt-2.5 text-xs text-text-3">
            {timeAgo(post.createdAt)}
          </time>
        </div>

        <PostMediaGrid post={post} className="mt-3" expanded onOpen={setLightbox} />
        {hasWorkoutSummary(post.workoutSummary) ? <WorkoutSummaryCard summary={post.workoutSummary} className="mt-3" /> : null}
        <PostContent text={post.content} hashtags={post.hashtags} className="mt-3" />

        <div className="mt-3 flex items-center gap-2 border-t border-line pt-3 text-sm text-text-2">
          <Badge tone="neutral" className="tabular h-7 gap-1.5 px-2.5 text-xs">
            <Heart size={14} />
            {formatStat(likes, { compact: true })} {likes === 1 ? 'like' : 'likes'}
          </Badge>
          <Badge tone="neutral" className="tabular h-7 gap-1.5 px-2.5 text-xs">
            <MessageCircle size={14} />
            {formatStat(comments, { compact: true })} {comments === 1 ? 'comment' : 'comments'}
          </Badge>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <ButtonLink to="/register" state={from} variant="primary">
            Join Vybe
          </ButtonLink>
          <ButtonLink to="/login" state={from} variant="secondary">
            Log in to like or comment
          </ButtonLink>
        </div>
      </Card>

      <MediaLightbox post={post} index={lightbox} onClose={() => setLightbox(null)} onChange={setLightbox} />
    </PublicShell>
  );
}
