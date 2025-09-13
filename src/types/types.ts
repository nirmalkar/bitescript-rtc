export type Participant = {
  clientId: string;
  uid: string;
  name?: string | null;
};

export type JoinedEvent = {
  type: 'joined';
  roomId: string;
  participants: Participant[];
};

export type ErrorEvent = {
  type: 'error';
  error: string;
  reason?: string;
};

export type JoinMessage = { type: 'join'; roomId: string };
export type LeaveMessage = { type: 'leave'; roomId: string };
export type RTCSessionDescriptionInit = {
  type: 'offer' | 'answer' | 'pranswer' | 'rollback';
  sdp: string;
};

export type RTCIceCandidateInit = {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
  usernameFragment?: string;
};

export type OfferMessage = {
  type: 'offer';
  roomId: string;
  sdp: RTCSessionDescriptionInit;
  to?: string;
  from?: string;
};
export type AnswerMessage = {
  type: 'answer';
  roomId: string;
  sdp: RTCSessionDescriptionInit;
  to?: string;
  from?: string;
};
export type IceCandidateMessage = {
  type: 'ice-candidate';
  roomId: string;
  candidate: RTCIceCandidateInit;
  to?: string;
  from?: string;
};

export type SignalingMessage =
  | JoinMessage
  | LeaveMessage
  | OfferMessage
  | AnswerMessage
  | IceCandidateMessage
  | JoinedEvent
  | ErrorEvent;

export type UserTokenPayload = {
  uid: string;
  email?: string;
  name?: string;
  [k: string]: unknown;
};
