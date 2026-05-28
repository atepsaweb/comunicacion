import { pgEnum } from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', [
  'secretary',
  'executive',
  'press_admin',
]);

export const cycleStatusEnum = pgEnum('cycle_status', [
  'pending',
  'open',
  'closed',
  'processed',
  'published',
]);

export const absenceTypeEnum = pgEnum('absence_type', [
  'scheduled_leave',
  'weekly_pause',
]);

export const absenceSourceEnum = pgEnum('absence_source', [
  'whatsapp',
  'panel',
  'admin',
]);

export const messageKindEnum = pgEnum('message_kind', [
  'text',
  'audio',
  'other',
]);

export const messageIntentEnum = pgEnum('message_intent', [
  'report',
  'report_followup_reply',
  'absence_request',
  'weekly_pause',
  'unknown',
]);

export const reportStatusEnum = pgEnum('report_status', [
  'draft',
  'awaiting_followup',
  'complete',
  'paused',
  'on_leave',
  'no_report',
]);

export const reportItemPriorityEnum = pgEnum('report_item_priority', [
  'low',
  'medium',
  'high',
]);

export const publicationKindEnum = pgEnum('publication_kind', [
  'internal_summary',
  'social_instagram',
  'social_facebook',
  'social_x',
  'newsletter',
  'web_article',
]);

export const publicationStatusEnum = pgEnum('publication_status', [
  'draft',
  'in_review',
  'approved',
  'published',
  'discarded',
]);

export const publicationVersionSourceEnum = pgEnum('publication_version_source', [
  'ai_generated',
  'human_edited',
]);

export const consolidationStatusEnum = pgEnum('consolidation_status', [
  'draft',
  'approved',
  'sent',
]);

export const aiPurposeEnum = pgEnum('ai_purpose', [
  'extract',
  'followup_question',
  'consolidate',
  'draft_social',
  'draft_newsletter',
  'classify_intent',
  'other',
]);

export const aiTriggeredByEnum = pgEnum('ai_triggered_by', [
  'workflow',
  'user_action',
  'manual_test',
]);

export const outboundPurposeEnum = pgEnum('outbound_purpose', [
  'weekly_trigger',
  'reminder',
  'followup_question',
  'consolidation_delivery',
  'otp',
  'admin_message',
  'other',
]);

export const deliveryStatusEnum = pgEnum('delivery_status', [
  'sent',
  'delivered',
  'read',
  'failed',
]);
