// DM (Direct Messages) socket events namespace enumeration
// Values must match server-side event names exactly.
export enum DMSocketEvent {
  // Connection lifecycle
  Disconnect = "disconnect",
  Connection = "connection",
  ReConnect = "reConnect",
  Ping = "ping",
  Pong = "pong",
  Error = "error",

  // Conversations
  CreateAndStart = "createAndStart",

  // Messages
  SendMessage = "sendMessage",
  EditMessage = "editMessage",
  ForwardMessage = "forwardMessage",
  DeleteMessage = "deleteMessage",
  DestructOpened = "destructOpened",
  /** Delete for me: only the caller stops seeing it. */
  HideMessage = "hideMessage",
  FetchMessage = "fetchMessage",
  ReValidateMessage = "ReValidateMessage",

  // Emoji reactions on a message (same events the web client uses)
  AddReaction = "addReaction",
  RemoveReaction = "removeReaction",
  ReactionUpdated = "reactionUpdated",
  /** A 1:1 chat deleted for both people by the other person. */
  ConversationDeleted = "conversationDeleted",

  // Media upload progress/completion keyed by message/job id
  JobMessageId = "jobMessageId",

  // Read & download receipts
  markAsRead = "markAsRead",
  readReceipt = "readReceipt",
  markAsDownloaded = "markAsDownloaded",
  downloadReceipt = "downloadReceipt",

  // Payments
  TipUpdate = "tipUpdate",
  BadgeBalanceUpdated = "badgeBalanceUpdated",
  DmFeePayment = "dmFeePayment",
  TipSend = "tipSend",
  FeeConfirmed = "feeConfirmed",
  /** A locked (pay-to-unlock) photo or video in one of my chats was paid for. */
  DmMediaUnlocked = "dmMediaUnlocked",
  /** One of my scheduled messages was just sent, or could not be. */
  ScheduledMessageUpdate = "scheduledMessageUpdate",

  // Typing indicators
  Typing = "typing",
  StopTyping = "stopTyping",

  // Test utilities
  Test = "testDM",
}

// Handy set of DM event strings for quick membership checks
export const DMSocketEventSet: ReadonlySet<string> = new Set(
  Object.values(DMSocketEvent),
);
