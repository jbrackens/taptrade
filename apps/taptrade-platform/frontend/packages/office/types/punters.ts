import {
  Punter,
  PunterDetails,
  Id,
  WalletHistoryActionElement,
  PaymentMethodTypeEnum,
} from "@taptrade-ui/utils";

export type OfficePunterShort = Punter & {};

export type OfficePunter = PunterDetails & {
  twoFactorAuthEnabled: boolean;
  hasActiveSession: boolean;
};

export type OfficePunterWalletPaymentMethod = {
  type?: PaymentMethodTypeEnum;
  details?: string;
  adminPunterId?: Id;
};

export type OfficePunterWalletItem = WalletHistoryActionElement & {
  punter?: OfficePunter;
  externalId?: string;
  paymentMethod?: OfficePunterWalletPaymentMethod;
};
export type OfficePunterWallet = OfficePunterWalletItem[];

export enum OfficePunterActivityEnum {
  PREDICTION_ORDER = "PREDICTION_ORDER",
  PREDICTION_RESULT = "PREDICTION_RESULT",
  SYSTEM_LOGIN = "SYSTEM_LOGIN",
}

export type OfficePunterActivity =
  | OfficePunterActivityEnum.SYSTEM_LOGIN
  | OfficePunterActivityEnum.PREDICTION_ORDER
  | OfficePunterActivityEnum.PREDICTION_RESULT;

export type OfficePunterRecentActivityItem = {
  id: Id;
  date: string;
  type: OfficePunterActivity;
  message: string;
  data: OfficePunterRecentActivityItemData;
};

export type OfficePunterRecentActivityItemData = {
  [key: string]: any;
};

export type OfficePunterAuditLogCore = {
  id: Id;
  createdAt: string;
};

export type OfficePunterAuditLogAdjustment = OfficePunterAuditLogCore & {
  userId: Id;
  action: string;
  reason: string;
  dataBefore: Object;
  dataAfter: Object;
};

export type OfficePunterSessionHistory = OfficePunterSessionHistoryItem[];

export type OfficePunterSessionHistoryItem = {
  sessionId: Id;
  startTime: string;
  endTime: string;
  details: OfficePunterSessionHistoryItemDetails;
};

export type OfficePunterSessionHistoryItemDetails = {
  [key: string]: number | string;
};

export type OfficePunterNotes = OfficePunterNotesItem[];

export enum OfficePunterNotesTypeEnum {
  MANUAL = "MANUAL",
  SYSTEM = "SYSTEM",
}

export type OfficePunterNotesType =
  | OfficePunterNotesTypeEnum.MANUAL
  | OfficePunterNotesTypeEnum.SYSTEM;

export type OfficePunterNotesAuthor = {
  firstName: string;
  lastName: string;
};

export type OfficePunterNotesItem = {
  noteId: Id;
  createdAt: string;
  authorId: Id;
  authorName: OfficePunterNotesAuthor;
  noteType: OfficePunterNotesType;
  text: string;
};
