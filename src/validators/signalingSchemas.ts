import { z } from 'zod';

const base = z.object({ type: z.string() });

export const joinSchema = base.extend({
  type: z.literal('join'),
  roomId: z.string().min(1).max(256),
});

export const leaveSchema = base.extend({
  type: z.literal('leave'),
  roomId: z.string().min(1).max(256),
});

export const offerSchema = base.extend({
  type: z.literal('offer'),
  roomId: z.string(),
  sdp: z.any(),
  to: z.string().optional(),
});

export const answerSchema = base.extend({
  type: z.literal('answer'),
  roomId: z.string(),
  sdp: z.any(),
  to: z.string().optional(),
});

export const iceSchema = base.extend({
  type: z.literal('ice-candidate'),
  roomId: z.string(),
  candidate: z.any(),
  to: z.string().optional(),
});

export const signalingSchema = z.union([
  joinSchema,
  leaveSchema,
  offerSchema,
  answerSchema,
  iceSchema,
]);
export type SignalingParsed = z.infer<typeof signalingSchema>;
