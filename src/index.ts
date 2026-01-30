import { createAgent } from '@lucid-agents/core';
import { http } from '@lucid-agents/http';
import { createAgentApp } from '@lucid-agents/hono';
import { payments, paymentsFromEnv } from '@lucid-agents/payments';
import { z } from 'zod';

// === Hacker News API Base ===
const HN_API = 'https://hacker-news.firebaseio.com/v0';

// === Helper: Fetch JSON ===
async function fetchJSON(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`API error: ${response.status}`);
  return response.json();
}

// === Helper: Fetch story details ===
async function fetchStory(id: number) {
  const story = await fetchJSON(`${HN_API}/item/${id}.json`);
  if (!story) return null;
  return {
    id: story.id,
    title: story.title,
    url: story.url || `https://news.ycombinator.com/item?id=${story.id}`,
    author: story.by,
    score: story.score,
    comments: story.descendants || 0,
    time: new Date(story.time * 1000).toISOString(),
    type: story.type,
  };
}

// === Helper: Fetch multiple stories with details ===
async function fetchStories(ids: number[], limit: number) {
  const storyIds = ids.slice(0, limit);
  const stories = await Promise.all(storyIds.map(fetchStory));
  return stories.filter(Boolean);
}

// === Helper: Time ago string ===
function timeAgo(isoTime: string): string {
  const seconds = Math.floor((Date.now() - new Date(isoTime).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

// === Create Agent ===
const agent = await createAgent({
  name: 'tech-pulse-agent',
  version: '1.0.0',
  description: 'Real-time tech news intelligence from Hacker News. Trending stories, top discussions, Ask HN, Show HN, and more.',
})
  .use(http())
  .use(payments({ config: paymentsFromEnv() }))
  .build();

const { app, addEntrypoint } = await createAgentApp(agent);

// === FREE ENDPOINT: Overview ===
addEntrypoint({
  key: 'overview',
  description: 'Free overview of current tech trends - try before you buy',
  input: z.object({}),
  price: { amount: 0 },
  handler: async () => {
    const [topIds, bestIds, newIds, askIds, showIds] = await Promise.all([
      fetchJSON(`${HN_API}/topstories.json`),
      fetchJSON(`${HN_API}/beststories.json`),
      fetchJSON(`${HN_API}/newstories.json`),
      fetchJSON(`${HN_API}/askstories.json`),
      fetchJSON(`${HN_API}/showstories.json`),
    ]);

    // Get top story preview
    const topStory = await fetchStory(topIds[0]);

    return {
      output: {
        summary: {
          topStoriesCount: topIds.length,
          bestStoriesCount: bestIds.length,
          newStoriesCount: newIds.length,
          askHNCount: askIds.length,
          showHNCount: showIds.length,
        },
        topStoryPreview: topStory ? {
          title: topStory.title,
          score: topStory.score,
          comments: topStory.comments,
          timeAgo: timeAgo(topStory.time),
        } : null,
        dataSource: 'Hacker News API (live)',
        fetchedAt: new Date().toISOString(),
      },
    };
  },
});

// === PAID ENDPOINT 1: Top Stories ($0.001) ===
addEntrypoint({
  key: 'top',
  description: 'Top trending stories on Hacker News right now',
  input: z.object({
    limit: z.number().min(1).max(30).optional().default(10),
  }),
  price: { amount: 1000 },
  handler: async (ctx) => {
    const ids = await fetchJSON(`${HN_API}/topstories.json`);
    const stories = await fetchStories(ids, ctx.input.limit);

    return {
      output: {
        category: 'top',
        count: stories.length,
        stories: stories.map((s: any) => ({
          ...s,
          timeAgo: timeAgo(s.time),
        })),
        fetchedAt: new Date().toISOString(),
      },
    };
  },
});

// === PAID ENDPOINT 2: Best Stories ($0.001) ===
addEntrypoint({
  key: 'best',
  description: 'Best stories - highest voted stories over time',
  input: z.object({
    limit: z.number().min(1).max(30).optional().default(10),
  }),
  price: { amount: 1000 },
  handler: async (ctx) => {
    const ids = await fetchJSON(`${HN_API}/beststories.json`);
    const stories = await fetchStories(ids, ctx.input.limit);

    return {
      output: {
        category: 'best',
        count: stories.length,
        stories: stories.map((s: any) => ({
          ...s,
          timeAgo: timeAgo(s.time),
        })),
        fetchedAt: new Date().toISOString(),
      },
    };
  },
});

// === PAID ENDPOINT 3: New Stories ($0.001) ===
addEntrypoint({
  key: 'new',
  description: 'Latest stories just posted to Hacker News',
  input: z.object({
    limit: z.number().min(1).max(30).optional().default(10),
  }),
  price: { amount: 1000 },
  handler: async (ctx) => {
    const ids = await fetchJSON(`${HN_API}/newstories.json`);
    const stories = await fetchStories(ids, ctx.input.limit);

    return {
      output: {
        category: 'new',
        count: stories.length,
        stories: stories.map((s: any) => ({
          ...s,
          timeAgo: timeAgo(s.time),
        })),
        fetchedAt: new Date().toISOString(),
      },
    };
  },
});

// === PAID ENDPOINT 4: Ask HN ($0.002) ===
addEntrypoint({
  key: 'ask',
  description: 'Ask HN threads - questions and discussions from the community',
  input: z.object({
    limit: z.number().min(1).max(20).optional().default(10),
  }),
  price: { amount: 2000 },
  handler: async (ctx) => {
    const ids = await fetchJSON(`${HN_API}/askstories.json`);
    const stories = await fetchStories(ids, ctx.input.limit);

    return {
      output: {
        category: 'ask',
        description: 'Ask HN - Community questions and discussions',
        count: stories.length,
        stories: stories.map((s: any) => ({
          ...s,
          timeAgo: timeAgo(s.time),
          hnLink: `https://news.ycombinator.com/item?id=${s.id}`,
        })),
        fetchedAt: new Date().toISOString(),
      },
    };
  },
});

// === PAID ENDPOINT 5: Show HN ($0.002) ===
addEntrypoint({
  key: 'show',
  description: 'Show HN threads - projects and products shared by the community',
  input: z.object({
    limit: z.number().min(1).max(20).optional().default(10),
  }),
  price: { amount: 2000 },
  handler: async (ctx) => {
    const ids = await fetchJSON(`${HN_API}/showstories.json`);
    const stories = await fetchStories(ids, ctx.input.limit);

    return {
      output: {
        category: 'show',
        description: 'Show HN - Projects and products from the community',
        count: stories.length,
        stories: stories.map((s: any) => ({
          ...s,
          timeAgo: timeAgo(s.time),
          hnLink: `https://news.ycombinator.com/item?id=${s.id}`,
        })),
        fetchedAt: new Date().toISOString(),
      },
    };
  },
});

// === PAID ENDPOINT 6: Full Report ($0.005) ===
addEntrypoint({
  key: 'report',
  description: 'Comprehensive tech pulse report with top stories across all categories',
  input: z.object({
    storiesPerCategory: z.number().min(1).max(10).optional().default(5),
  }),
  price: { amount: 5000 },
  handler: async (ctx) => {
    const limit = ctx.input.storiesPerCategory;
    
    const [topIds, bestIds, askIds, showIds, jobIds] = await Promise.all([
      fetchJSON(`${HN_API}/topstories.json`),
      fetchJSON(`${HN_API}/beststories.json`),
      fetchJSON(`${HN_API}/askstories.json`),
      fetchJSON(`${HN_API}/showstories.json`),
      fetchJSON(`${HN_API}/jobstories.json`),
    ]);

    const [topStories, bestStories, askStories, showStories, jobStories] = await Promise.all([
      fetchStories(topIds, limit),
      fetchStories(bestIds, limit),
      fetchStories(askIds, limit),
      fetchStories(showIds, limit),
      fetchStories(jobIds, limit),
    ]);

    // Calculate insights
    const allStories = [...topStories, ...bestStories];
    const avgScore = allStories.length > 0
      ? Math.round(allStories.reduce((sum: number, s: any) => sum + (s?.score || 0), 0) / allStories.length)
      : 0;
    const avgComments = allStories.length > 0
      ? Math.round(allStories.reduce((sum: number, s: any) => sum + (s?.comments || 0), 0) / allStories.length)
      : 0;

    // Find most discussed
    const mostDiscussed = [...topStories].sort((a: any, b: any) => (b?.comments || 0) - (a?.comments || 0))[0];

    return {
      output: {
        report: {
          generatedAt: new Date().toISOString(),
          storiesPerCategory: limit,
        },
        insights: {
          averageScore: avgScore,
          averageComments: avgComments,
          mostDiscussed: mostDiscussed ? {
            title: mostDiscussed.title,
            comments: mostDiscussed.comments,
            score: mostDiscussed.score,
          } : null,
        },
        categories: {
          top: {
            title: 'Top Stories',
            count: topStories.length,
            stories: topStories.map((s: any) => ({
              ...s,
              timeAgo: timeAgo(s.time),
            })),
          },
          best: {
            title: 'Best Stories',
            count: bestStories.length,
            stories: bestStories.map((s: any) => ({
              ...s,
              timeAgo: timeAgo(s.time),
            })),
          },
          ask: {
            title: 'Ask HN',
            count: askStories.length,
            stories: askStories.map((s: any) => ({
              ...s,
              timeAgo: timeAgo(s.time),
            })),
          },
          show: {
            title: 'Show HN',
            count: showStories.length,
            stories: showStories.map((s: any) => ({
              ...s,
              timeAgo: timeAgo(s.time),
            })),
          },
          jobs: {
            title: 'Jobs',
            count: jobStories.length,
            stories: jobStories.map((s: any) => ({
              ...s,
              timeAgo: timeAgo(s.time),
            })),
          },
        },
        dataSource: 'Hacker News API (live)',
      },
    };
  },
});

const port = Number(process.env.PORT ?? 3000);
console.log(`📡 Tech Pulse Agent running on port ${port}`);

export default { port, fetch: app.fetch };
