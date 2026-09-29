import { Id } from "../common/default";

export type Punter = {
  id: Id;
  email: string;
  status: PunterStatus;
  richStatus?: PunterRichStatus;
  lastSignIn?: string;
  verifiedAt?: string;
} & Omit<PunterName, "title">;

export type PunterDetails = Omit<
  Punter,
  "id" | "firstName" | "lastName" | "lastSignIn"
> & {
  username: string;
  address: PunterAddress;
  communicationPreferences: PunterCommunicationPreferences;
  dateOfBirth: PunterDateOfBirth;
  depositLimits: PunterStandardLimitsScope;
  stakeLimits: PunterStandardLimitsScope;
  sessionLimits: PunterSessionLimitsScope;
  name: PunterName;
  phoneNumber: string;
  userId: Id;
  lastSignIn: string;
  signUpDate: string;
  verifiedAt: string;
  terms: PunterTerms;
  ssn: string;
  isTestAccount: boolean;
  coolOff: PunterCoolOff;
  twoFactorAuthEnabled: boolean;
  hasToAcceptTerms: boolean;
  hasToAcceptResponsibilityCheck: boolean;
};

export enum PunterStatusEnum {
  ACTIVE = "ACTIVE",
  PENDING = "PENDING",
  SUSPENDED = "SUSPENDED",
  SELF_EXCLUDED = "SELF_EXCLUDED",
  COOLING_OFF = "COOLING_OFF",
  UNVERIFIED = "UNVERIFIED",
  NEGATIVE_BALANCE = "NEGATIVE_BALANCE",
}

export type PunterStatus =
  | PunterStatusEnum.ACTIVE
  | PunterStatusEnum.PENDING
  | PunterStatusEnum.SUSPENDED
  | PunterStatusEnum.SELF_EXCLUDED
  | PunterStatusEnum.COOLING_OFF
  | PunterStatusEnum.UNVERIFIED
  | PunterStatusEnum.NEGATIVE_BALANCE;

export enum PunterCoolOffReasonEnum {
  SESSION_LIMIT_BREACH = "SESSION_LIMIT_BREACH",
}

export type PunterCoolOffReason = PunterCoolOffReasonEnum.SESSION_LIMIT_BREACH;

export type PunterCoolOff = {
  cause?: PunterCoolOffReason;
  reason: string;
};

export type PunterRichStatus = {
  status: string;
  reason: {
    startTime: string;
    endTime: string;
  };
};

export type PunterStandardLimitFormat = {
  limit: number | null;
  since: string;
};

export type PunterStandardLimitsScope = {
  daily: {
    current: PunterStandardLimitFormat;
    next?: PunterStandardLimitFormat;
  };
  weekly: {
    current: PunterStandardLimitFormat;
    next?: PunterStandardLimitFormat;
  };
  monthly: {
    current: PunterStandardLimitFormat;
    next?: PunterStandardLimitFormat;
  };
};

export type PunterSessionLimitFormat = {
  limit: {
    length: number;
    unit: string;
  } | null;
  since: string;
};

export type PunterSessionLimitsScope = {
  daily: {
    current: PunterSessionLimitFormat;
    next?: PunterSessionLimitFormat;
  };
  weekly: {
    current: PunterSessionLimitFormat;
    next?: PunterSessionLimitFormat;
  };
  monthly: {
    current: PunterSessionLimitFormat;
    next?: PunterSessionLimitFormat;
  };
};

export type PunterName = {
  firstName: string;
  lastName: string;
  title: string;
};

export type PunterDateOfBirth = {
  day: number;
  month: number;
  year: number;
};

export type PunterAddress = {
  addressLine: string;
  city: string;
  country: string;
  state: string;
  zipcode: string;
};

export type PunterTerms = {
  acceptedAt: string;
  version: number;
};

export type PunterCommunicationPreferences = {
  announcements: boolean;
  promotions: boolean;
  subscriptionUpdates: boolean;
  signInNotifications: boolean;
};

export enum PunterRoleEnum {
  ADMIN = "admin",
  TRADER = "trader",
  OPERATOR = "operator",
  PUNTER = "punter",
}

export type PunterRole =
  | PunterRoleEnum.ADMIN
  | PunterRoleEnum.TRADER
  | PunterRoleEnum.OPERATOR
  | PunterRoleEnum.PUNTER;
export type PunterRoles = PunterRole[];

export type JSONWebToken = {
  [key: string]: any;
};
